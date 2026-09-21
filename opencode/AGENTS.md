<!-- codebase-memory-mcp:start -->
# Codebase Memory

## Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.

### Priority Order
1. `search_graph` — find functions, classes, routes, variables by pattern
2. `trace_path` — trace who calls a function or what it calls
3. `get_code_snippet` — read specific function/class source code
4. `check_index_coverage` — validate candidate paths and missed ranges before claims
5. `query_graph` — run Cypher queries for complex patterns
6. `get_architecture` — high-level project summary

### Evidence tiers
- **Scout (Tier 1):** quick positive lookup with few calls and targeted source checks. Mark it provisional; do not make negative or exhaustive claims.
- **Verify (Tier 2, default):** task-directed graph evidence, relevant trace directions, exact snippets for material claims, and relevant pagination.
- **Auditor (Tier 3):** bounded-scope full verification with current generation, complete relevant pagination, both call directions and broader relationships when material, and every limitation disclosed.
- After candidate paths are known in any tier, call `check_index_coverage` once with every evidence path. Add relevant scopes for negative or exhaustive claims. A clean result means no recorded gap, not proof of completeness. For partial, skipped, excluded, stale, pending, or unknown coverage, read/grep the reported ranges or scope before relying on graph results.

### When to fall back to grep/glob
- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

### Examples
- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`

### Session resets and subagents
- At session start or after compaction, confirm the nearest graph project and generation with `list_projects` or `index_status`, then choose Scout, Verify, or Auditor.
- Before spawning a subagent, query the graph and coverage in the parent. Pass the tier, project, generation/freshness, bounded scope, queries and pagination state, qualified symbols, paths, call-chain findings, coverage evidence with ranges/reasons, source fallback already performed, and unresolved questions in the delegated task context.
- Do not assume subagents inherit MCP access or the parent conversation. If a child lacks MCP tools, it must not call or claim MCP access. It should use the supplied evidence and read/grep exact source, especially every reported missed-coverage range.
<!-- codebase-memory-mcp:end -->

# Coding Standards

- Tautological tests are considered harmful. NEVER write change-detector tests. Change-detector tests is a transformation of the same information in the code under test and it breaks in response to any change to the production code, without verifying correct behavior of either the original or modified production code.
- Code should passes the cyclomatic complexity rules. You can use the skill cyclomatic-complexity to measure it. You MUST write non complex code.
- Be mindful of the compiled size of the code. Using generics create extra code during monomorphisation which increases the bundle output. Prefer using `dyn Trait` over generics when writing Rust. If both can be used clarify with user on which one to pick.
- ALWAYS choose composition over inheritence. Design systems around composition. When wiriting Rust use traits for composition.
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

# Memory

- When writing any persistent text — code comments, steering, docs, configs, notes — be concise and durable. It must stand on its own to a reader with zero awareness of our conversation: no "as discussed", no "per request", no references to ephemeral context. Capture the lasting RULE, not the current snapshot — never bake today's specific values, folder layouts, or one-off examples into something meant to persist
- If you don't know, first investigate. Search the codebase for related things, reusable components/code. Ask for user's input when you cannot determine.
- You never write any python or perl code to edit files. Its forbidden to write and execute scripts to replace text unless its specified by user.
