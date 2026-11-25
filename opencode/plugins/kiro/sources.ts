/** Personal Kiro sources for the OpenCode agent and skill registries. */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

type Guard<T = unknown> = (value: unknown) => value is T
type Checked<G> = G extends Guard<infer T> ? T : never
type Fields = Record<string, Guard>
type Values<F extends Fields> = { [K in keyof F]: Checked<F[K]> }

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === "string"
const nonblank = (v: unknown): v is string => text(v) && v.trim().length > 0
const bool = (v: unknown): v is boolean => typeof v === "boolean"
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const list = <T>(item: Guard<T>) => (v: unknown): v is T[] => Array.isArray(v) && v.every(item)
const dictionary = <T>(item: Guard<T>) => (v: unknown): v is Record<string, T> => record(v) && Object.values(v).every(item)
const strings = list(text)
const stringMap = dictionary(text)

function shape<R extends Fields, O extends Fields>(required: R, optional: O, strict = false) {
  return (v: unknown): v is Values<R> & Partial<Values<O>> & Record<string, unknown> => {
    if (!record(v)) return false
    if (strict && Object.keys(v).some((key) => !Object.hasOwn(required, key) && !Object.hasOwn(optional, key))) return false
    return Object.entries(required).every(([key, check]) => Object.hasOwn(v, key) && check(v[key])) &&
      Object.entries(optional).every(([key, check]) => !Object.hasOwn(v, key) || check(v[key]))
  }
}

const effect = (v: unknown): v is "allow" | "ask" | "deny" => v === "allow" || v === "ask" || v === "deny"
const rule = shape({ capability: nonblank, effect }, { match: strings, exclude: strings }, true)
const settings = shape({}, {
  denyByDefault: bool, autoAllowReadonly: bool, allowedCommands: strings, deniedCommands: strings,
  allowedPaths: strings, deniedPaths: strings, availableAgents: strings, trustedAgents: strings, trusted: strings,
})
const server = shape({}, {
  type: text, command: nonblank, args: strings, env: stringMap, url: nonblank, headers: stringMap,
  disabled: bool, disabledTools: strings, autoApprove: strings, timeout: number, requestTimeout: number,
  oauth: shape({}, { clientId: text, redirectUri: text }), oauthScopes: strings,
})
const resource = (v: unknown): v is string | Record<string, unknown> => text(v) || record(v)
const profile = shape({}, {
  name: nonblank, description: text, prompt: text, model: text, resources: list(resource),
  tools: strings, excludedTools: strings, allowedTools: strings, toolsSettings: dictionary(settings),
  permissions: shape({}, { rules: list(rule), policies: strings }, true), includeMcpJson: bool, mcpServers: dictionary(server),
})

export type KiroServer = Checked<typeof server>
export type KiroConfig = Checked<typeof profile>
export type SkillInfo = { id: string; name: string; description: string; content: string; path: string; autoinvoke?: boolean }
export type KiroAgent = { name: string; config: KiroConfig; system: string; skills: SkillInfo[] }

const toolNote = [
  "Use the available OpenCode tools for Kiro instructions. Use read for read_file and list_directory,",
  "grep for grep_search, glob for file_search, shell for execute_bash, and edit for fs_write or str_replace.",
  "Use webfetch for web_fetch. For invoke_sub_agent or subagent/<name>, call subagent(agent=<name>, description=..., prompt=...).",
  "Select MCP tools by their registered OpenCode names.",
  "When a task matches an available skill, call skill(id=<skill ID>) to load its instructions and resources.",
].join(" ")

function attempt<T>(get: () => T): T | undefined {
  try { return get() } catch { return undefined }
}

const real = (file: string) => attempt(() => realpathSync(file))
const stat = (file: string) => attempt(() => statSync(file))
const read = (file: string) => attempt(() => readFileSync(file, "utf8"))
const entries = (dir: string) => attempt(() => readdirSync(dir, { withFileTypes: true })) ?? []

function absolute(pattern: string, directory: string, home: string) {
  return path.resolve(directory, pattern.replace(/^~(?=\/|$)/, () => home))
}

const globstar = /(?:^|[/{,])\*\*(?:$|[/},])/

function globPlan(pattern: string) {
  const parts = pattern.split("/")
  const maxDepth = globstar.test(pattern) ? Infinity : parts.length
  const prefixes: Bun.Glob[] = []
  for (const [index, part] of parts.slice(0, -1).entries()) {
    // A globstar or a brace alternative can cross directory boundaries.
    if (globstar.test(part) || part.split("{").length !== part.split("}").length) break
    prefixes.push(new Bun.Glob(parts.slice(0, index + 1).join("/")))
  }
  const explicitDotfile = parts.at(-1)
  return {
    files: new Bun.Glob(pattern),
    visible: (name: string) => !name.startsWith(".") || (maxDepth < Infinity && name === explicitDotfile),
    descend: (relative: string, depth: number) => depth < maxDepth && (prefixes[depth - 1]?.match(relative) ?? true),
  }
}

function matchingFiles(root: string, pattern: string) {
  const plan = globPlan(pattern), files: string[] = [], ancestors = new Set<string>()
  function visit(dir: string, prefix: string, depth: number) {
    const id = real(dir)
    if (!id || ancestors.has(id)) return
    ancestors.add(id)
    for (const entry of entries(dir)) {
      if (!plan.visible(entry.name)) continue
      const file = path.join(dir, entry.name), relative = prefix + entry.name
      const info = entry.isSymbolicLink() ? stat(file) : entry
      if (info?.isFile() && plan.files.match(relative)) files.push(file)
      if (info?.isDirectory() && plan.descend(relative, depth)) visit(file, relative + "/", depth + 1)
    }
    ancestors.delete(id)
  }
  visit(root, "", 1)
  return files.sort()
}

