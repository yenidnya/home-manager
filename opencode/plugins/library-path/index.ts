/** Gives OpenCode's child processes the LD_LIBRARY_PATH that the nixpkgs wrapper replaced. */
import { Plugin } from "@opencode/plugin"

const inherited = "OPENCODE_INHERITED_LD_LIBRARY_PATH"

export default Plugin.define({
  id: "library-path",
  async setup() {
    const value = process.env[inherited]
    if (value === undefined) return
    delete process.env[inherited]
    // The dynamic loader read LD_LIBRARY_PATH at startup, so OpenCode keeps the libraries it needs.
    if (value) process.env.LD_LIBRARY_PATH = value
    else delete process.env.LD_LIBRARY_PATH
  },
})
