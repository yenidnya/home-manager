import { existsSync, readdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const AGENTS = path.join(os.homedir(), ".claude", "agents")
const INHERITED_PERMISSIONS = ["external_directory", "doom_loop"]
const TOOLS = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "bash",
  Grep: "grep",
  Glob: "glob",
  LS: "list",
  Task: "task",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  TodoWrite: "todowrite",
  Skill: "skill",
}
const ASK = new Set(["bash"])

function markdown(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return undefined
  try {
    return { data: Bun.YAML.parse(match[1]) ?? {}, body: text.slice(match[0].length) }
  } catch {
    return undefined
  }
}

function toolNames(tools) {
  if (typeof tools === "string") return tools.split(",").map((tool) => tool.trim()).filter(Boolean)
  return Array.isArray(tools) ? tools : []
}

function openCodeTool(tool) {
  if (TOOLS[tool]) return TOOLS[tool]
  if (!tool.startsWith("mcp__")) return undefined
  const [server, ...name] = tool.slice(5).split("__")
  return `${server}_${name.join("__") || "*"}`
}

function inherited(cfg) {
  return Object.fromEntries(
    INHERITED_PERMISSIONS.map((key) => [key, typeof cfg.permission === "string" ? cfg.permission : (cfg.permission?.[key] ?? "ask")]),
  )
}

function permission(tools, cfg) {
  const result = { "*": "deny" }
  for (const tool of tools.map(openCodeTool).filter(Boolean)) result[tool] = ASK.has(tool) ? "ask" : "allow"
  return { ...result, ...inherited(cfg) }
}

function agent(file, cfg) {
  const parsed = markdown(readFileSync(file, "utf8"))
  if (!parsed?.body.trim()) return []
  const tools = toolNames(parsed.data.tools)
  const name = parsed.data.name ?? path.basename(file, ".md")
  return [
    [
      name,
      {
        description: parsed.data.description ?? name,
        mode: "subagent",
        prompt: parsed.body.trim(),
        ...(tools.length && { permission: permission(tools, cfg) }),
      },
    ],
  ]
}

export const ClaudeAgents = async () => ({
  config: (cfg) => {
    if (!existsSync(AGENTS)) return
    cfg.agent = cfg.agent ?? {}
    const files = readdirSync(AGENTS).filter((name) => name.endsWith(".md")).sort()
    for (const [name, definition] of files.flatMap((file) => agent(path.join(AGENTS, file), cfg))) {
      cfg.agent[name] ??= definition
    }
  },
})
