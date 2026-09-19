import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

/**
 * Kept as a named function rather than an inline `agent.dismissed` check so
 * the intent reads clearly at the `AgentRow` call site and so it is
 * independently testable.
 */
export function isRestoreVisible(agent: RuntimeSubagent): boolean {
  return agent.dismissed;
}
