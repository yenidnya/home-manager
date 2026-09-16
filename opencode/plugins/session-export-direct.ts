// Opencode TUI plugin. Exports the active session transcript as markdown
// and opens it in $EDITOR.
//
// Bound to ctrl+e (and the /export-quick slash). Drops thinking, tool
// details, and assistant metadata — text-only transcript. The file is
// written to /tmp and persists after the editor exits so it can be
// referenced from other sessions; clean up the dated /tmp/*.md exports
// manually when you want to reclaim space.
//
// The original dialog command remains reachable via /export.

import path from "node:path"
import { writeFile } from "node:fs/promises"

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

type Opts = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

function formatTranscript(
  session: any,
  items: Array<{ info: any; parts: any[] }>,
  opts: Opts,
): string {
  let out = `# ${session.title ?? "Session"}\n\n`
  out += `**Session:** \`${session.id}\`\n`
  if (session.time?.created) {
    out += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  }
  if (session.time?.updated) {
    out += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n`
  }
  out += `\n---\n\n`

  for (const { info, parts } of items) {
    if (info.role === "user") {
      out += `## User\n\n`
    } else {
      out += opts.assistantMetadata
        ? `## Assistant (${info.modelID ?? "unknown"})\n\n`
        : `## Assistant\n\n`
    }

    for (const p of parts) {
      if (p.type === "text" && !p.synthetic) {
        out += `${p.text}\n\n`
      } else if (p.type === "reasoning" && opts.thinking) {
        out += `_Thinking:_\n\n${p.text}\n\n`
      } else if (p.type === "tool") {
        out += `**Tool: ${p.tool}**\n\n`
        if (opts.toolDetails) {
          if (p.state?.input) {
            out += `**Input:**\n\`\`\`json\n${JSON.stringify(p.state.input, null, 2)}\n\`\`\`\n\n`
          }
          if (p.state?.status === "completed" && p.state.output) {
            out += `**Output:**\n\`\`\`\n${p.state.output}\n\`\`\`\n\n`
          }
          if (p.state?.status === "error" && p.state.error) {
            out += `**Error:**\n\`\`\`\n${p.state.error}\n\`\`\`\n\n`
          }
        }
      }
    }
    out += `---\n\n`
  }

  return out
}

async function openInEditor(api: any, filepath: string): Promise<void> {
  const editorEnv = process.env.VISUAL ?? process.env.EDITOR ?? "vim"
  const parts = editorEnv.split(/\s+/).filter(Boolean)
  if (!parts.length) return

  api.renderer.suspend()
  api.renderer.currentRenderBuffer?.clear()
  try {
    const proc = Bun.spawn([...parts, filepath], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
  } finally {
    api.renderer.currentRenderBuffer?.clear()
    api.renderer.resume()
    api.renderer.requestRender?.()
  }
}

const tui = async (api: any) => {
  api.keymap.registerLayer({
    priority: 9999,
    commands: [
      {
        namespace: "palette",
        name: "session.export.quick",
        title: "Export session transcript (no dialog)",
        category: "Session",
        slashName: "export-quick",
        async run() {
          const route = api.route.current
          if (route?.name !== "session") return
          const sessionID = route.params?.sessionID as string | undefined
          if (!sessionID) return

          const session = api.state.session.get(sessionID)
          if (!session) {
            api.ui.toast({
              message: "No active session to export",
              variant: "error",
            })
            return
          }

          const messages = api.state.session.messages(sessionID) ?? []
          const items = messages.map((m: any) => ({
            info: m,
            parts: api.state.part(m.id) ?? [],
          }))

          const transcript = formatTranscript(session, items, {
            thinking: false,
            toolDetails: false,
            assistantMetadata: false,
          })

          const filepath = path.join(
            "/tmp",
            `${formatDate(new Date())}-${slugify(session.title ?? "")}.md`,
          )
          await writeFile(filepath, transcript)
          await openInEditor(api, filepath)
          api.ui.toast({
            message: `Exported to ${filepath}`,
            variant: "info",
          })
        },
      },
    ],
    bindings: [{ key: "ctrl+e", cmd: "session.export.quick" }],
  })
}

export default { id: "session-export-direct", tui }
