/** Private Markdown transcripts for the active TUI session. */
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return slug || "untitled"
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function formatPart(part: SessionMessageAssistant["content"][number]): string {
  if (part.type === "text") return `${part.text}\n\n`
  if (part.type === "tool") return `**Tool: ${part.name}**\n\n`
  return ""
}

function formatMessage(message: SessionMessageInfo): string {
  if (message.type === "user") return `## User\n\n${message.text}\n\n---\n\n`
  if (message.type === "assistant") return `## Assistant\n\n${message.content.map(formatPart).join("")}---\n\n`
  return ""
}

async function formatTranscript(client: Plugin.Context["client"], session: SessionInfo): Promise<string> {
  const output = [
    `# ${session.title ?? "Session"}\n\n`,
    `**Session:** \`${session.id}\`\n`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}\n`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n---\n\n`,
  ]
  const query = { sessionID: session.id, limit: 100 }
  let page = await client.message.list({ ...query, order: "asc" })
  for (;;) {
    output.push(...page.data.map(formatMessage))
    if (!page.cursor.next) return output.join("")
    page = await client.message.list({ ...query, cursor: page.cursor.next })
  }
}

async function saveTranscript(client: Plugin.Context["client"], sessionID: string): Promise<string> {
  const session = await client.session.get({ sessionID })
  const text = await formatTranscript(client, session)
  const directory = await mkdtemp(join(tmpdir(), "opencode-export-"))
  const file = join(directory, `${formatDate(new Date())}-${slugify(session.title ?? "")}.md`)
  await writeFile(file, text, { flag: "wx", mode: 0o600 })
  return file
}

async function openInEditor(renderer: Plugin.Context["renderer"], file: string): Promise<void> {
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vim"
  const [command, ...args] = editor.split(/\s+/).filter(Boolean)
  if (!command) return
  await renderer.suspend()
  try {
    const child = spawn(command, [...args, file], { stdio: "inherit" })
    const [code] = await once(child, "close")
    if (code !== 0) throw new Error("Editor exited unsuccessfully")
  } finally {
    await renderer.resume()
  }
}

async function exportSession(ctx: Plugin.Context): Promise<void> {
  const route = ctx.ui.router.current()
  if (route.type !== "session") return

  let file: string | undefined
  try {
    file = await saveTranscript(ctx.client, route.sessionID)
    await openInEditor(ctx.renderer, file)
    ctx.ui.toast.show({ message: `Exported to ${file}`, variant: "info" })
  } catch {
    const message = file ? `Exported to ${file}; could not open the editor` : "Could not export the session"
    ctx.ui.toast.show({ message, variant: "error" })
  }
}

export default Plugin.define({
  id: "session-export-direct",
  setup(ctx) {
    ctx.keymap.layer(() => ({
      mode: "global",
      priority: 9999,
      enabled: () => ctx.ui.router.current().type === "session",
      commands: [
        {
          id: "session.export.quick",
          title: "Export session transcript (no dialog)",
          group: "Session",
          palette: true,
          slash: { name: "export-quick" },
          bind: "ctrl+e",
          run: () => exportSession(ctx),
        },
      ],
      bindings: ["session.export.quick"],
    }))
  },
})
