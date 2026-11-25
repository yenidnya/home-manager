/** Kiro agents, steering, skills and MCP servers for OpenCode. */
import { Agent, Plugin, Skill } from "@opencode/plugin"
import { agentPermissions, toolKey } from "./permissions"
import { resolveServers } from "./servers"
import { shellDecision, shellPolicy, type ShellPolicy } from "./shell"
import { discover, type KiroAgent, type SkillInfo } from "./sources"

type Kiro = ReturnType<typeof discover>
type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }
type Scope = {
  servers: ReadonlyMap<string, ReadonlyMap<string, string>>
  scopedServers: ReadonlySet<string>
  scopedSkills: ReadonlySet<string>
}

const worktreeRemoval = "opencode_worktree_remove"

// Kiro's own skills fill gaps only. A per-agent skill no other source provides stays with its agent.
function resolveSkills(kiro: Kiro, existing: ReadonlySet<string>) {
  const global = new Set(kiro.skills.map((skill) => skill.id))
  const scoped = kiro.agents.flatMap((agent) => agent.skills).filter((skill) => !existing.has(skill.id) && !global.has(skill.id))
  const added = new Map<string, SkillInfo>()
  for (const skill of [...kiro.skills, ...scoped]) if (!existing.has(skill.id)) added.set(skill.id, skill)
  return { added, scoped: new Set(scoped.map((skill) => skill.id)) }
}

function skillInfo(skill: SkillInfo) {
  return {
    ...skill,
    id: Skill.ID.make(skill.id),
    name: Skill.Name.make(skill.name),
    path: Skill.Info.fields.path.make(skill.path),
  }
}

function signature(scope: Scope) {
  const servers = [...scope.servers].map(([agent, map]) => [agent, [...map]])
  return JSON.stringify([servers, [...scope.scopedServers], [...scope.scopedSkills]])
}

function inheritedRules(defaults: readonly Rule[] | undefined): Rule[] {
  const rules = (defaults ?? []).filter((rule) => rule.action === "external_directory")
  return rules.length ? rules.map((rule) => ({ ...rule })) : [{ action: "external_directory", resource: "*", effect: "ask" }]
}

function hiddenRules(scope: Scope): Rule[] {
  return [
    ...[...scope.scopedServers].map((server) => ({ action: toolKey(server), resource: "*", effect: "deny" as const })),
    ...[...scope.scopedSkills].map((skill) => ({ action: "skill", resource: skill, effect: "deny" as const })),
  ]
}

// OpenCode offers a tool unless the last rule matching its action denies every resource; a later skill-specific
// deny would offer the skill tool again to an agent that has none.
function skillsDenied(rules: readonly Rule[]) {
  const last = rules.findLast((rule) => new Bun.Glob(rule.action).match("skill"))
  return last?.resource === "*" && last.effect === "deny"
}

function hidesFor(rules: readonly Rule[], hidden: readonly Rule[]) {
  return skillsDenied(rules) ? hidden.filter((rule) => rule.action !== "skill") : hidden
}

function agentRules(agent: KiroAgent, scope: Scope, worktree: string, inherited: Rule[]) {
  const own = new Set(agent.skills.map((skill) => skill.id))
  const servers = scope.servers.get(agent.name) ?? new Map<string, string>()
  return agentPermissions(agent.config, servers, own, scope.scopedSkills, worktree, inherited)
}

function command(input: unknown) {
  return input !== null && typeof input === "object" && "command" in input && typeof input.command === "string" ? input.command : ""
}

// Config agents, skills and global rules register after package plugins. Registering after activation keeps Kiro
// rules last, where an agent's own rules belong, and lets Kiro see every configured agent and skill.
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

// Permission rules cannot express Kiro's whole-command regexes. Denials are checked before the shell runs; an
// allowed command turns the remaining approval prompt into an approval.
async function guardShell(ctx: Plugin.Context, policies: ReadonlyMap<string, ShellPolicy>, created: ReadonlySet<string>) {
  const commands = new Map<string, string>()
  const policy = (agent: string | undefined) => (agent && created.has(agent) ? policies.get(agent) : undefined)
  await ctx.tool.hook("execute.before", (event) => {
    const rules = policy(event.agent)
    if (event.tool !== "shell" || !rules) return
    const text = command(event.input)
    if (shellDecision(rules, text) === "deny") throw new Error(`Kiro settings for ${event.agent} deny this command`)
    commands.set(event.id, text)
  })
  await ctx.tool.hook("execute.after", (event) => void commands.delete(event.id))
  await ctx.permission.hook("evaluate", (event) => {
    const rules = policy(event.agent)
    const text = event.source && commands.get(event.source.id)
    if (event.action !== "shell" || event.effect !== "ask" || !rules || text === undefined) return
    if (shellDecision(rules, text) === "allow") event.effect = "allow"
  })
}

export default Plugin.define({
  id: "kiro",
  async setup(ctx) {
    const kiro = discover(ctx.location.directory)
    const created = new Set<string>()
    const policies = new Map(kiro.agents.map((agent) => [agent.name, shellPolicy(agent.config)] as const))
    let scope: Scope = { servers: new Map(), scopedServers: new Set(), scopedSkills: new Set() }
    const update = (next: Partial<Scope>) => {
      const before = signature(scope)
      scope = { ...scope, ...next }
      // Agent rules depend on the MCP and skill registries, which rebuild independently.
      if (signature(scope) !== before) queueMicrotask(() => void ctx.agent.reload().catch(console.error))
    }
    const registerSkills = () =>
      ctx.skill.transform((editor) => {
        const resolved = resolveSkills(kiro, new Set(editor.list().map((skill) => skill.id)))
        for (const skill of resolved.added.values()) editor.add(skillInfo(skill))
        update({ scopedSkills: resolved.scoped })
      })
    const registerAgents = () =>
      ctx.agent.transform((editor) => {
        const inherited = inheritedRules(editor.get("build")?.permissions)
        created.clear()
        for (const agent of kiro.agents) {
          if (editor.get(agent.name)) continue
          created.add(agent.name)
          editor.update(agent.name, (info) => {
            info.name = Agent.Name.make(agent.name)
            info.description = agent.config.description || agent.name
            info.mode = "subagent"
            info.system = agent.system
            info.permissions = agentRules(agent, scope, ctx.location.directory, inherited)
          })
        }
        const hidden = hiddenRules(scope)
        for (const other of editor.list()) {
          if (hidden.length && !created.has(other.id)) {
            editor.update(other.id, (info) => info.permissions.push(...hidesFor(info.permissions, hidden)))
          }
        }
      })

    await ctx.mcp.transform((editor) => {
      const resolved = resolveServers(kiro.mcpServers, kiro.agents, editor.list())
      for (const [name, config] of resolved.added) editor.set(name, config)
      update({ servers: resolved.servers, scopedServers: resolved.scoped })
    })
    // Worktree removal shares the edit permission, which Kiro grants for file writes only.
    await ctx.session.hook("context", (event) => {
      if (kiro.steering) event.system.push({ type: "text", text: kiro.steering })
      if (created.has(event.agent)) delete event.tools[worktreeRemoval]
    })
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool === worktreeRemoval && created.has(event.agent)) throw new Error("Kiro agents cannot remove worktrees")
    })
    await guardShell(ctx, policies, created)
    return afterActivation(ctx, async () => {
      await registerSkills()
      await registerAgents()
    })
  },
})
