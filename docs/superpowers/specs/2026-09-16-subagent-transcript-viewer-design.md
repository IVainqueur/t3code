# Subagent transcript viewer — design

Status: approved by user, not yet implemented.

## Problem

When Claude Code spawns a subagent (its `Task` tool), T4 Code today only
surfaces a summarized lifecycle for it (`task.started`/`task.progress`/
`task.updated`/`task.completed`, folded into the parent thread's
`OrchestrationThreadActivity` rows) via the read-only `AgentsPanel.tsx`. The
subagent's own text/thinking narration is explicitly discarded by
`ClaudeAdapter.ts` (`handleStreamEvent`, ~lines 2687-2711, dropping
`text_delta`/`thinking_delta` content for any chunk carrying a non-null
`parent_tool_use_id`). Its tool calls are attributed (`agentId`/
`parentToolUseId` on the `ToolInFlight` record, ~lines 2916-2934) and do
reach the normal event stream under a "quiet-timeline guarantee" — but
today that attribution is used to filter them **out** of the main chat
client-side, not to assemble them into their own coherent transcript
anywhere.

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
- **View-only, deliberately — including no whole-session fallback.**
  No interrupt, no mid-task clarification. Claude has a single shared
  input queue per session with no per-subagent address — interrupting or
  steering would necessarily hit the whole session, not just one
  subagent. We explicitly considered and rejected a half-measure — an
  honestly-labeled "stop the whole session" button surfaced from the
  subagent detail view — because it does not act on the subagent the
  user is looking at, it acts on something else entirely, and a
  view-focused surface is the wrong place to introduce a
  destructive whole-session action. v1 ships transcript viewing only.
  Interaction can be revisited later if a real per-agent channel ever
  exists.
- **Dismissing, not deleting.** A finished subagent doesn't disappear; it
  can be manually hidden from the sidebar's nested list ("dismissed")
  without losing its transcript, and restored from the Agents panel. This
  is deliberately named "dismissed"/"restored" rather than "settled" —
  `subagentRuntime.ts` already uses "settled"/`isTerminalSubagentStatus`
  to mean _terminal run status_ (completed/failed/cancelled/interrupted),
  which is a different axis than "hidden from the sidebar." Reusing that
  word for a new, orthogonal flag on the same objects would be a real
  source of bugs and confusing UI copy.
- **Web/desktop only; mobile is explicitly out, not silently skipped.**
  The new server-side data (events, projection) is provider/runtime-layer
  and reaches `packages/client-runtime`, which mobile also depends on —
  so nothing here blocks mobile from getting this later. But the sidebar
  nesting and detail-view UI in this spec are web/desktop-shaped
  (`Sidebar.tsx`, `AgentsPanel.tsx`) and mobile has its own separate
  navigation model per AGENTS.md. Building a mobile-appropriate entry
  point is deferred to a follow-up, not bundled into this v1.
- **One nesting level assumed.** This spec assumes a subagent does not
  itself spawn a further nested subagent. If Claude's protocol ever
  produces that, v1's behavior is best-effort/unspecified (likely: the
  deeper events get attributed to the outer `taskId`) — this is a known
  gap, not a verified guarantee, and isn't covered by the testing plan
  below.

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

And a dismiss/restore pair, following the same command → decider → event
pattern as every other state change in the system:

```
task.dismissed: { taskId: RuntimeTaskId }
task.restored:  { taskId: RuntimeTaskId }
```

(Named to avoid colliding with `subagentRuntime.ts`'s existing use of
"settled" for terminal run status — see Scope above.)

The subagent's projected record (wherever `task.*` lifecycle events are
currently folded, e.g. `ProviderRuntimeIngestion.ts`) gains:

- `dismissed: boolean` (default `false`) — orthogonal to run status;
  a subagent can be terminal-and-not-dismissed or terminal-and-dismissed
- an ordered transcript (folded from `task.transcriptAppended`, keyed by
  `taskId`)

