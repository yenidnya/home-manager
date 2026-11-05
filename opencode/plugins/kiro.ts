import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()
const KIRO = path.join(HOME, ".kiro")
const STEERING = path.join(KIRO, "steering")
const SKILLS = path.join(KIRO, "skills")
const AGENTS = path.join(KIRO, "agents")
const MCP_SETTINGS = path.join(KIRO, "settings", "mcp.json")

const RANK = { allow: 0, ask: 1, deny: 2 }
const DEFAULT_RULES = [
  { capability: "fs_read", effect: "allow", match: ["./**"] },
  {
    capability: "shell",
    effect: "allow",
    match: ["git status*", "git log*", "git diff*", "git branch*", "pwd", "whoami", "uname*"],
  },
]
const INHERITED_PERMISSIONS = ["external_directory", "doom_loop"]
const PROMPT_NOTE =
  "This agent was written for Kiro. Use the opencode tool for each Kiro tool: read_file -> read, " +
  "fs_write or str_replace -> edit, execute_bash -> bash, grep_search -> grep, file_search -> glob, " +
  "list_directory -> list, web_fetch -> webfetch, invoke_sub_agent or subagent/<name> -> task with " +
  "subagent_type <name>. MCP tools appear as <server>_<tool>."

const BUILTIN = ["read", "glob", "grep", "list", "lsp", "edit", "bash", "webfetch", "websearch", "todowrite"]
const READ = ["read", "glob", "grep", "list", "lsp"]
const SELECTORS = {
  "*": BUILTIN,
  "@builtin": BUILTIN,
  read: READ,
  fs_read: READ,
  read_file: ["read"],
  ls: ["list"],
  list_directory: ["list"],
  glob: ["glob"],
  file_search: ["glob"],
  grep: ["grep"],
  grep_search: ["grep"],
  code: ["lsp"],
  write: ["edit", "lsp"],
  fs_write: ["edit"],
  fs_append: ["edit"],
  str_replace: ["edit"],
  delete_file: ["edit"],
  shell: ["bash"],
  execute_bash: ["bash"],
  web: ["webfetch", "websearch"],
  web_fetch: ["webfetch"],
  web_search: ["websearch"],
  remote_web_search: ["websearch"],
  todo: ["todowrite"],
  todo_list: ["todowrite"],
}
const ALL_SUBAGENTS = new Set(["*", "@builtin", "subagent", "invoke_sub_agent"])
const ALL_SERVERS = new Set(["*", "@mcp"])

const CAPABILITIES = {
  read: { capability: "fs_read", kind: "path" },
  glob: { capability: "fs_read" },
  grep: { capability: "fs_read" },
  list: { capability: "fs_read" },
  lsp: { capability: "fs_read" },
  edit: { capability: "fs_write", kind: "path" },
  bash: { capability: "shell", kind: "text" },
  webfetch: { capability: "web_fetch", kind: "action" },
  websearch: { capability: "web_search", kind: "action" },
  task: { capability: "subagent", kind: "text" },
  todowrite: {},
}
const META_CAPABILITIES = {
  all: () => true,
  builtin: (capability) => capability !== "mcp",
  filesystem: (capability) => capability === "fs_read" || capability === "fs_write",
}

const expressions = new Map()

function wildcard(pattern) {
  if (!expressions.has(pattern)) {
    const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
    expressions.set(pattern, new RegExp(`^${source}$`, "s"))
  }
  return expressions.get(pattern)
}

function matches(pattern, value) {
  return wildcard(pattern).test(value)
}

function expandHome(file) {
  return file === "~" || file.startsWith("~/") ? path.join(HOME, file.slice(1)) : file
}

function isFile(file) {
  return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false
}

function expand(pattern, directory) {
  const absolute = path.resolve(directory, expandHome(pattern))
  const wildcardAt = absolute.search(/[*?[{]/)
  if (wildcardAt === -1) return isFile(absolute) ? [absolute] : []
  const base = absolute.slice(0, absolute.lastIndexOf("/", wildcardAt)) || "/"
  if (!existsSync(base)) return []
  return globSync(path.relative(base, absolute), { cwd: base })
    .map((file) => path.join(base, file))
    .filter(isFile)
    .sort()
}

function markdown(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: text }
  const body = text.slice(match[0].length)
  try {
    return { data: Bun.YAML.parse(match[1]) ?? {}, body }
  } catch {
    return { data: {}, body }
  }
}

function frontmatter(file) {
  return markdown(readFileSync(file, "utf8")).data
}

function steering() {
  return expand("**/*.md", STEERING).filter((file) => frontmatter(file).inclusion !== "manual")
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

function loadAgent(file) {
  const text = readFileSync(file, "utf8")
  if (file.endsWith(".json")) {
    const config = readJson(file)
    return config ? [{ file, config, body: config.prompt }] : []
  }
  const { data, body } = markdown(text)
  return [{ file, config: data, body }]
}

function kiroAgents() {
  if (!existsSync(AGENTS)) return []
  return readdirSync(AGENTS)
    .filter((name) => name.endsWith(".json") || name.endsWith(".md"))
    .sort()
    .flatMap((name) => loadAgent(path.join(AGENTS, name)))
    .map((agent) => ({ ...agent, name: agent.config.name ?? path.basename(agent.file).replace(/\.(json|md)$/, "") }))
}

function substitute(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      String(value).replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? ""),
    ]),
  )
}