function expand(pattern: string, directory: string, home: string) {
  const normalized = path.normalize(pattern), magic = normalized.search(/[*?[{]/)
  if (magic === -1) {
    const file = absolute(normalized, directory, home)
    return stat(file)?.isFile() ? [file] : []
  }
  const cut = normalized.lastIndexOf(path.sep, magic) + 1
  const base = absolute(normalized.slice(0, cut), directory, home)
  return matchingFiles(base, normalized.slice(cut).split(path.sep).join("/"))
}

function markdown(input: string) {
  const source = input.replace(/^\uFEFF/, ""), start = /^---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!start) return { data: {} as Record<string, unknown>, body: source }
  const rest = source.slice(start[0].length), end = /^---[ \t]*(?:\r?\n|$)/m.exec(rest)
  if (!end) return
  const header = rest.slice(0, end.index)
  const data: unknown = header.trim() ? attempt(() => Bun.YAML.parse(header)) : {}
  if (record(data)) return { data, body: rest.slice(end.index + end[0].length) }
}

function document(file: string) {
  const source = read(file)
  return source === undefined ? undefined : markdown(source)
}

function json(file: string): unknown {
  return attempt(() => JSON.parse(readFileSync(file, "utf8")))
}

function booleanValue(value: unknown) {
  if (!["boolean", "number", "string"].includes(typeof value)) return
  const key = String(value).trim().toLowerCase()
  if (["false", "no", "off", "0"].includes(key)) return false
  if (["true", "yes", "on", "1"].includes(key)) return true
}

// IDs come from the skill directory, as for natively discovered skills; frontmatter names are display labels.
function skillInfo(file: string): SkillInfo[] {
  const source = real(file)
  if (!source) return []
  const doc = document(source)
  if (!doc || !text(doc.data.description)) return []
  const { description, metadata } = doc.data
  const id = path.basename(path.dirname(file))
  const name = nonblank(doc.data.name) ? doc.data.name : id
  const invoke = record(metadata) ? booleanValue(metadata["opencode/autoinvoke"]) : undefined
  const autoinvoke = invoke ?? (booleanValue(doc.data["disable-model-invocation"]) ? false : undefined)
  return [{ id, name, description, content: doc.body, path: source, ...(autoinvoke !== undefined && { autoinvoke }) }]
}

function skills(files: string[]) {
  return [...new Map(files.flatMap(skillInfo).map((skill) => [skill.id, skill])).values()]
}

function steeringSources(files: string[]) {
  const paths = new Set<string>(), parts: string[] = []
  for (const file of files) {
    const id = real(file)
    if (!id || paths.has(id)) continue
    paths.add(id)
    const doc = document(file)
    if (doc && doc.data.inclusion !== "manual") parts.push(`Instructions from: ${file}\n${doc.body}`)
  }
  return { paths, text: parts.join("\n\n") }
}

function inheritedFile(file: string) {
  return path.basename(file) === "AGENTS.md" || file.split(path.sep).join("/").includes("/.kiro/steering/")
}

function promptFiles(files: string[], steering: ReadonlySet<string>) {
  const selected = new Map<string, string>()
  for (const file of files) {
    const id = real(file)
    if (!id || steering.has(id) || inheritedFile(file) || inheritedFile(id)) continue
    if (!selected.has(id)) selected.set(id, file)
  }
  return [...selected.values()]
}

function definition(file: string) {
  if (file.endsWith(".md")) return document(file)
  const data = json(file)
  if (record(data)) return { data, body: data.prompt }
}

function prompt(source: string, file: string, home: string) {
  const body = source.trim()
  if (!body.startsWith("file://")) return body
  const target = absolute(body.slice(7), path.dirname(file), home)
  return stat(target)?.isFile() ? read(target)?.trim() : undefined
}

function agent(file: string, directory: string, home: string, steering: ReadonlySet<string>): KiroAgent[] {
  const doc = definition(file)
  if (!doc || !profile(doc.data)) return []
  const config = doc.data, name = config.name ?? path.basename(file, path.extname(file))
  const body = prompt(text(doc.body) ? doc.body : "", file, home)
  if (body === undefined) return []
  const resources = (scheme: string) => (config.resources ?? []).filter(text)
    .filter((uri) => uri.startsWith(scheme)).flatMap((uri) => expand(uri.slice(scheme.length), directory, home))
  const files = promptFiles(resources("file://"), steering)
  const instructions = files.length ? "Read these files before you start:\n" + files.map((f) => `- ${f}`).join("\n") : ""
  return [{ name, config, system: [body, instructions, toolNote].filter(Boolean).join("\n\n"), skills: skills(resources("skill://")) }]
}

function mcpSettings(file: string): Record<string, KiroServer> {
  const data = json(file)
  if (!record(data) || !record(data.mcpServers)) return {}
  return Object.fromEntries(Object.entries(data.mcpServers).filter((entry): entry is [string, KiroServer] => server(entry[1])))
}

export function discover(directory: string) {
  const home = process.env.HOME || homedir(), root = path.join(home, ".kiro")
  const steering = steeringSources(expand("steering/**/*.md", root, home))
  const agents = expand("agents/*.{json,md}", root, home).flatMap((file) => agent(file, directory, home, steering.paths))
  return {
    agents, steering: steering.text, skills: skills(expand("skills/**/SKILL.md", root, home)),
    mcpServers: mcpSettings(path.join(root, "settings", "mcp.json")),
  }
}
