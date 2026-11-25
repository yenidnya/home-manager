/** Kiro capability rules for the ordered OpenCode permission engine. */
import { homedir } from "node:os"
import path from "node:path"

type Effect = "allow" | "ask" | "deny"
type Permission = { action: string; resource: string; effect: Effect }
type Decision = Pick<Permission, "resource" | "effect">
type Rule = { effect: Effect; match?: readonly string[]; exclude?: readonly string[] }
type Capability = Rule & { capability: string }
type Settings = {
  denyByDefault?: boolean
  allowedPaths?: readonly string[]
  deniedPaths?: readonly string[]
  availableAgents?: readonly string[]
  trusted?: readonly string[]
}
type Config = {
  tools?: readonly string[]
  excludedTools?: readonly string[]
  permissions?: { rules?: readonly Capability[] }
  toolsSettings?: Record<string, Settings>
  mcpServers?: Record<string, { disabled?: boolean; disabledTools?: readonly string[] }>
}
type Servers = ReadonlyMap<string, string>
type Project = (pattern: string, upper: boolean) => string[]

const rank = { allow: 0, ask: 1, deny: 2 }
const readTools = ["read", "glob", "grep"]
const builtins = [...readTools, "edit", "shell", "webfetch", "websearch", "todowrite", "subagent"]
const selectors = new Map<string, string[]>([
  ["*", builtins], ["@builtin", builtins], ["read", readTools], ["fs_read", readTools], ["read_file", ["read"]],
  ["glob", ["glob"]], ["file_search", ["glob"]], ["grep", ["grep"]], ["grep_search", ["grep"]],
  ...["write", "fs_write", "fs_append", "str_replace", "delete_file"].map((s): [string, string[]] => [s, ["edit"]]),
  ["shell", ["shell"]], ["execute_bash", ["shell"]], ["web", ["webfetch", "websearch"]],
  ["web_fetch", ["webfetch"]], ["web_search", ["websearch"]], ["remote_web_search", ["websearch"]],
  ["todo", ["todowrite"]], ["todo_list", ["todowrite"]], ["subagent", ["subagent"]], ["invoke_sub_agent", ["subagent"]],
])
const defaults: Capability[] = [
  { capability: "fs_read", effect: "allow", match: ["./**"] },
  { capability: "shell", effect: "allow", match: ["git status*", "git log*", "git diff*", "git branch*", "pwd", "whoami", "uname*"] },
]
const decision = (resource: string, effect: Effect): Decision => ({ resource, effect })
const ask = () => decision("*", "ask")
const deny = () => decision("*", "deny")
const named = (action: string, rules: Decision[]) => rules.map((r) => ({ action, ...r }))
const unique = (values: readonly string[]) => [...new Set(values)]
const builtinActions = (tools: readonly string[]) => new Set(tools.flatMap((s) => selectors.get(s) ?? []))

function forCapability(rules: Capability[], capability: string) {
  const names = [capability, "all"]
  if (capability !== "mcp") names.push("builtin")
  if (capability.startsWith("fs_")) names.push("filesystem")
  return rules.filter((r) => names.includes(r.capability))
}

function matches(pattern: string, value: string) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")
  return new RegExp(`^${source}$`, "s").test(value)
}

// Containment proofs need not recognize every pair. A crossing restriction may narrow a grant, never extend it.
function contains(outer: string, inner: string) {
  if (outer === "*" || outer === inner) return true
  if (!/[*?]/.test(inner)) return matches(outer, inner)
  return singleStarContains(outer, inner)
}

function singleStarContains(outer: string, inner: string) {
  const [prefix, suffix, extra] = outer.split("*")
  if (extra !== undefined || suffix === undefined || outer.includes("?")) return false
  return inner.startsWith(prefix) && inner.endsWith(suffix)
}

function affixes(glob: string) {
  const literals = glob.split(/[*?]/)
  return { prefix: literals[0], suffix: literals.at(-1)! }
}

function longer(a: string, b: string) {
  return a.length > b.length ? a : b
}

function intersection(a: string, b: string) {
  const left = affixes(a), right = affixes(b)
  const prefix = longer(left.prefix, right.prefix), suffix = longer(left.suffix, right.suffix)
  if (![left, right].every((p) => prefix.startsWith(p.prefix) && suffix.endsWith(p.suffix))) return []
  if (![a, b].every((p) => /^[^*?]*\*[^*?]*$/.test(p))) return undefined
  const patterns = [prefix + "*" + suffix]
  for (let n = 1; n <= Math.min(prefix.length, suffix.length); n++) {
    const joined = prefix + suffix.slice(n)
    if (matches(a, joined) && matches(b, joined)) patterns.push(joined)
  }
  return patterns
}

