/** Codebase Memory context for tool results and compaction. */
import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import type { ToolHooks } from "@opencode/plugin/promise/tool"

const binary = join(homedir(), ".local/bin/codebase-memory-mcp")
const sessionStart = { hook_event_name: "SessionStart" } as const

type Query =
  | typeof sessionStart
  | { hook_event_name: "PostToolUse"; tool_name: "Read"; tool_input: { file_path: string } }
  | { hook_event_name: "PreToolUse"; tool_name: "Grep" | "Glob"; tool_input: { pattern: string } }
type Completed = Extract<ToolHooks["execute.after"], { status: "completed" }>

function decodeNote(stdout: string): string {
  try {
    const note = JSON.parse(stdout)?.hookSpecificOutput?.additionalContext
    return typeof note === "string" ? note : ""
  } catch {
    return ""
  }
}

function augment(cwd: string, query: Query, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      ["hook-augment"],
      {
        env: { ...process.env, CBM_LOG_LEVEL: "error" },
        signal,
        killSignal: "SIGKILL",
        maxBuffer: 256 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => resolve(error ? "" : decodeNote(stdout)),
    )
    child.stdin?.on("error", () => resolve(""))
    child.stdin?.end(JSON.stringify({ ...query, cwd }))
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readQuery(path: unknown): Query[] {
  if (typeof path !== "string" || !path) return []
  return [{ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path } }]
}

function searchQuery(name: "Grep" | "Glob", pattern: unknown): Query[] {
  if (typeof pattern !== "string") return []
  return [{ hook_event_name: "PreToolUse", tool_name: name, tool_input: { pattern } }]
}

function queriesFor(tool: unknown, input: unknown): Query[] {
  if (!record(input)) return []
  if (tool === "read") return readQuery(input.path)
  if (tool === "grep") return searchQuery("Grep", input.pattern)
  if (tool === "glob") return searchQuery("Glob", input.pattern)
  return []
}

function queriesForResult(event: Completed): Query[] {
  if (event.tool !== "execute") return queriesFor(event.tool, event.input)
  // Code Mode gives the program structured output. Its outer result carries the completed tool calls.
  const calls: unknown = event.result.metadata?.toolCalls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call: unknown) =>
    record(call) && call.status === "completed" ? queriesFor(call.tool, call.input) : [],
  )
}

async function notesFor(cwd: string, queries: Query[]): Promise<string> {
  if (!queries.length) return ""
  const signal = AbortSignal.timeout(10_000)
  const notes: string[] = []
  for (const query of queries) {
    if (signal.aborted) break
    const note = await augment(cwd, query, signal)
    if (note) notes.push(note)
  }
  return notes.join("\n")
}

function modelContent({ content, output }: Completed["result"]) {
  if (typeof content === "string" || content?.length) return content
  if (typeof output === "string") return output
}

async function appendNotes(cwd: string, event: Completed, seen: Set<string>): Promise<void> {
  const content = modelContent(event.result)
  if (content === undefined) return
  const queries = queriesForResult(event)
  if (!seen.has(event.sessionID)) {
    seen.add(event.sessionID)
    queries.unshift(sessionStart)
  }
  const extra = await notesFor(cwd, queries)
  if (!extra) return
  event.result = {
    ...event.result,
    content: typeof content === "string" ? `${content}\n${extra}` : [...content, { type: "text", text: extra }],
  }
}

async function registerToolNotes(ctx: Plugin.Context) {
  const seen = new Set<string>()
  const turns = new Map<string, { messageID: string; calls: Set<string> }>()
  // A direct model call can finish with codemode=true. Nested calls deliver their notes through the outer execute result.
  await ctx.tool.hook("execute.before", ({ sessionID, messageID, id, codemode }) => {
    if (codemode) return
    const turn = turns.get(sessionID)
    if (turn?.messageID === messageID) turn.calls.add(id)
    else turns.set(sessionID, { messageID, calls: new Set([id]) })
  })
  await ctx.tool.hook("execute.after", async (event) => {
    const direct = turns.get(event.sessionID)?.calls.delete(event.id)
    if (event.status !== "completed" || (event.codemode && !direct)) return
    await appendNotes(ctx.location.directory, event, seen)
  })
}

export default Plugin.define({
  id: "codebase-memory-augment",
  async setup(ctx) {
    await registerToolNotes(ctx)
    await ctx.session.hook("compaction", async (event) => {
      const note = await notesFor(ctx.location.directory, [sessionStart])
      if (note) event.system.push({ type: "text", text: note })
    })
  },
})