function configServer(spec) {
  if (spec.url) return { type: "remote", url: spec.url, ...(spec.headers && { headers: substitute(spec.headers) }) }
  return { type: "local", command: [spec.command, ...(spec.args ?? [])], ...(spec.env && { environment: substitute(spec.env) }) }
}

function identity(command, args) {
  return [path.basename(command ?? ""), ...args].join(" ")
}

function kiroIdentity(spec) {
  return spec.url ?? identity(spec.command, spec.args ?? [])
}

function configIdentity(entry) {
  return entry.type === "remote" ? entry.url : identity(entry.command?.[0], entry.command?.slice(1) ?? [])
}

function addServer(mcp, name, spec) {
  if (mcp[name]) return { name, added: false }
  const existing = Object.keys(mcp).find((key) => configIdentity(mcp[key]) === kiroIdentity(spec))
  if (existing) return { name: existing, added: false }
  mcp[name] = configServer(spec)
  return { name, added: true }
}

function enabledServers(servers) {
  return Object.entries(servers ?? {}).filter(([, spec]) => !spec.disabled)
}

function sanitize(value) {
  return value.replace(/[^a-zA-Z0-9_*-]/g, "_")
}

function toolKey(server, tool = "*") {
  return `${sanitize(server)}_${sanitize(tool)}`
}

function agentServers(agent, mcp, global, scoped) {
  const servers = new Map(agent.config.includeMcpJson ? global : [])
  for (const [name, spec] of enabledServers(agent.config.mcpServers)) {
    const server = addServer(mcp, name, spec)
    if (server.added) scoped.add(server.name)
    servers.set(name, server.name)
  }
  return servers
}

function select(tool, servers) {
  if (tool.startsWith("subagent/")) return { builtin: [], mcp: [], task: [tool.slice(9)] }
  const task = ALL_SUBAGENTS.has(tool) ? ["*"] : []
  if (ALL_SERVERS.has(tool)) return { builtin: SELECTORS[tool] ?? [], mcp: [...servers.values()].map((s) => toolKey(s)), task }
  if (!tool.startsWith("@") || tool === "@builtin") return { builtin: SELECTORS[tool] ?? [], mcp: [], task }
  const [server, name] = tool.slice(1).split("/")
  return { builtin: [], mcp: servers.has(server) ? [toolKey(servers.get(server), name)] : [], task }
}

function selection(tools, servers) {
  const selected = (tools ?? []).map((tool) => select(tool, servers))
  return {
    builtin: new Set(selected.flatMap((item) => item.builtin)),
    mcp: [...new Set(selected.flatMap((item) => item.mcp))],
    task: [...new Set(selected.flatMap((item) => item.task))],
  }
}

function availableTools(config, servers) {
  const selected = selection(config.tools, servers)
  const excluded = selection(config.excludedTools, servers)
  return {
    builtin: [...selected.builtin].filter((key) => !excluded.builtin.has(key)),
    mcp: selected.mcp.filter((key) => !excluded.mcp.includes(key)),
    task: selected.task.filter((name) => !excluded.task.includes(name)),
  }
}

function rulesFor(rules, capability) {
  return rules.filter((rule) => rule.capability === capability || META_CAPABILITIES[rule.capability]?.(capability))
}

function applies(rule, value) {
  return (
    (rule.match ?? ["*"]).some((pattern) => matches(pattern, value)) &&
    !(rule.exclude ?? []).some((pattern) => matches(pattern, value))
  )
}

function effectAt(rules, value) {
  const effects = rules.filter((rule) => applies(rule, value)).map((rule) => rule.effect)
  return effects.sort((a, b) => RANK[b] - RANK[a])[0]
}

function tiered(rules) {
  return rules.toSorted(
    (a, b) => RANK[a.effect] - RANK[b.effect] || Number(!a.exclude?.length) - Number(!b.exclude?.length),
  )
}

