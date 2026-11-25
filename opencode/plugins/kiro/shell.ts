/** Kiro shell rules and settings, matched against the whole command as Kiro matches them. */
import { shellRules } from "./permissions"
import type { KiroConfig } from "./sources"

type Effect = "allow" | "ask" | "deny"
type Rule = { effect: Effect; match?: readonly string[]; exclude?: readonly string[] }
export type ShellPolicy = { rules: Rule[]; allowed: RegExp[]; denied: RegExp[]; denyByDefault: boolean }

const rank: Record<Effect, number> = { allow: 0, ask: 1, deny: 2 }
const everything = /^[\s\S]*$/

function regex(pattern: string) {
  try {
    return new RegExp(`^(?:${pattern})$`, "s")
  } catch {
    return undefined
  }
}

function glob(pattern: string) {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "s")
}

function applies(rule: Rule, command: string) {
  const hit = (patterns: readonly string[]) => patterns.some((pattern) => glob(pattern).test(command))
  return hit(rule.match ?? ["*"]) && !hit(rule.exclude ?? [])
}

function strictest(effects: (Effect | undefined)[]) {
  const defined = effects.filter((effect) => effect !== undefined)
  return defined.length ? defined.reduce((a, b) => (rank[b] > rank[a] ? b : a)) : undefined
}

export function shellPolicy(config: KiroConfig): ShellPolicy {
  const settings = ["shell", "execute_bash"].map((name) => config.toolsSettings?.[name]).filter((s) => s !== undefined)
  return {
    rules: shellRules(config),
    allowed: settings.flatMap((s) => s.allowedCommands ?? []).flatMap((p) => regex(p) ?? []),
    // A denied pattern that does not compile still has to deny, so it denies every command.
    denied: settings.flatMap((s) => s.deniedCommands ?? []).map((p) => regex(p) ?? everything),
    denyByDefault: settings.some((s) => s.denyByDefault === true),
  }
}

function settingsEffect(policy: ShellPolicy, command: string): Effect | undefined {
  if (policy.denied.some((pattern) => pattern.test(command))) return "deny"
  if (policy.allowed.some((pattern) => pattern.test(command))) return "allow"
  return policy.denyByDefault ? "deny" : undefined
}

/** The most restrictive of Kiro's rules and settings; undefined leaves OpenCode's approval prompt in place. */
export function shellDecision(policy: ShellPolicy, command: string): "allow" | "deny" | undefined {
  const text = command.trim()
  const ruled = strictest(policy.rules.filter((rule) => applies(rule, text)).map((rule) => rule.effect))
  const effect = strictest([ruled, settingsEffect(policy, text)])
  return effect === "ask" ? undefined : effect
}