function clip(row: Decision, scope: string, insensitive: boolean): Decision[] {
  const a = insensitive ? row.resource.toLowerCase() : row.resource
  const b = insensitive ? scope.toLowerCase() : scope
  if (contains(a, b)) return [decision(scope, row.effect)]
  if (contains(b, a)) return [row]
  if (![a, b].every((p) => /[*?]/.test(p))) return []
  const common = intersection(a, b)
  if (common) return common.map((p) => decision(p, row.effect))
  return row.effect === "allow" ? [] : [decision(scope, "deny")]
}

function compact(rows: Decision[]) {
  const latest = new Map<string, Decision>()
  for (const row of rows) {
    if (row.resource === "*") latest.clear()
    latest.delete(row.resource)
    latest.set(row.resource, row)
  }
  return [...latest.values()]
}

function restrict(rows: Decision[], scopes: readonly string[], insensitive = false) {
  if (scopes.includes("*")) return rows
  return scopes.flatMap((scope) => compact(rows.flatMap((row) => clip(row, scope, insensitive))))
}

function overlay(rows: Decision[], rule: Rule, project: Project, insensitive: boolean) {
  const upper = rule.effect !== "allow"
  const targets = rule.match?.flatMap((p) => project(p, upper)) ?? ["*"]
  if (!targets.length) return rows
  const except = unique((rule.exclude ?? []).flatMap((p) => project(p, !upper)))
  if (except.includes("*")) return rows
  // An exclusion removes this rule only; restore the earlier decisions inside each exception.
  return compact([...rows, ...targets.map((p) => decision(p, rule.effect)), ...restrict(rows, except, insensitive)])
}

function text(pattern: string, upper: boolean) {
  if (!upper && /[?\\]/.test(pattern)) return []
  // OpenCode makes the final space optional in "command *". Adjacent stars keep Kiro's space mandatory.
  return [pattern.replaceAll("\\", "/").replace(/ \*$/, " **")]
}

function policy(rules: Rule[], project: Project = text, insensitive = false) {
  return rules.toSorted((a, b) => rank[a.effect] - rank[b.effect])
    .reduce((rows, rule) => overlay(rows, rule, project, insensitive), [ask()])
}

function settings(config: Config, names: string[]) {
  return names.flatMap((name) => config.toolsSettings?.[name] ?? [])
}

function legacyLimit(allowed: readonly string[] | undefined, blocked: boolean): Rule[] {
  if (allowed === undefined && !blocked) return []
  return [{ effect: blocked ? "deny" : "ask", exclude: allowed ?? [] }]
}

function webPolicy(config: Config, rules: Rule[]) {
  if (!config.toolsSettings?.web_fetch?.trusted?.length) return policy(rules)
  // Legacy trusted-site regexes cannot authorize new sites. Keep the migrated URL globs, but drop blanket approvals.
  return policy(rules.filter((r) => r.effect !== "allow" || !(r.match ?? ["*"]).includes("*")))
}

function pathLimits(s: Settings): Rule[] {
  const denied: Rule[] = s.deniedPaths?.length ? [{ effect: "deny", match: s.deniedPaths }] : []
  return [...legacyLimit(s.allowedPaths, s.denyByDefault === true), ...denied]
}