function entries(available, rules) {
  const result = new Map([["*", "deny"]])
  const put = (pattern, effect = "ask") => {
    result.delete(pattern)
    result.set(pattern, effect)
  }
  const scopes = available.filter((pattern) => pattern.includes("*"))
  for (const pattern of scopes) put(pattern, effectAt(rules, pattern))
  for (const rule of tiered(rules)) {
    for (const pattern of [...(rule.match ?? ["*"]), ...(rule.exclude ?? [])]) {
      if (scopes.some((scope) => matches(scope, pattern))) put(pattern, effectAt(rules, pattern))
    }
  }
  for (const pattern of available.filter((pattern) => !pattern.includes("*"))) put(pattern, effectAt(rules, pattern))
  return result
}

function collapse(result) {
  const list = [...result]
  const reachable = list.slice(list.findLastIndex(([pattern]) => pattern === "*"))
  const base = reachable[0][1]
  return reachable.every(([, effect]) => effect === base) ? base : Object.fromEntries(reachable)
}

function action(permission) {
  if (typeof permission === "string") return permission
  return permission["*"] === "deny" ? "deny" : "ask"
}

function relativeGlob(absolute, worktree) {
  const wildcardAt = absolute.search(/[*?[{]/)
  if (wildcardAt === -1) return path.relative(worktree, absolute)
  const cut = absolute.lastIndexOf("/", wildcardAt)
  return [path.relative(worktree, absolute.slice(0, cut) || "/"), absolute.slice(cut + 1)].filter(Boolean).join("/")
}

function pathPatterns(pattern, worktree) {
  const expanded = expandHome(pattern)
  const relative = path.isAbsolute(expanded) ? relativeGlob(expanded, worktree) : expanded.replace(/^\.\//, "")
  const collapsed = relative.replace(/\*\*\//g, "*").replace(/\*+/g, "*") || "*"
  return collapsed.includes("*") ? [collapsed] : [collapsed, `${collapsed}/*`]
}

function pathRule(rule, worktree) {
  return {
    ...rule,
    match: rule.match?.flatMap((pattern) => pathPatterns(pattern, worktree)),
    exclude: rule.exclude?.flatMap((pattern) => pathPatterns(pattern, worktree)),
  }
}

function builtinPermission(key, rules, task, worktree) {
  const { capability, kind } = CAPABILITIES[key]
  if (!capability) return "allow"
  const scoped = rulesFor(rules, capability)
  const converted = kind === "path" ? scoped.map((rule) => pathRule(rule, worktree)) : scoped
  if (!kind) return effectAt(converted.filter((rule) => !rule.match || rule.match.includes("*")), "*") ?? "ask"
  const permission = collapse(entries(key === "task" ? task : ["*"], converted))
  return kind === "action" ? action(permission) : permission
}

function mcpRules(rules, servers) {
  return rulesFor(rules, "mcp").map((rule) => ({
    ...rule,
    match: rule.match?.map((pattern) => mcpKey(pattern, servers)),
    exclude: rule.exclude?.map((pattern) => mcpKey(pattern, servers)),
  }))
}

function mcpKey(pattern, servers) {
  const [server, tool = "*"] = pattern.split("/")
  return server === "*" ? "*" : toolKey(servers.get(server) ?? server, tool)
}

function skillPermission(rules, owned, scoped) {
  const result = entries(["*"], rulesFor(rules, "skill"))
  for (const name of scoped) {
    if (owned.has(name)) continue
    result.delete(name)
    result.set(name, "deny")
  }
  return collapse(result)
}

function agentPermission(agent, context) {
  const rules = [...DEFAULT_RULES, ...(agent.config.permissions?.rules ?? [])].filter((rule) => rule.effect in RANK)
  const tools = availableTools(agent.config, agent.servers)
  const builtin = tools.task.length ? [...tools.builtin, "task"] : tools.builtin
  const permission = { "*": "deny" }
  for (const key of builtin) permission[key] = builtinPermission(key, rules, tools.task, context.worktree)
  permission.skill = skillPermission(rules, agent.skills, context.scopedSkills)
  for (const [key, effect] of entries(tools.mcp, mcpRules(rules, agent.servers))) {
    if (key !== "*") permission[key] = effect
  }
  return { ...permission, ...context.inherited }
}

function isSteering(file) {
  return file.split(path.sep).join("/").includes("/.kiro/steering/")
}

function resources(agent, scheme, directory) {
  return (agent.config.resources ?? [])
    .filter((resource) => typeof resource === "string" && resource.startsWith(scheme))
    .flatMap((resource) => expand(resource.slice(scheme.length), directory))
}

function agentPrompt(agent, directory) {
  const source = typeof agent.body === "string" ? agent.body : ""
  const body = source.startsWith("file://")
    ? readFileSync(path.resolve(path.dirname(agent.file), expandHome(source.slice(7))), "utf8")
    : source
  const files = [...new Set(resources(agent, "file://", directory))].filter(
    (file) => !isSteering(file) && path.basename(file) !== "AGENTS.md",
  )
  const read = files.length ? `\n\nRead these files before you start: ${files.join(", ")}.` : ""
  return `${body.trim()}${read}\n\n${PROMPT_NOTE}\n`.trimStart()
}

function ancestors(start, stop) {
  const directories = [start]
  while (directories.at(-1) !== stop && path.dirname(directories.at(-1)) !== directories.at(-1)) {
    directories.push(path.dirname(directories.at(-1)))
  }
  return directories
}

function skillRoots(cfg, directory, worktree) {
  const config = path.join(process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config"), "opencode")
  const project = ancestors(directory, worktree).flatMap((root) =>
    [".claude/skills", ".agents/skills", ".opencode/skill", ".opencode/skills"].map((child) => path.join(root, child)),
  )
  const configured = (cfg.skills?.paths ?? []).map((item) => path.resolve(directory, expandHome(item)))
  return [
    path.join(HOME, ".claude", "skills"),
    path.join(HOME, ".agents", "skills"),
    path.join(config, "skill"),
    path.join(config, "skills"),
    ...project,
    ...configured,
  ]
}

function skillName(file) {
  return frontmatter(file).name
}

function knownSkills(roots) {
  return new Set(roots.flatMap((root) => expand("**/SKILL.md", root)).map(skillName).filter(Boolean))
}

function agentSkills(agent, directory, known) {
  const skills = new Map()
  for (const file of resources(agent, "skill://", directory)) {
    const name = skillName(file)
    if (name && !known.has(name)) skills.set(name, path.dirname(file))
  }
  return skills
}

function addSkillPaths(cfg, directories) {
  const paths = cfg.skills?.paths ?? []
  const present = new Set(paths.map((item) => path.resolve(expandHome(item))))
  cfg.skills = { ...cfg.skills, paths: [...paths, ...directories.filter((item) => !present.has(item))] }
}

function hideScoped(cfg, servers, skills) {
  if (!servers.length && !skills.length) return
  const permission = typeof cfg.permission === "string" ? { "*": cfg.permission } : { ...cfg.permission }
  for (const server of servers) permission[toolKey(server)] = "deny"
  if (skills.length) {
    const skill = typeof permission.skill === "string" ? { "*": permission.skill } : { ...permission.skill }
    for (const name of skills) skill[name] = "deny"
    permission.skill = skill
  }
  cfg.permission = permission
}

function inherited(cfg) {
  return Object.fromEntries(
    INHERITED_PERMISSIONS.map((key) => [key, typeof cfg.permission === "string" ? cfg.permission : (cfg.permission?.[key] ?? "ask")]),
  )
}

function bridge(cfg, directory, worktree) {
  cfg.instructions = [...(cfg.instructions ?? []), ...steering()]
  if (existsSync(SKILLS)) addSkillPaths(cfg, [SKILLS])
  cfg.mcp = cfg.mcp ?? {}
  const global = new Map(
    enabledServers(readJson(MCP_SETTINGS)?.mcpServers).map(([name, spec]) => [name, addServer(cfg.mcp, name, spec).name]),
  )
  const scopedServers = new Set()
  const known = knownSkills([...skillRoots(cfg, directory, worktree)])
  const agents = kiroAgents().map((agent) => ({
    ...agent,
    servers: agentServers(agent, cfg.mcp, global, scopedServers),
    skillDirectories: agentSkills(agent, directory, known),
  }))
  const scopedSkills = new Set(agents.flatMap((agent) => [...agent.skillDirectories.keys()]))
  addSkillPaths(cfg, [...new Set(agents.flatMap((agent) => [...agent.skillDirectories.values()]))])
  const context = { worktree, scopedSkills, inherited: inherited(cfg) }
  hideScoped(cfg, [...scopedServers], [...scopedSkills])
  cfg.agent = cfg.agent ?? {}
  for (const agent of agents) {
    cfg.agent[agent.name] ??= {
      description: agent.config.description ?? agent.name,
      mode: "subagent",
      prompt: agentPrompt(agent, directory),
      permission: agentPermission({ ...agent, skills: new Set(agent.skillDirectories.keys()) }, context),
    }
  }
}

export const Kiro = async ({ directory, worktree }) => ({
  config: (cfg) => {
    if (existsSync(KIRO)) bridge(cfg, directory, worktree)
  },
})
