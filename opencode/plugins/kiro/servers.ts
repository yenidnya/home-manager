/** Kiro MCP server definitions placed into the OpenCode MCP registry. */
import path from "node:path"
import type { Mcp } from "@opencode/plugin"
import type { KiroAgent, KiroServer } from "./sources"

type ServerConfig = Mcp.ServerConfig
type Registered = readonly (readonly [string, ServerConfig])[]

function substitute(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "")]),
  )
}

function serverConfig(spec: KiroServer): ServerConfig | undefined {
  if (spec.url) return { type: "remote", url: spec.url, ...(spec.headers && { headers: substitute(spec.headers) }) }
  if (!spec.command) return undefined
  return { type: "local", command: [spec.command, ...(spec.args ?? [])], ...(spec.env && { environment: substitute(spec.env) }) }
}

function identity(config: ServerConfig) {
  if (config.type === "remote") return config.url
  return [path.basename(config.command[0] ?? ""), ...config.command.slice(1)].join(" ")
}

function enabled(servers: Record<string, KiroServer> | undefined): [string, KiroServer][] {
  return Object.entries(servers ?? {}).filter(([, spec]) => !spec.disabled)
}

// A Kiro server with a registered name or the same command reuses that server instead of starting a duplicate.
function placement(registered: Registered) {
  const known = new Map(registered.map(([name, config]) => [name, identity(config)]))
  const added = new Map<string, ServerConfig>()
  const place = (name: string, spec: KiroServer) => {
    if (known.has(name)) return name
    const config = serverConfig(spec)
    if (!config) return undefined
    const match = [...known].find(([, other]) => other === identity(config))
    if (match) return match[0]
    known.set(name, identity(config))
    added.set(name, config)
    return name
  }
  const placeAll = (entries: [string, KiroServer][]) =>
    new Map(entries.flatMap(([name, spec]) => {
      const placed = place(name, spec)
      return placed ? [[name, placed] as const] : []
    }))
  return { added, placeAll }
}

/** Servers to add, each agent's Kiro-to-registered names, and the added servers only one agent declares. */
export function resolveServers(global: Record<string, KiroServer>, agents: readonly KiroAgent[], registered: Registered) {
  const { added, placeAll } = placement(registered)
  const shared = placeAll(enabled(global))
  const sharedNames = new Set(added.keys())
  const servers = new Map(agents.map((agent) => {
    const own = placeAll(enabled(agent.config.mcpServers))
    return [agent.name, new Map([...(agent.config.includeMcpJson ? shared : []), ...own])] as const
  }))
  return { added, servers, scoped: new Set([...added.keys()].filter((name) => !sharedNames.has(name))) }
}