const slash = (p: string) => p.split(path.sep).join("/")
const localPath = (p: string) => p.replace(/^(?:~|\$HOME)(?=\/|$)/, () => homedir())
const meta = /[*?[{]/
const insensitivePaths = process.platform === "darwin" || process.platform === "win32"
const fileKey = (s: string) => insensitivePaths ? s.toLowerCase() : s

function ambiguousPath(p: string) {
  return !p || p.includes("\\") || (p.split("/").includes("..") && meta.test(p)) || /[!?+*@]\(/.test(p)
}

function absolutePatterns(p: string, base: string) {
  const absolute = slash(path.resolve(base, localPath(p)))
  return meta.test(absolute) ? [absolute] : [absolute, path.posix.join(absolute, "**")]
}

// Consume the literal Location prefix of a filesystem glob; ** can consume zero or more components.
function residual(glob: string, prefix: string) {
  let states = [glob.split("/")]
  for (const part of prefix.split("/").filter(Boolean)) {
    states = unique(states.flatMap((state) => advance(state, part)).map((state) => state.join("/")))
      .map((state) => state ? state.split("/") : [])
  }
  return unique(states.map((state) => state.join("/")))
}

function advance(state: string[], part: string): string[][] {
  const [first, ...rest] = state
  if (!first) return []
  if (first === "**") return [state, ...advance(rest, part)]
  return path.matchesGlob("/" + fileKey(part), "/" + fileKey(first)) ? [rest] : []
}

function pathGlobs(parts: string[], upper: boolean): string[] {
  const [first, ...rest] = parts
  if (first === undefined) return [""]
  if (first === "**") {
    if (!rest.length || rest.join("/") === "*") return ["*"]
    const suffix = pathGlobs(rest, upper)
    return [...suffix, ...suffix.map((p) => `*/${p}`)]
  }
  if (meta.test(first) && !upper) return []
  return pathGlobs(rest, upper).map((p) => p ? `${first}/${p}` : first)
}

function pathProject(base: string, root: string): Project {
  return (p, upper) => {
    if (ambiguousPath(p) || /[{[]/.test(p)) return upper ? ["*"] : []
    return absolutePatterns(p, base).flatMap((pattern) => residual(pattern.replace(/^\/+/, ""), root))
      .flatMap((glob) => pathGlobs(glob ? glob.split("/") : [], upper)).map((glob) => glob || ".")
  }
}

function atRoot(base: string, root: string): Project {
  return (p, upper) => {
    if (ambiguousPath(p)) return upper ? ["*"] : []
    return absolutePatterns(p, base).some((glob) => path.matchesGlob(fileKey(root), fileKey(glob))) ? ["*"] : []
  }
}

function pathDomain(rules: Rule[], base: string, root: string, prefix: string, self: string) {
  const compiled = policy(rules, pathProject(base, root), insensitivePaths)
  const here = policy(rules, atRoot(base, root))[0].effect
  return [...compiled.map((r) => decision(prefix + r.resource, r.effect)), decision(self, here)]
}

function unanimous(rows: Decision[]) {
  return rows.every((r) => r.effect === rows[0].effect) ? rows.slice(0, 1) : rows
}

function strictest(effects: Effect[]) {
  return effects.reduce((a, b) => rank[a] >= rank[b] ? a : b, "allow" as Effect)
}

function filePolicy(rules: Rule[], worktree: string) {
  const base = path.resolve(worktree)
  // A literal wildcard in the Location cannot be quoted in v2 rules. Drive-qualified paths use a different namespace.
  if (process.platform === "win32" || meta.test(base) || base.includes("\\")) return [decision("*", searchEffect(rules))]
  const result = pathDomain(rules, base, slash(base), "", ".")
  let root = base, prefix = ""
  // Siblings inside the project arrive as ../ paths. Files outside the project arrive as absolute paths.
  while (path.dirname(root) !== root) {
    root = path.dirname(root)
    prefix += "../"
    result.push(...pathDomain(rules, base, slash(root), prefix, prefix.slice(0, -1)))
  }
  result.push(...pathDomain(rules, base, "/", "/", "/"))
  // A colon may belong to a local name. A machine or skill fallback must never lift a path deny.
  const virtual = policy(rules, () => [])[0].effect
  const colon = strictest([virtual, ...rules.filter((r) => r.match?.length !== 0).map((r) => r.effect)])
  return unanimous(compact([...result, decision("*:/*", colon)]))
}

function searchEffect(rules: Rule[]): Effect {
  // Glob and grep check the query, not the path of each result. A path deny must therefore disable the search.
  const possible = rules.filter((r) => r.match?.length !== 0)
  if (possible.some((r) => r.effect === "deny")) return "deny"
  if (possible.some((r) => r.effect === "ask")) return "ask"
  return possible.some((r) => r.match === undefined && !r.exclude?.length) ? "allow" : "ask"
}

function subjectNames(tools: readonly string[]) {
  if (builtinActions(tools).has("subagent")) return ["*"]
  return tools.filter((s) => s.startsWith("subagent/")).map((s) => s.slice(9)).filter(Boolean)
}

function subagents(config: Config, rules: Rule[], tools: string[], excluded: string[]) {
  const names = config.toolsSettings?.subagent?.availableAgents
  const available = subjectNames(tools).flatMap((p) => text(p, false))
  let rows = restrict(policy(rules), available)
  if (names) rows = restrict([deny(), ...rows], names.flatMap((p) => text(p, false)))
  return named("subagent", [...rows, ...subjectNames(excluded).flatMap((p) => text(p, true)).map((p) => decision(p, "deny"))])
}

const normalized = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")
const toolPattern = (name: string) => name.split("*").map(normalized).join("*")
export function toolKey(server: string, tool = "*"): string {
  return `${normalized(server)}_${toolPattern(tool)}`
}

function matchesServer(pattern: string, server: string) {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
  return new RegExp(`^${source}$`, "s").test(server)
}

function mcpPattern(selector: string, server: string) {
  if (selector === "*") return ["*"]
  const [id, tool = "*", ...extra] = selector.split("/")
  if (extra.length || !tool || !matchesServer(id, server)) return []
  return [tool]
}

function mcpSelection(tools: string[], server: string, exclude = false) {
  return tools.flatMap((s) => {
    if (s === "*" || s === "@mcp") return ["*"]
    if (!s.startsWith("@") || s === "@builtin") return []
    if (!exclude && s.split("/", 1)[0] !== `@${server}`) return []
    return mcpPattern(s.slice(1), server)
  })
}

function mcpPolicy(rules: Rule[], server: string, tools: string[]) {
  const project: Project = (p) => mcpPattern(p, server).map(toolPattern)
  return restrict(policy(rules, project), mcpSelection(tools, server).map(toolPattern))
}

function namespaceGuards(servers: Servers) {
  const ids = [...servers.values()].map(normalized)
  // Flattened MCP action names have no server separator distinct from a tool-name underscore.
  const reserved = ["opencode", "automation", "machine", "generate", "external"]
  const collides = (id: string, index: number) => reserved.includes(id.split("_")[0]) ||
    ids.some((other, i) => i !== index && (id === other || id.startsWith(other + "_")))
  return unique(ids.filter(collides)).map((id) => ({ action: toolKey(id), ...deny() }))
}

function disabledMcp(config: Config, server: string, excluded: string[]) {
  const spec = config.mcpServers?.[server]
  if (spec?.disabled) return ["*"]
  return [...(spec?.disabledTools ?? []), ...mcpSelection(excluded, server, true)]
}

function mcpPermissions(config: Config, servers: Servers, rules: Rule[], tools: string[], excluded: string[]) {
  const result: Permission[] = [], blocked: Permission[] = []
  for (const [server, id] of servers) {
    for (const row of mcpPolicy(rules, server, tools)) {
      result.push({ action: toolKey(id, row.resource), resource: "*", effect: row.effect })
    }
    for (const p of disabledMcp(config, server, excluded)) {
      blocked.push({ action: toolKey(id, p), resource: "*", effect: "deny" })
    }
  }
  return [...result, ...blocked, ...namespaceGuards(servers)]
}

function builtinRules(config: Config, actions: Set<string>, rules: Capability[], worktree: string) {
  const reads = [...forCapability(rules, "fs_read"), ...settings(config, ["read", "fs_read"]).flatMap(pathLimits)]
  const writes = [...forCapability(rules, "fs_write"), ...settings(config, ["write", "fs_write"]).flatMap(pathLimits)]
  const policies = new Map<string, () => Decision[]>([
    ["read", () => filePolicy(reads, worktree)], ["edit", () => filePolicy(writes, worktree)],
    ["glob", () => [decision("*", searchEffect(reads))]], ["grep", () => [decision("*", searchEffect(reads))]],
    // Kiro shell rules match the whole command, which permission rules cannot see; the shell guard applies them.
    ["shell", () => [ask()]],
    ["webfetch", () => webPolicy(config, forCapability(rules, "web_fetch"))],
    ["websearch", () => policy(forCapability(rules, "web_search"))],
    ["todowrite", () => policy([{ effect: "allow" }, ...forCapability(rules, "todo")])],
  ])
  return [...actions].flatMap((a) => named(a, policies.get(a)?.() ?? []))
}

function availableBuiltins(tools: string[], excluded: string[]) {
  const actions = builtinActions(tools), blocked = builtinActions(excluded)
  // Directory listings share the read tool; a separate listing-only grant is not enforceable.
  if (excluded.some((s) => s === "ls" || s === "list_directory")) blocked.add("read")
  for (const a of blocked) actions.delete(a)
  return actions
}

function skillPermissions(rules: Capability[], owned: ReadonlySet<string>, scoped: ReadonlySet<string>, excluded: string[]) {
  const skills = policy(forCapability(rules, "skill"))
  for (const name of scoped) if (!owned.has(name)) skills.push(decision(name, "deny"))
  if (excluded.some((s) => ["*", "@builtin", "skill", "disclose_context"].includes(s))) skills.push(deny())
  return named("skill", skills)
}

function capabilityRules(config: Config) {
  return [...defaults, ...(config.permissions?.rules ?? [])].filter((r) => Object.hasOwn(rank, r.effect))
}

export function shellRules(config: Config): Rule[] {
  return forCapability(capabilityRules(config), "shell")
}

export function agentPermissions(
  config: Config, servers: Servers, ownSkills: ReadonlySet<string>, scopedSkills: ReadonlySet<string>,
  worktree: string, inherited: readonly Permission[],
): Permission[] {
  const tools = [...(config.tools ?? [])], excluded = [...(config.excludedTools ?? [])]
  const rules = capabilityRules(config)
  return [
    { action: "*", ...deny() },
    ...inherited.filter((r) => r.action === "external_directory"),
    ...builtinRules(config, availableBuiltins(tools, excluded), rules, worktree),
    ...skillPermissions(rules, ownSkills, scopedSkills, excluded),
    ...subagents(config, forCapability(rules, "subagent"), tools, excluded),
    ...mcpPermissions(config, servers, forCapability(rules, "mcp"), tools, excluded),
  ]
}