No new `ThreadId` hierarchy is introduced. A subagent is not a thread; it
remains scoped to its parent `ThreadId`, just with a richer persisted
record than today's lifecycle-only activity row.

`ordinal` is assigned and persisted server-side as each event is
appended, so it is stable across client reconnects — a client resuming
mid-run re-fetches the full ordered transcript from the projection (the
source of truth) rather than replaying whatever live deltas it missed,
so there is no dedup/gap-filling logic needed client-side.

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
existing lifecycle status + `dismissed`. Opening a subagent's detail view
does two things, not one: (1) a one-shot fetch of the current transcript,
so it renders immediately; (2) if the subagent is still running, the
client also subscribes to live `task.transcriptAppended` updates for that
specific `taskId`, torn down when the view closes or the subagent
completes — the same "don't lie about live state" bar the rest of the
app holds itself to for an in-progress thread. Subagents whose detail
view nobody has open are not pushed anything, so idle fan-outs don't cost
websocket traffic.

## UI

**Sidebar — new UI, not a reuse.** There is no existing subagent
presence in `Sidebar.tsx`/`components/sidebar/` today; this is new
surface, not an extension of something already there. It will read from
the same `RuntimeSubagent`/`deriveAgentPanelModel` fold that
`AgentsPanel.tsx` already uses (`packages/client-runtime/src/state/
subagentRuntime.ts`), plus the new `dismissed` flag, but the sidebar
rendering itself — a collapsible nested list of subagent rows (role +
status) under a thread row — is built from scratch. The list includes
completed subagents, not just live ones. Rows with `dismissed: true` are
filtered out of this list by default. A hover action on each row lets the
user dismiss it — this is the only place dismiss happens.

**Agents panel (`AgentsPanel.tsx`).** Keeps its existing summary rows,
now clickable, and shows _all_ subagents regardless of `dismissed`
state — dismissed rows are visually deemphasized but still present. This
is the only place the reverse action (**restore**) lives.

**Subagent detail view.** Clicking a subagent row (from either the
sidebar or the Agents panel) swaps the main pane into a dedicated,
thread-like reader over that subagent's transcript, reusing the existing
message-content-block renderers (text/thinking/tool_use/tool_result)
rather than new ones. A breadcrumb links back to the parent thread. This
view is available for dismissed subagents too (dismissing only affects
the sidebar's nested list, never the transcript itself or the Agents
panel).

## Out of scope / explicitly deferred

- Interrupt or mid-task input targeted at a specific subagent (no channel
  exists for Claude; Codex has one internally but it isn't exposed through
  `ProviderAdapter`/`ProviderService` today), including the whole-session
  fallback button considered and rejected above.
- Any provider other than Claude.
- Mobile UI (backend data is shared via `packages/client-runtime`, but
  the sidebar/panel UI in this spec is web/desktop only).
- Subagent-of-subagent nesting beyond one level (unverified whether
  Claude's protocol can even produce this).
- Auto-restoring a dismissed subagent (v1 subagents are terminal/
  non-interactive once complete, so there's no "becomes active again"
  case to reverse automatically).
- Bulk "dismiss all" — v1 is per-row only.

## Testing

- **Server:** an adapter test that feeds a synthetic Claude SDK stream
  containing a nested `Task` tool call, asserting `task.transcriptAppended`
  events are emitted with correct `ordinal`/`kind`/`taskId` ordering, and
  that the projected transcript is correct after a projector replay (not
  just from the live fold).
- **Web:** a test asserting a completed, non-dismissed subagent renders as
  a nested clickable row in the sidebar; a test that dismissing removes it
  from that list while it remains visible/clickable in the Agents panel; a
  test that the subagent detail view renders each transcript block kind
  correctly; a test that opening the detail view of a still-running
  subagent reflects a subsequent `task.transcriptAppended` update (the
  live-subscription behavior, not just the initial fetch). Per AGENTS.md,
  these test observable behavior, not prop/callback wiring.
