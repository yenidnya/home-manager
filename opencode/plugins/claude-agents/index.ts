/** Claude Code subagents from ~/.claude/agents. */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Agent, Plugin } from "@opencode/plugin"

type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Definition = { name: string; description: string; system: string; tools: string[] }

const directory = path.join(os.homedir(), ".claude", "agents")
const worktreeRemoval = "opencode_worktree_remove"
const actions: Record<string, string> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  Grep: "grep",
  Glob: "glob",
  LS: "read",
  Task: "subagent",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  TodoWrite: "todowrite",
  Skill: "skill",
}
const asking = new Set(["shell"])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function markdown(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return undefined
  try {
    const data: unknown = Bun.YAML.parse(match[1])
    if (record(data)) return { data, body: text.slice(match[0].length) }
  } catch {}
  return undefined
}

function toolNames(tools: unknown) {
  if (typeof tools === "string") return tools.split(",").map((tool) => tool.trim()).filter(Boolean)
  return Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === "string") : []
}

function action(tool: string) {
  if (actions[tool]) return actions[tool]
  if (!tool.startsWith("mcp__")) return undefined
  const [server, ...name] = tool.slice(5).split("__")
  return `${server}_${name.join("__") || "*"}`
}

function load(file: string): Definition[] {
  const parsed = markdown(readFileSync(file, "utf8"))
  const system = parsed?.body.trim()
  if (!parsed || !system) return []
  const { data } = parsed
  const name = typeof data.name === "string" && data.name ? data.name : path.basename(file, ".md")
  const description = typeof data.description === "string" && data.description ? data.description : name
  return [{ name, description, system, tools: toolNames(data.tools) }]
}

function definitions() {
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((name) => name.endsWith(".md")).sort().flatMap((name) => load(path.join(directory, name)))
}

// Agents without a tool list inherit the default agent's rules, as unrestricted subagents did before.
function permissions(tools: string[], defaults: readonly Rule[]): Rule[] {
  if (!tools.length) return defaults.map((rule) => ({ ...rule }))
  const granted = [...new Set(tools.map(action).filter((name) => name !== undefined))]
  const external = defaults.filter((rule) => rule.action === "external_directory")
  return [
    { action: "*", resource: "*", effect: "deny" },
    ...granted.map((name): Rule => ({ action: name, resource: "*", effect: asking.has(name) ? "ask" : "allow" })),
    ...(external.length ? external.map((rule) => ({ ...rule })) : [{ action: "external_directory", resource: "*", effect: "ask" as const }]),
  ]
}

// Config agents and global rules register after package plugins. Registering after activation keeps these rules
// last, where an agent's own rules belong, and lets configured agents of the same name take precedence.
function afterActivation(ctx: Plugin.Context, register: () => Promise<unknown>) {
  const controller = new AbortController()
  const { signal } = controller
  void (async () => {
    for await (const event of ctx.event.subscribe({ types: ["plugin.updated"], signal })) {
      if (event.location && event.location.directory !== ctx.location.directory) continue
      await register()
      return
    }
  })().catch((error) => signal.aborted || console.error(error))
  return () => controller.abort()
}

export default Plugin.define({
  id: "claude-agents",
  async setup(ctx) {
    const agents = definitions()
    const restricted = new Set<string>()
    // Worktree removal shares the edit permission, which a tool list grants for file writes only.
    await ctx.session.hook("context", (event) => {
      if (restricted.has(event.agent)) delete event.tools[worktreeRemoval]
    })
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool === worktreeRemoval && restricted.has(event.agent)) throw new Error("This agent cannot remove worktrees")
    })
    return afterActivation(ctx, () =>
      ctx.agent.transform((editor) => {
        const defaults = editor.get("build")?.permissions ?? []
        restricted.clear()
        for (const agent of agents) {
          if (editor.get(agent.name)) continue
          if (agent.tools.length) restricted.add(agent.name)
          editor.update(agent.name, (info) => {
            info.name = Agent.Name.make(agent.name)
            info.description = agent.description
            info.mode = "subagent"
            info.system = agent.system
            info.permissions = permissions(agent.tools, defaults)
          })
        }
      }),
    )
  },
})
