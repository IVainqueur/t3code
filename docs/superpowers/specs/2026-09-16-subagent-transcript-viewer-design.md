# Subagent transcript viewer — design

Status: approved by user, not yet implemented.

## Problem

When Claude Code spawns a subagent (its `Task` tool), T4 Code today only
surfaces a summarized lifecycle for it (`task.started`/`task.progress`/
`task.updated`/`task.completed`, folded into the parent thread's
`OrchestrationThreadActivity` rows) via the read-only `AgentsPanel.tsx`. The
subagent's own text/thinking narration is explicitly discarded by
`ClaudeAdapter.ts` (~line 2696, comment: "Subagent-owned stream traffic ...
must not write into the parent transcript"), and its tool calls are
attributed but not presented as one coherent transcript.

Users want to see a subagent's full work as a browsable transcript —
during the run and afterward — without it crowding the sidebar once
finished.

## Scope for this v1

- **Provider:** Claude only. A feasibility recon (three Explore passes over
  `apps/server/src/provider/Layers/*`, not preserved as its own document)
  found Claude and Codex are the only providers with native subagent
  granularity worth building on, and Claude has the cleanest per-subagent
  attribution (`parent_tool_use_id`) already flowing through the adapter.
  Codex, OpenCode, Cursor, Grok, and Antigravity are out of scope for v1;
  their subagents (if the provider has the concept at all) continue to show
  only the existing summarized lifecycle, unchanged.
- **View-only.** No interrupt, no mid-task clarification. Claude has a
  single shared input queue per session with no per-subagent address —
  interrupting or steering would necessarily hit the whole session, not
  just one subagent. Rather than ship a misleading "interrupt this agent"
  control, v1 ships transcript viewing only. Interaction can be revisited
  later if a real per-agent channel ever exists.
- **Settling, not deleting.** A finished subagent doesn't disappear; it can
  be manually hidden from the sidebar's nested list ("settled") without
  losing its transcript, and un-hidden from the Agents panel.

## Data model & events

Add one new event type in `packages/contracts` (alongside the existing
`task.*` events in `providerRuntime.ts`):

```
task.transcriptAppended: {
  taskId: RuntimeTaskId
  ordinal: number          // monotonic per taskId, for ordered replay
  kind: "text" | "thinking" | "tool_use" | "tool_result"
  content: <same payload shapes existing message content blocks use>
  timestamp: DateTime
}
```

And a settle/unsettle pair, following the same command → decider → event
pattern as every other state change in the system:

```
task.settled:   { taskId: RuntimeTaskId }
task.unsettled: { taskId: RuntimeTaskId }
```

The subagent's projected record (wherever `task.*` lifecycle events are
currently folded, e.g. `ProviderRuntimeIngestion.ts`) gains:

- `settled: boolean` (default `false`)
- an ordered transcript (folded from `task.transcriptAppended`, keyed by
  `taskId`)

No new `ThreadId` hierarchy is introduced. A subagent is not a thread; it
remains scoped to its parent `ThreadId`, just with a richer persisted
record than today's lifecycle-only activity row.

## Adapter change (`ClaudeAdapter.ts`)

Where the adapter currently branches on `parent_tool_use_id`/the
`taskAgents`/`ClaudeTaskAgentState` map to attribute subagent-owned chunks:

- Today: text/thinking deltas are dropped; tool_use/tool_result blocks are
  kept and attributed elsewhere.
- New: every subagent-owned chunk (text, thinking, tool_use, tool_result)
  is appended, in arrival order, to that task's transcript buffer and
  emitted as `task.transcriptAppended`. The existing `task.started`/
  `progress`/`updated`/`completed` lifecycle events are unchanged — they
  still drive the Agents panel's summary row (status, elapsed, tokens).

This is a forwarding change, not a protocol change — the data already
exists in Claude's SDK stream; today's adapter throws it away.

## Read model / projector

New projection keyed by `taskId`: ordered transcript entries + the
existing lifecycle status + `settled`. This is exposed as a query the
client fetches lazily when a user actually opens a subagent's detail view
— it is not pushed to every connected client by default, to avoid
websocket traffic for subagents nobody is looking at (per AGENTS.md's
performance guidance on WS payload size).

## UI

**Sidebar.** A thread row that has subagents shows a collapsible nested
list of subagent rows (role + status), reusing the existing
`hasSubagents`/`RuntimeSubagent` derivation in
`packages/client-runtime/src/state/subagentRuntime.ts`. The list includes
completed subagents, not just live ones. Rows with `settled: true` are
filtered out of this list by default. A hover action on each row lets the
user settle it — this is the only place settle happens.

**Agents panel (`AgentsPanel.tsx`).** Keeps its existing summary rows,
now clickable, and shows _all_ subagents regardless of `settled` state —
settled rows are visually deemphasized but still present. This is the only
place the reverse action (**unsettle**) lives.

**Subagent detail view.** Clicking a subagent row (from either the
sidebar or the Agents panel) swaps the main pane into a dedicated,
thread-like reader over that subagent's transcript, reusing the existing
message-content-block renderers (text/thinking/tool_use/tool_result)
rather than new ones. A breadcrumb links back to the parent thread. This
view is available for settled subagents too (settling only affects the
sidebar's nested list, never the transcript itself or the Agents panel).

## Out of scope / explicitly deferred

- Interrupt or mid-task input targeted at a specific subagent (no channel
  exists for Claude; Codex has one internally but it isn't exposed through
  `ProviderAdapter`/`ProviderService` today).
- Any provider other than Claude.
- Auto-unsettling a subagent (v1 subagents are terminal/non-interactive
  once complete, so there's no "becomes active again" case to reverse
  automatically).
- Bulk "settle all" — v1 is per-row only.

## Testing

- **Server:** an adapter test that feeds a synthetic Claude SDK stream
  containing a nested `Task` tool call, asserting `task.transcriptAppended`
  events are emitted with correct `ordinal`/`kind`/`taskId` ordering, and
  that the projected transcript is correct after a projector replay (not
  just from the live fold).
- **Web:** a test asserting a completed, non-settled subagent renders as a
  nested clickable row in the sidebar; a test that settling removes it
  from that list while it remains visible/clickable in the Agents panel; a
  test that the subagent detail view renders each transcript block kind
  correctly. Per AGENTS.md, these test observable behavior, not prop/
  callback wiring.
