import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

/**
 * Sidebar nesting shows the live/settled roster minus whatever the user has
 * dismissed. Order is preserved — the caller already sorted (firstSeenAt),
 * and dismissal must not reshuffle the rows that remain.
 */
export function visibleSubagentsForSidebar(
  agents: ReadonlyArray<RuntimeSubagent>,
): ReadonlyArray<RuntimeSubagent> {
  return agents.filter((agent) => !agent.dismissed);
}
