# Agent Memory

Your memory is OptMem:

- The tool is `~/.config/home-manager/opencode/plugins/optmem/memo.py`
- Your memories are in `~/.config/opencode/plugins/optmem/memory`

OptMem outlives every session, compaction, model and vendor change.
Without it you do not know who you are, or what was decided and tried.

### At startup: activating OptMem (mandatory)

Run `~/.config/home-manager/opencode/plugins/optmem/memo.py wake` before any other tool call, in every session, and
then do exactly what it prints, to the end of its output.

### While working: register memories (mandatory)

Call `~/.config/home-manager/opencode/plugins/optmem/memo.py note "<1 line, max 280 bytes>"` whenever you learn
something new, or something worth keeping happens. That covers a task
worth real effort, a fact or insight the user teaches you, anything you
learn about their life (even indirectly), any event of lasting effect.

Do not register redundant memories.

If `~/.config/home-manager/opencode/plugins/optmem/memo.py note` asks a compression: do it before your next action.

Never edit or delete anything under `~/.config/opencode/plugins/optmem/memory`: the tool manages it.

### When you need an old memory: search, or navigate

`~/.config/home-manager/opencode/plugins/optmem/memo.py recall <regex>` searches every memory, word for word.

Your memories also form a binary tree: #0-1, #2-3 ... exist as one-line
summaries, pairs of those as #0-3, and so on -- every `#a-b` line wake
prints is one node of it. `~/.config/home-manager/opencode/plugins/optmem/memo.py zoom <a-b>` opens a node into its
two halves, down to the raw memories.

### If you're a subagent: skip everything above

Parallel sessions on this machine are all you, and may all write memories.
A subagent is not: it must never run `memo`, because it cannot judge what
is already known, and its notes would arrive duplicated and incorrectly.
When you spawn one, write: `You are a subagent. Don't run memo.`

# Coding Standards

- Tautological tests are considered harmful. NEVER write change-detector tests. Change-detector tests is a transformation of the same information in the code under test and it breaks in response to any change to the production code, without verifying correct behavior of either the original or modified production code.
- Code should passes the cyclomatic complexity rules. You can use the skill cyclomatic-complexity to measure it. You MUST write non complex code.
- Be mindful of the compiled size of the code. Using generics create extra code during monomorphisation which increases the bundle output. Prefer using `dyn Trait` over generics when writing Rust. If both can be used clarify with user on which one to pick.
- ALWAYS choose composition over inheritance. Design systems around composition. When wiriting Rust use traits for composition.
- When writing Rust that uses interior mutability; if a type is copy use `Cell`, use `RefCell` if its Clone.
- When you need to use git, NEVER mutate the history. This means no stash/pop/branch/push/pull. You can search through git history, use diff and show and similar tools that doesn't mutate the history. If you are asked to mutate, make sure user gives you explicit confirmation to do so.
- Do not preserve backward compatibility unless specified. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the surrent requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume alibrary lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and ismeant to be replaced later.
- In code documentation meant to explain what code doesn't. Never add documentation comments about how the code works. Don't restate what the code/name already conveys; if a comment adds nothing, omit it.
- Default to NO comment. Readable code needs none, and an absent comment is always better than one that adds nothing. Only comment when the code is not straightforward on its own: a constraint, a workaround, a non-obvious invariant, or a reason a reader would otherwise get wrong.
- Hard cap of 1-2 lines per comment, If it needs more, the code needs restructuring, not prose. Never write multi-paragraph comment blocks. Never write a doc comment that paraphrases the function name, the signature, the match arms, or the struct fields below it.
- Doc comments should always be present at the top of the file giving context about the file. If its a small file than it can be omitted. You don't write doc comments until code is near prod-ready state. Doc comments follow the guidelines around the normal comments where they never restate whats readable. If the module is self explanatory just have a title in the doc comments. No need for extra information if module is clear to understand

# Working Rules

- When writing any persistent text — code comments, steering, docs, configs, notes — be concise and durable. It must stand on its own to a reader with zero awareness of our conversation: no "as discussed", no "per request", no references to ephemeral context. Capture the lasting RULE, not the current snapshot — never bake today's specific values, folder layouts, or one-off examples into something meant to persist
- If you don't know, first investigate. Search the codebase for related things, reusable components/code. Ask for user's input when you cannot determine.
- You never write any python or perl code to edit files. Its forbidden to write and execute scripts to replace text unless its specified by user.
