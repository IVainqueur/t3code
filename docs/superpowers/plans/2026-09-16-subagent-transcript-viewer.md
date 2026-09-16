# Subagent Transcript Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user browse a Claude Code subagent's full transcript (its narration + tool calls, which the adapter currently discards or scatters) during and after its run, via the sidebar and the Agents panel, with a manual per-subagent dismiss/restore to keep the sidebar from crowding.

**Architecture:** Two new event types feed the existing event-sourced pipeline. `task.transcriptAppended` is a provider-runtime event (emitted by `ClaudeAdapter.ts`, folded into `OrchestrationThreadActivity` rows by `ProviderRuntimeIngestion.ts`, one immutable row per event — same shape as the existing `task.started` fold). `task.dismiss`/`task.restore` are client-triggered commands that go through the decider and mutate a new `dismissedTaskIds` field on the `Thread` projection, exactly like `thread.snooze`/`thread.unsnooze` mutate `snoozedUntil` today. Client-side, `subagentRuntime.ts`'s existing activity-fold gains a `transcript` array and a `dismissed` flag on `RuntimeSubagent`. UI: a new collapsible nested list in the sidebar (dismiss action), clickable rows in the existing Agents panel (restore action for dismissed rows), and a new route + component for the subagent detail view, reached from either.

**Tech Stack:** Effect-TS / `@effect/schema` contracts, Effect `Queue`/`Effect.gen` server runtime, React + TanStack Router + Effect `Atom` state on the client, `vite-plus/test` for both server and web unit tests.

**Spec:** `docs/superpowers/specs/2026-09-16-subagent-transcript-viewer-design.md`

## Global Constraints

- Claude provider only. Do not touch Codex/Cursor/Grok/OpenCode/Antigravity adapters.
- View-only: no interrupt, no mid-task input targeted at a subagent, and no "stop the whole session" fallback button — this was explicitly rejected in the spec.
- Use "dismiss"/"restore" naming, never "settle"/"unsettle" — `subagentRuntime.ts` already uses "settled" to mean terminal run status, which is a different, orthogonal concept from "hidden from the sidebar."
- `dismissed` is per-subagent (`taskId`-keyed) and orthogonal to run status: a subagent can be terminal-and-not-dismissed or terminal-and-dismissed.
- No bulk dismiss/restore and no auto-restore in this v1.
- Mobile UI is explicitly out of scope for this plan. Do not add mobile navigation/screens.
- Assume exactly one level of subagent nesting (a subagent does not itself spawn a further nested subagent). Do not add handling for deeper nesting.
- Every new list-declutter action needs its reverse exposed somewhere in the UI (dismiss in the sidebar, restore in the Agents panel) — do not ship one without the other.

---

## Part 1 — Contracts

### Task 1: Add `task.transcriptAppended` provider runtime event

**Files:**

- Modify: `packages/contracts/src/providerRuntime.ts` (near the existing `task.*` event definitions — the type-string enum around lines 180-183, the `*Type` literal consts around lines 232-235, and wherever those combine with a payload into the exported discriminated union; use the same construction as the existing `task.started`/`task.progress`/`task.updated`/`task.completed` members)
- Test: `packages/contracts/src/providerRuntime.test.ts` (create if it doesn't already exist as a sibling test file; if a test file for this module already exists, add to it)

**Interfaces:**

- Produces: `TaskTranscriptAppendedPayload` (exported schema), event type string `"task.transcriptAppended"`, decoded shape `{ taskId: RuntimeTaskId; ordinal: number; kind: "text" | "thinking" | "tool_use" | "tool_result"; content: unknown; timestamp: string }` plus the base fields every `ProviderRuntimeEvent` carries (`eventId`, `provider`, `threadId`, `createdAt`, etc. — see `ProviderRuntimeEventBase`, lines 262-276). Later tasks (4, 5, 6, 7) consume this exact shape.

- [ ] **Step 1: Write the failing decode test**

```ts
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProviderRuntimeEvent } from "./providerRuntime.js";

describe("task.transcriptAppended", () => {
  it("decodes a valid transcript-appended event", () => {
    const decoded = Schema.decodeUnknownSync(ProviderRuntimeEvent)({
      eventId: "evt_test1",
      provider: "claude",
      threadId: "thread_test1",
      createdAt: "2026-09-16T00:00:00.000Z",
      type: "task.transcriptAppended",
      payload: {
        taskId: "task_test1",
        ordinal: 0,
        kind: "text",
        content: { text: "hello from subagent" },
        timestamp: "2026-09-16T00:00:00.000Z",
      },
    });
    expect(decoded.type).toBe("task.transcriptAppended");
  });
});
```

(Match the exact literal values `provider`/`eventId`/`threadId` expect — copy the shape used by a neighboring passing test for `task.started` if one exists in this file or a sibling test file, so required-vs-optional base fields line up with what this repo's schema actually requires.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run packages/contracts/src/providerRuntime.test.ts`
Expected: FAIL — `task.transcriptAppended` is not a recognized `type` literal, decode throws.

- [ ] **Step 3: Add the event type**

In `packages/contracts/src/providerRuntime.ts`:

1. Add `"task.transcriptAppended",` to the type-string enum/list alongside the existing `"task.started"`/`"task.progress"`/`"task.updated"`/`"task.completed"` entries (~lines 180-183).
2. Add the literal type const next to the other `Task*Type` consts (~lines 232-235):

```ts
const TaskTranscriptAppendedType = Schema.Literal("task.transcriptAppended");
```

3. Add the payload schema, near the other task payload schemas:

```ts
const TaskTranscriptEntryKind = Schema.Literal("text", "thinking", "tool_use", "tool_result");

export const TaskTranscriptAppendedPayload = Schema.Struct({
  taskId: RuntimeTaskId,
  ordinal: Schema.Number,
  kind: TaskTranscriptEntryKind,
  content: Schema.Unknown,
  timestamp: IsoDateTime,
});
```

4. Register a new member in the exported discriminated union (find where `TaskStartedType`/`TaskStartedPayload` — or the closest existing task payload, e.g. `ThreadStartedPayload` at ~lines 284-287 — are combined with `ProviderRuntimeEventBase` into one `Schema.Struct` member of the union; add a sibling member for `TaskTranscriptAppendedType`/`TaskTranscriptAppendedPayload` following the identical pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run packages/contracts/src/providerRuntime.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck the package**

Run: `./node_modules/.bin/vp run typecheck --filter packages/contracts` (or the package's own `typecheck` script if `--filter` isn't supported — check `package.json`)
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/providerRuntime.ts packages/contracts/src/providerRuntime.test.ts
git commit -m "feat(contracts): add task.transcriptAppended provider runtime event

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add `task.dismiss`/`task.restore` commands, events, and `dismissedTaskIds` on the Thread projection

**Files:**

- Modify: `packages/contracts/src/orchestration.ts` (command union ~lines 1347-1381, event payload/union area ~lines 1587-1977, and the `Thread` struct wherever `snoozedUntil` is defined as a field)
- Test: `packages/contracts/src/orchestration.test.ts` (add to existing, or create alongside other contract tests in this directory if none exists for this module)

**Interfaces:**

- Consumes: `RuntimeTaskId` from Task 1 (`packages/contracts/src/providerRuntime.ts`) — import it into `orchestration.ts`.
- Produces: `ClientOrchestrationCommand` union members `{ type: "task.dismiss"; commandId: CommandId; threadId: ThreadId; taskId: RuntimeTaskId }` and `{ type: "task.restore"; commandId: CommandId; threadId: ThreadId; taskId: RuntimeTaskId }`; event payloads `TaskDismissedPayload = { threadId: ThreadId; taskId: RuntimeTaskId; dismissedAt: string; updatedAt: string }` and `TaskRestoredPayload = { threadId: ThreadId; taskId: RuntimeTaskId; updatedAt: string }`; a `dismissedTaskIds: ReadonlyArray<RuntimeTaskId>` field added to the `Thread` schema (default `[]`). Task 3 (decider) and Task 8 (client fold) consume these exact names.

- [ ] **Step 1: Write the failing decode test**

```ts
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientOrchestrationCommand, OrchestrationEvent } from "./orchestration.js";

describe("task.dismiss / task.restore", () => {
  it("decodes a task.dismiss command", () => {
    const decoded = Schema.decodeUnknownSync(ClientOrchestrationCommand)({
      type: "task.dismiss",
      commandId: "cmd_test1",
      threadId: "thread_test1",
      taskId: "task_test1",
    });
    expect(decoded.type).toBe("task.dismiss");
  });

  it("decodes a task.dismissed event", () => {
    const decoded = Schema.decodeUnknownSync(OrchestrationEvent)({
      eventId: "evt_test2",
      aggregateKind: "thread",
      aggregateId: "thread_test1",
      occurredAt: "2026-09-16T00:00:00.000Z",
      type: "task.dismissed",
      payload: {
        threadId: "thread_test1",
        taskId: "task_test1",
        dismissedAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
    });
    expect(decoded.type).toBe("task.dismissed");
  });
});
```

(As in Task 1, copy the exact required base-event fields from a neighboring passing test for `thread.snoozed` in this same test file/module if one exists — `EventBaseFields` may require more or fewer fields than shown here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run packages/contracts/src/orchestration.test.ts`
Expected: FAIL — `task.dismiss`/`task.dismissed` are not recognized type literals.

- [ ] **Step 3: Add the commands, events, and Thread field**

In `packages/contracts/src/orchestration.ts`:

1. Import `RuntimeTaskId` from `./providerRuntime.js` (match whatever extension convention neighboring imports in this file use).
2. Add command schemas next to `ThreadSnoozeCommand`/`ThreadUnsnoozeCommand` (~lines 1097-1115):

```ts
const TaskDismissCommand = Schema.Struct({
  type: Schema.Literal("task.dismiss"),
  commandId: CommandId,
  threadId: ThreadId,
  taskId: RuntimeTaskId,
});

const TaskRestoreCommand = Schema.Struct({
  type: Schema.Literal("task.restore"),
  commandId: CommandId,
  threadId: ThreadId,
  taskId: RuntimeTaskId,
});
```

Register both in the command union, following exactly how `ThreadSnoozeCommand`/`ThreadUnsnoozeCommand` are registered (~lines 1347-1348, 1380-1381).

3. Add event payload schemas next to `ThreadSnoozedPayload`/`ThreadUnsnoozedPayload` (~lines 1693-1707):

```ts
export const TaskDismissedPayload = Schema.Struct({
  threadId: ThreadId,
  taskId: RuntimeTaskId,
  dismissedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskRestoredPayload = Schema.Struct({
  threadId: ThreadId,
  taskId: RuntimeTaskId,
  updatedAt: IsoDateTime,
});
```

Register both in the event union and the event-type-string list, following exactly how `thread.snoozed`/`thread.unsnoozed` are registered (union ~lines 1970-1977, type-string list ~lines 1587-1588).

4. Find the `Thread` schema struct (it already has `snoozedUntil`, `snoozedAt`, etc. as fields — search for `snoozedUntil:` in this file to find the struct). Add:

```ts
dismissedTaskIds: Schema.Array(RuntimeTaskId).pipe(Schema.optionalWith({ default: () => [] })),
```

(Match whatever default-value pattern the file already uses for similar optional array/collection fields — if `Schema.optionalWith({ default: ... })` isn't the established idiom here, use whichever one is; check how another optional field with a default, if any exists on `Thread`, is written.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run packages/contracts/src/orchestration.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck the package**

Run: `./node_modules/.bin/vp run typecheck --filter packages/contracts` (or package-local script)
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/orchestration.ts packages/contracts/src/orchestration.test.ts
git commit -m "feat(contracts): add task.dismiss/task.restore commands and events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part 2 — Server

### Task 3: Decider cases for `task.dismiss`/`task.restore`

**Files:**

- Modify: `apps/server/src/orchestration/decider.ts` (add cases to the same `switch` that has `case "thread.snooze":` at ~line 620 and `case "thread.unsnooze":` at ~line 690)
- Test: `apps/server/src/orchestration/decider.test.ts` (add to existing tests for this file — search for the `thread.snooze` test as the pattern to copy)

**Interfaces:**

- Consumes: `TaskDismissCommand`/`TaskRestoreCommand`/`TaskDismissedPayload`/`TaskRestoredPayload` from Task 2, `Thread.dismissedTaskIds` field from Task 2.
- Produces: decider now emits `task.dismissed`/`task.restored` events that Task 8 (client fold) will consume via the projected `Thread.dismissedTaskIds` field (Task 3 must also update the projector — see Step 3b below — so the field is actually persisted, not just emitted as an event).

- [ ] **Step 1: Write the failing test**

```ts
it.effect("task.dismiss adds the taskId to dismissedTaskIds", () =>
  Effect.gen(function* () {
    const { readModel, dispatch, threadId } = yield* setupThreadFixture(); // use whatever fixture helper the thread.snooze test above uses
    const event = yield* dispatch({
      type: "task.dismiss",
      commandId: "cmd_dismiss1",
      threadId,
      taskId: "task_abc",
    });
    expect(event.type).toBe("task.dismissed");
    expect(event.payload.taskId).toBe("task_abc");
  }),
);

it.effect("task.dismiss is idempotent when already dismissed", () =>
  Effect.gen(function* () {
    const { dispatch, threadId } = yield* setupThreadFixture();
    yield* dispatch({
      type: "task.dismiss",
      commandId: "cmd_dismiss2",
      threadId,
      taskId: "task_abc",
    });
    const second = yield* dispatch({
      type: "task.dismiss",
      commandId: "cmd_dismiss3",
      threadId,
      taskId: "task_abc",
    });
    expect(second.type).toBe("task.dismissed"); // re-emits without error, does not duplicate the id
  }),
);

it.effect("task.restore removes the taskId from dismissedTaskIds", () =>
  Effect.gen(function* () {
    const { dispatch, threadId } = yield* setupThreadFixture();
    yield* dispatch({
      type: "task.dismiss",
      commandId: "cmd_dismiss4",
      threadId,
      taskId: "task_abc",
    });
    const event = yield* dispatch({
      type: "task.restore",
      commandId: "cmd_restore1",
      threadId,
      taskId: "task_abc",
    });
    expect(event.type).toBe("task.restored");
  }),
);
```

(Use whatever the existing `thread.snooze` decider test actually calls its fixture/dispatch helper — do not invent `setupThreadFixture`/`dispatch` names if the real test file uses different ones; copy the real names.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/server/src/orchestration/decider.test.ts`
Expected: FAIL — `"task.dismiss"` is not a handled command type.

- [ ] **Step 3a: Implement the decider cases**

In `apps/server/src/orchestration/decider.ts`, add, following the exact structure of the `thread.snooze`/`thread.unsnooze` cases (using `requireThreadNotArchived`, `nowIso`, `withEventBase`):

```ts
case "task.dismiss": {
  const thread = yield* requireThreadNotArchived({ readModel, command, threadId: command.threadId });
  const occurredAt = yield* nowIso;
  const alreadyDismissed = thread.dismissedTaskIds.includes(command.taskId);
  return {
    ...(yield* withEventBase({
      aggregateKind: "thread",
      aggregateId: command.threadId,
      occurredAt,
      commandId: command.commandId,
    })),
    type: "task.dismissed",
    payload: {
      threadId: command.threadId,
      taskId: command.taskId,
      dismissedAt: alreadyDismissed ? (thread.dismissedTaskIdsDismissedAt?.[command.taskId] ?? occurredAt) : occurredAt,
      updatedAt: alreadyDismissed ? thread.updatedAt : occurredAt,
    },
  };
}

case "task.restore": {
  const thread = yield* requireThreadNotArchived({ readModel, command, threadId: command.threadId });
  const occurredAt = yield* nowIso;
  return {
    ...(yield* withEventBase({
      aggregateKind: "thread",
      aggregateId: command.threadId,
      occurredAt,
      commandId: command.commandId,
    })),
    type: "task.restored",
    payload: {
      threadId: command.threadId,
      taskId: command.taskId,
      updatedAt: occurredAt,
    },
  };
}
```

Simplify the `dismissedAt` idempotency lookup above if `Thread` doesn't track a per-task dismissedAt map — in that case just always use `occurredAt` for a fresh dismiss and skip the `alreadyDismissed` branch entirely; the important, non-negotiable behavior is: dismissing an already-dismissed task and restoring an already-restored task must both succeed without error (idempotent), matching how `thread.unsnooze` behaves today.

- [ ] **Step 3b: Fold the events into `Thread.dismissedTaskIds` in the projector**

In `apps/server/src/orchestration/projector.ts`, find where `thread.snoozed`/`thread.unsnoozed` are folded into the `Thread` read-model row (mutating `snoozedUntil`). Add analogous handling:

```ts
case "task.dismissed": {
  return {
    ...thread,
    dismissedTaskIds: thread.dismissedTaskIds.includes(event.payload.taskId)
      ? thread.dismissedTaskIds
      : [...thread.dismissedTaskIds, event.payload.taskId],
    updatedAt: event.payload.updatedAt,
  };
}

case "task.restored": {
  return {
    ...thread,
    dismissedTaskIds: thread.dismissedTaskIds.filter((id) => id !== event.payload.taskId),
    updatedAt: event.payload.updatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/server/src/orchestration/decider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/decider.ts apps/server/src/orchestration/decider.test.ts apps/server/src/orchestration/projector.ts
git commit -m "feat(server): dismiss/restore subagents via task.dismiss/task.restore

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `ClaudeAdapter.ts` — stop dropping subagent narration, emit `task.transcriptAppended`

**Files:**

- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts` (the narration-drop block at ~lines 2687-2711, and the tool_use attribution block at ~lines 2916-2936)

**Interfaces:**

- Consumes: `TaskTranscriptAppendedPayload`/`"task.transcriptAppended"` from Task 1, `offerRuntimeEvent` (existing helper, ~line 2012, `Queue.offer` on `runtimeEventQueue`).
- Produces: `task.transcriptAppended` events with a monotonically increasing `ordinal` per `taskId`. Task 5 (projector fold) and Task 6 (this adapter's own test) consume this.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`, modeled directly on the existing `it.effect("maps Claude stream/runtime messages to canonical provider runtime events", ...)` test at line 1109 (same `makeHarness()`, `Stream.take(adapter.streamEvents, N).pipe(Stream.runCollect, Effect.forkChild)`, `harness.query.emit(...)`, `Fiber.join` pattern):

```ts
it.effect(
  "emits task.transcriptAppended for subagent narration and tool calls instead of dropping them",
  () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession(/* same args the existing test uses */);
      yield* adapter.sendTurn(/* same args the existing test uses */);

      // A subagent's text narration, tagged with parent_tool_use_id like the SDK does for Task-tool children:
      harness.query.emit({
        type: "stream_event",
        parent_tool_use_id: "tool-parent-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "stream_event",
        parent_tool_use_id: "tool-parent-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Investigating the failing test..." },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const transcriptEvents = runtimeEvents.filter(
        (event) => event.type === "task.transcriptAppended",
      );

      assert.equal(transcriptEvents.length, 1);
      assert.equal(transcriptEvents[0]!.payload.kind, "text");
      assert.equal(transcriptEvents[0]!.payload.ordinal, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    ),
);
```

Fill in the `startSession`/`sendTurn` arguments and any harness setup exactly as the existing neighboring test at line 1109 does — do not invent new harness methods.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
Expected: FAIL — no `task.transcriptAppended` events are emitted (the narration is still being dropped).

- [ ] **Step 3: Implement the change**

Replace the drop-and-return block at ~lines 2687-2711:

```ts
// BEFORE (current code, to be replaced):
const streamParentToolUseId = (message as { parent_tool_use_id?: string | null })
  .parent_tool_use_id;
if (streamParentToolUseId !== null && streamParentToolUseId !== undefined) {
  const dropStart =
    event.type === "content_block_start" &&
    event.content_block.type !== "tool_use" &&
    event.content_block.type !== "server_tool_use" &&
    event.content_block.type !== "mcp_tool_use";
  const dropDelta =
    event.type === "content_block_delta" &&
    (event.delta.type === "text_delta" || event.delta.type === "thinking_delta");
  if (dropStart || dropDelta) {
    return;
  }
}
```

```ts
// AFTER:
const streamParentToolUseId = (message as { parent_tool_use_id?: string | null })
  .parent_tool_use_id;
if (streamParentToolUseId !== null && streamParentToolUseId !== undefined) {
  const owningAgentId = agentIdForParentToolUse(context.taskAgents, streamParentToolUseId);
  const narrationKind =
    event.type === "content_block_delta" && event.delta.type === "text_delta"
      ? "text"
      : event.type === "content_block_delta" && event.delta.type === "thinking_delta"
        ? "thinking"
        : null;
  if (owningAgentId !== undefined && narrationKind !== null) {
    const taskId = owningAgentId;
    const ordinal = nextTranscriptOrdinal(context.taskTranscriptOrdinals, taskId);
    const stamp = yield * runtimeEventStamp; // use whatever this file's existing helper for eventId/createdAt is actually called near line 2939
    yield *
      offerRuntimeEvent({
        type: "task.transcriptAppended",
        eventId: stamp.eventId,
        provider: "claude",
        threadId: context.threadId,
        createdAt: stamp.createdAt,
        payload: {
          taskId,
          ordinal,
          kind: narrationKind,
          content:
            event.type === "content_block_delta" && event.delta.type === "text_delta"
              ? { text: event.delta.text }
              : { thinking: (event.delta as { thinking?: string }).thinking ?? "" },
          timestamp: stamp.createdAt,
        },
      });
  }
  // Subagent narration/tool blocks still must not write into the parent
  // transcript (quiet-timeline guarantee) — only return early for the
  // kinds that don't also need a transcript emission above.
  const dropStart =
    event.type === "content_block_start" &&
    event.content_block.type !== "tool_use" &&
    event.content_block.type !== "server_tool_use" &&
    event.content_block.type !== "mcp_tool_use";
  const dropDelta =
    event.type === "content_block_delta" &&
    (event.delta.type === "text_delta" || event.delta.type === "thinking_delta");
  if (dropStart || dropDelta) {
    return;
  }
}
```

Add a small ordinal helper near the top of the file (or in a shared adapter-utils module if one already exists for similar per-task counters — check for one before adding a new one):

```ts
function nextTranscriptOrdinal(ordinals: Map<string, number>, taskId: string): number {
  const current = ordinals.get(taskId) ?? 0;
  ordinals.set(taskId, current + 1);
  return current;
}
```

Add `taskTranscriptOrdinals: Map<string, number>` to whatever per-session `context` object already holds `taskAgents`/`inFlightTools` (initialize as `new Map()` alongside those).

For the tool_use/tool_result side (the attribution block at ~lines 2916-2936): add a parallel `offerRuntimeEvent` call emitting `kind: "tool_use"` (on tool-call start, with `content: { toolName, input: toolInput }`) and `kind: "tool_result"` (wherever this file currently finalizes a subagent-attributed tool's result — search for where `ToolInFlight` records with `agentId` set are resolved/completed) immediately next to the existing attribution code, using the same `nextTranscriptOrdinal`/`offerRuntimeEvent` pattern. Do not remove the existing `agentId`/`parentToolUseId` attribution — it still drives the quiet-timeline filtering of the parent's own view; this is purely additive.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts
git commit -m "feat(server): capture subagent narration and tool calls into task.transcriptAppended

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Fold `task.transcriptAppended` into `OrchestrationThreadActivity`

**Files:**

- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` (the `runtimeEventToActivities` switch, add a case near `task.started` at ~line 608; also check and update the second ingestion site at ~lines 2123-2182 which switches on the same event types)
- Test: same file's existing test file (search for `ProviderRuntimeIngestion.test.ts`) — add a case for `task.transcriptAppended`

**Interfaces:**

- Consumes: `task.transcriptAppended` event shape from Task 1/4.
- Produces: an `OrchestrationThreadActivity` with `kind: "task.transcriptAppended"`, `id: event.eventId` (one immutable row per event — same pattern as `task.started`, not the stable-id-replace pattern `task.progress` uses), consumed by Task 8's client-side fold.

- [ ] **Step 1: Write the failing test**

```ts
it("folds task.transcriptAppended into an activity row", () => {
  const activities = runtimeEventToActivities({
    eventId: "evt_transcript1",
    provider: "claude",
    threadId: "thread_test1",
    createdAt: "2026-09-16T00:00:00.000Z",
    type: "task.transcriptAppended",
    payload: {
      taskId: "task_test1",
      ordinal: 3,
      kind: "text",
      content: { text: "hello" },
      timestamp: "2026-09-16T00:00:00.000Z",
    },
  } as ProviderRuntimeEvent); // cast/construct however neighboring tests in this file already do

  expect(activities).toHaveLength(1);
  expect(activities[0]?.kind).toBe("task.transcriptAppended");
  expect(activities[0]?.id).toBe("evt_transcript1");
  expect(activities[0]?.payload).toMatchObject({
    taskId: "task_test1",
    ordinal: 3,
    kind: "text",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
Expected: FAIL — `task.transcriptAppended` case doesn't exist, either throws or falls through to a default/empty-array case.

- [ ] **Step 3: Implement the fold**

Add to the `switch (event.type)` in `runtimeEventToActivities`, following the exact structure of the `task.started` case (~lines 608-633):

```ts
case "task.transcriptAppended": {
  return [
    {
      id: event.eventId,
      createdAt: event.createdAt,
      tone: "info",
      kind: "task.transcriptAppended",
      summary: `Subagent ${event.payload.kind} update`,
      payload: {
        taskId: event.payload.taskId,
        ordinal: event.payload.ordinal,
        kind: event.payload.kind,
        content: event.payload.content,
      },
      turnId: toTurnId(event.turnId) ?? null,
      ...maybeSequence,
    },
  ];
}
```

Then locate the second switch at ~lines 2123-2182 (the one the research pass flagged as a parallel persistence/dedup path also handling `task.started`/`task.progress`/`task.updated`/`task.completed`) and add the identical `case "task.transcriptAppended":` there too, matching whatever that switch's existing cases do differently from the first one (if it's persistence-only with no activity construction, mirror that; do not assume it's identical to Step 3 above without reading it first).

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
Expected: PASS

- [ ] **Step 5: Write and run a replay test**

Add a second test asserting the fold is deterministic when the same event is processed twice in sequence (simulating a projector replay after restart) — assert the resulting activity list has no duplicate `id`s and preserves `ordinal` order:

```ts
it("produces the same activity row when replayed", () => {
  const event = {/* same event as above */} as ProviderRuntimeEvent;
  const first = runtimeEventToActivities(event);
  const replayed = runtimeEventToActivities(event);
  expect(replayed).toEqual(first);
});
```

Run: `./node_modules/.bin/vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
git commit -m "feat(server): fold task.transcriptAppended into thread activities

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part 3 — Client runtime (shared by web today; mobile deferred)

### Task 6: Extend `RuntimeSubagent` with `dismissed` and `transcript`

**Files:**

- Modify: `packages/client-runtime/src/state/subagentRuntime.ts` (the `RuntimeSubagent` interface at lines 59-88, the activity-fold function that builds it, and `deriveAgentPanelModel`/`AgentPanelModel` at lines 683-762)
- Test: `packages/client-runtime/src/state/subagentRuntime.test.ts` (add to existing tests — search for a test that already constructs a `RuntimeSubagent` from a `task.started`/`task.progress` activity list, and copy its fixture-building pattern)

**Interfaces:**

- Consumes: `OrchestrationThreadActivity` rows with `kind: "task.transcriptAppended"` from Task 5; `Thread.dismissedTaskIds` from Task 2/3.
- Produces: `RuntimeSubagent.dismissed: boolean`, `RuntimeSubagent.transcript: ReadonlyArray<{ ordinal: number; kind: "text" | "thinking" | "tool_use" | "tool_result"; content: unknown; at: string }>`. Tasks 9, 10, 11, 12 consume these two fields.

- [ ] **Step 1: Write the failing test**

```ts
it("appends task.transcriptAppended activities to the subagent's transcript in ordinal order", () => {
  const agents = foldSubagentActivities({
    activities: [
      {
        id: "a1",
        kind: "task.started",
        createdAt: "t0",
        payload: { taskId: "task_1" },
        tone: "info",
        turnId: null,
      },
      {
        id: "a2",
        kind: "task.transcriptAppended",
        createdAt: "t1",
        payload: { taskId: "task_1", ordinal: 1, kind: "text", content: { text: "second" } },
        tone: "info",
        turnId: null,
      },
      {
        id: "a3",
        kind: "task.transcriptAppended",
        createdAt: "t1",
        payload: { taskId: "task_1", ordinal: 0, kind: "text", content: { text: "first" } },
        tone: "info",
        turnId: null,
      },
    ],
    dismissedTaskIds: [],
  }); // match this function's real name/signature from the existing fold — do not invent one

  const agent = agents.find((a) => a.id === "task_1");
  expect(agent?.transcript.map((entry) => entry.content)).toEqual([
    { text: "first" },
    { text: "second" },
  ]);
  expect(agent?.dismissed).toBe(false);
});

it("marks a subagent dismissed when its taskId is in dismissedTaskIds", () => {
  const agents = foldSubagentActivities({
    activities: [
      {
        id: "a1",
        kind: "task.started",
        createdAt: "t0",
        payload: { taskId: "task_1" },
        tone: "info",
        turnId: null,
      },
    ],
    dismissedTaskIds: ["task_1"],
  });
  expect(agents.find((a) => a.id === "task_1")?.dismissed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run packages/client-runtime/src/state/subagentRuntime.test.ts`
Expected: FAIL — `dismissedTaskIds` param doesn't exist yet, `transcript`/`dismissed` fields are `undefined`.

- [ ] **Step 3: Implement**

1. Add fields to `RuntimeSubagent` (lines 59-88):

```ts
readonly dismissed: boolean;
readonly transcript: ReadonlyArray<SubagentTranscriptEntry>;
```

Define `SubagentTranscriptEntry` near `SubagentActivityEntry` (line 42):

```ts
export interface SubagentTranscriptEntry {
  readonly ordinal: number;
  readonly kind: "text" | "thinking" | "tool_use" | "tool_result";
  readonly content: unknown;
  readonly at: string;
}
```

2. In the activity-fold function (whatever it's actually called — the existing switch that already handles `task.started`/`task.progress`/etc. to build up each `RuntimeSubagent`), add a case for `"task.transcriptAppended"` that appends a `SubagentTranscriptEntry` to that task's running list, then sort by `ordinal` before returning (or insert in sorted position — either is fine as long as the final array is ordinal-ordered, since events can arrive out of order over the wire).

3. Thread a `dismissedTaskIds: ReadonlyArray<string>` parameter through to whatever function ultimately produces the full `RuntimeSubagent[]` list, and set `dismissed: dismissedTaskIds.includes(agent.id)` per agent.

4. In `deriveAgentPanelModel` (lines 732-762), do not change `settledCount`/`liveCount` semantics — `dismissed` must not affect them, since it's orthogonal to run status per this feature's design.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run packages/client-runtime/src/state/subagentRuntime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client-runtime/src/state/subagentRuntime.ts packages/client-runtime/src/state/subagentRuntime.test.ts
git commit -m "feat(client-runtime): track subagent transcript and dismissed state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Client dispatch for `task.dismiss`/`task.restore`

**Files:**

- Modify: `packages/client-runtime/src/operations/commands.ts` (add next to `snoozeThread` at ~lines 189-197)
- Modify: `packages/client-runtime/src/state/threadCommands.ts` (wire into the facade next to `commands.snooze` at ~lines 143-147)
- Test: `packages/client-runtime/src/operations/commands.test.ts` (add next to any existing `snoozeThread` dispatch test; if none exists, model on whatever test pattern this file's other command functions use)

**Interfaces:**

- Consumes: `"task.dismiss"`/`"task.restore"` command shapes from Task 2, the shared `dispatch`/`request` helper (~lines 91-93) and `commandId` helper already used by `snoozeThread`.
- Produces: `dismissSubagentTask(input: { threadId: ThreadId; taskId: RuntimeTaskId }): CommandEffect` and `restoreSubagentTask(input: { threadId: ThreadId; taskId: RuntimeTaskId }): CommandEffect`, exposed on the `commands` facade as `commands.dismissTask`/`commands.restoreTask`. Tasks 11 and 12 (UI) consume these two facade methods.

- [ ] **Step 1: Write the failing test**

```ts
it.effect("dismissSubagentTask dispatches a task.dismiss command", () =>
  Effect.gen(function* () {
    const { requestSpy, run } = yield* makeCommandTestHarness(); // use whatever harness the snoozeThread test in this file already uses
    yield* run(dismissSubagentTask({ threadId: "thread_1", taskId: "task_1" }));
    expect(requestSpy).toHaveBeenCalledWith(
      ORCHESTRATION_WS_METHODS.dispatchCommand,
      expect.objectContaining({ type: "task.dismiss", threadId: "thread_1", taskId: "task_1" }),
    );
  }),
);
```

(Copy the real harness/spy names used by the existing `snoozeThread` test — do not invent `makeCommandTestHarness` if a different helper already exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run packages/client-runtime/src/operations/commands.test.ts`
Expected: FAIL — `dismissSubagentTask` is not defined.

- [ ] **Step 3: Implement**

In `commands.ts`, next to `snoozeThread`:

```ts
export const dismissSubagentTask: (input: DismissSubagentTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.dismissSubagentTask",
)(function* (input) {
  return yield* dispatch({ ...input, type: "task.dismiss", commandId: yield* commandId(input) });
});

export const restoreSubagentTask: (input: RestoreSubagentTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.restoreSubagentTask",
)(function* (input) {
  return yield* dispatch({ ...input, type: "task.restore", commandId: yield* commandId(input) });
});
```

Define `DismissSubagentTaskInput`/`RestoreSubagentTaskInput` as `{ threadId: ThreadId; taskId: RuntimeTaskId }`, matching whatever `SnoozeThreadInput`'s definition style is in this file.

In `threadCommands.ts`, add `dismissTask: dismissSubagentTask` and `restoreTask: restoreSubagentTask` to the facade object next to `snooze: snoozeThread` (~lines 143-147).

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run packages/client-runtime/src/operations/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client-runtime/src/operations/commands.ts packages/client-runtime/src/state/threadCommands.ts packages/client-runtime/src/operations/commands.test.ts
git commit -m "feat(client-runtime): add dismissTask/restoreTask commands

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part 4 — Web UI

### Task 8: Sidebar — nested subagent list with dismiss action

**Files:**

- Create: `apps/web/src/components/Sidebar.subagents.ts` (pure logic: filtering/sorting subagents for display under a thread row)
- Modify: `apps/web/src/components/Sidebar.tsx` (`SidebarThreadRow`, ~line 1130, add a collapsible child block; wire the dismiss action via `useThreadActions()`-derived `dismissTask`, following the existing `onSnooze`/`onUnsnooze` prop pattern at lines 1196-1197 and `handleUnsnoozeClick` at 1572-1578)
- Test: `apps/web/src/components/Sidebar.subagents.test.ts`

**Interfaces:**

- Consumes: `RuntimeSubagent.dismissed`/`.transcript` from Task 6 (transcript itself isn't rendered here, just used to confirm the row is real), `commands.dismissTask` from Task 7.
- Produces: exported `visibleSubagentsForSidebar(agents: ReadonlyArray<RuntimeSubagent>): ReadonlyArray<RuntimeSubagent>` (filters out `dismissed: true`, preserves display order), consumed by the new sidebar rendering in this same task.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vite-plus/test";
import { visibleSubagentsForSidebar } from "./Sidebar.subagents.js";

describe("visibleSubagentsForSidebar", () => {
  it("filters out dismissed subagents", () => {
    const agents = [
      { id: "a", dismissed: false } as RuntimeSubagent,
      { id: "b", dismissed: true } as RuntimeSubagent,
    ];
    expect(visibleSubagentsForSidebar(agents).map((a) => a.id)).toEqual(["a"]);
  });

  it("includes completed, non-dismissed subagents", () => {
    const agents = [{ id: "a", dismissed: false, status: "completed" } as RuntimeSubagent];
    expect(visibleSubagentsForSidebar(agents)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/web/src/components/Sidebar.subagents.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the logic module**

```ts
// Sidebar.subagents.ts
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

export function visibleSubagentsForSidebar(
  agents: ReadonlyArray<RuntimeSubagent>,
): ReadonlyArray<RuntimeSubagent> {
  return agents.filter((agent) => !agent.dismissed);
}
```

(Match this repo's actual import path convention for `@t3tools/client-runtime` — check a neighboring import in `Sidebar.tsx` for the real package/subpath alias.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/web/src/components/Sidebar.subagents.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the sidebar UI (manual verification, no new unit test — this is rendering wiring, tested by hand per Task 13)**

In `Sidebar.tsx`, inside `SidebarThreadRow`:

1. Accept new props `subagents: ReadonlyArray<RuntimeSubagent>`, `onDismissSubagent: (taskId: RuntimeTaskId) => void`, and `onOpenSubagent: (taskId: RuntimeTaskId) => void`. Note: Task 10 (not this task) creates the actual detail route — do not call `navigate(...)` directly here, since that route doesn't exist yet and referencing its path now would fail to typecheck. `onOpenSubagent` is a plain callback prop; Task 10 is responsible for supplying the real navigation behavior where this row's parent is wired up.
2. Compute `const visible = visibleSubagentsForSidebar(subagents);` and, if `visible.length > 0`, render a collapsible block below the row (reuse whatever collapsible/disclosure primitive `AgentsPanel.tsx`'s `CollapsedWorkflowSection`, ~lines 477-499, already uses — check that component for the primitive it imports and use the same one here for visual consistency) listing each subagent's title/role/status, each row a `<button>` (not a bare `<div>`) that calls `onOpenSubagent(agent.id)` on click, with a hover-revealed dismiss action calling `onDismissSubagent(agent.id)` (stop propagation so it doesn't also trigger `onOpenSubagent`).
3. In the parent component that renders `SidebarThreadRow` (the default export, ~line 2463), get `dismissTask` from `useThreadActions()` (same hook that already provides `snoozeThread`/`unsnoozeThread` at lines 2493-2497) and pass it down as `onDismissSubagent`. For `onOpenSubagent`, pass a temporary no-op (`() => {}`) at this stage — Task 10 replaces it with real navigation once the detail route exists.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Sidebar.subagents.ts apps/web/src/components/Sidebar.subagents.test.ts apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): show non-dismissed subagents nested under their thread in the sidebar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Agents panel — clickable rows + restore action

**Files:**

- Create: `apps/web/src/components/AgentsPanel.dismissal.ts` (pure logic: sorting/visual-state helpers)
- Modify: `apps/web/src/components/AgentsPanel.tsx` (`AgentRow`, lines 139-192: convert to a `<button>`/wrap in one, add a conditionally-rendered restore button for `agent.dismissed`)
- Test: `apps/web/src/components/AgentsPanel.dismissal.test.ts`

**Interfaces:**

- Consumes: `RuntimeSubagent.dismissed` from Task 6, `commands.restoreTask` from Task 7.
- Produces: exported `isRestoreVisible(agent: RuntimeSubagent): boolean` (just returns `agent.dismissed` — kept as a named function rather than an inline check so the intent reads clearly at the call site and so it's independently testable), consumed by `AgentRow`'s render logic in this same task.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vite-plus/test";
import { isRestoreVisible } from "./AgentsPanel.dismissal.js";

describe("isRestoreVisible", () => {
  it("is true only for dismissed agents", () => {
    expect(isRestoreVisible({ dismissed: true } as RuntimeSubagent)).toBe(true);
    expect(isRestoreVisible({ dismissed: false } as RuntimeSubagent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/web/src/components/AgentsPanel.dismissal.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// AgentsPanel.dismissal.ts
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

export function isRestoreVisible(agent: RuntimeSubagent): boolean {
  return agent.dismissed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/web/src/components/AgentsPanel.dismissal.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the panel UI**

In `AgentsPanel.tsx`:

1. `AgentRow` (139-192): change the outer element from a plain `<div>` to a `<button type="button" onClick={() => onOpen(agent)}>` wrapping the same inner content (mirror `CollapsedWorkflowSection`'s button pattern at 477-499 for consistent styling/focus behavior), plus a visual deemphasis class applied when `agent.dismissed` (e.g. reduced opacity, matching whatever deemphasis convention `AgentsPanel.tsx` or `Sidebar.tsx` already uses for a similar "muted" state — check `WorkflowScriptView`'s styling, ~lines 287-295, for the closest existing pattern).
2. When `isRestoreVisible(agent)`, render a small restore `Button` (icon-micro/ghost-muted variant, same as `WorkflowScriptView`'s close button at 287-295) that calls `commands.restoreTask({ threadId, taskId: agent.id })` and stops the click from bubbling to the row's own `onClick` (`event.stopPropagation()`).
3. `AgentsPanel`'s top-level component (524-531) needs an `onOpen: (agent: RuntimeSubagent) => void` prop threaded down to `AgentRow`, supplied by whichever parent renders `AgentsPanel` (wired to navigation in Task 10).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AgentsPanel.dismissal.ts apps/web/src/components/AgentsPanel.dismissal.test.ts apps/web/src/components/AgentsPanel.tsx
git commit -m "feat(web): make agent rows clickable and add restore for dismissed subagents

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Subagent detail route + view (main-pane, with live transcript)

**Files:**

- Create: `apps/web/src/routes/_chat.$environmentId.$threadId.agents.$taskId.tsx` (new file-based route, sibling to `_chat.$environmentId.$threadId.tsx`)
- Create: `apps/web/src/components/SubagentDetailView.tsx`
- Create: `apps/web/src/components/SubagentDetailView.logic.ts` (pure logic: mapping a `SubagentTranscriptEntry` to a renderable block description)
- Modify: `packages/client-runtime/src/state/threadDetail.ts` (no new atom needed if Task 6 already keeps `transcript` live on the same `RuntimeSubagent` the Agents panel already reads live — see Step 3 note below; only add a small selector if one doesn't already exist for "find one agent by id in the live agent list")
- Modify: `apps/web/src/state/entities.ts` (add `useSubagentTranscript` hook)
- Test: `apps/web/src/components/SubagentDetailView.logic.test.ts`

**Interfaces:**

- Consumes: `RuntimeSubagent`/`SubagentTranscriptEntry` from Task 6, `WorkspaceBreadcrumb`/`WorkspaceBreadcrumbItem`/`WorkspaceBreadcrumbSeparator` (`apps/web/src/components/WorkspaceBreadcrumb.tsx`), the existing per-content-block message renderers already used elsewhere in chat rendering (locate via whatever component `ChatView.tsx` uses to render a single text/thinking/tool_use/tool_result block, and import that same renderer rather than writing a new one).
- Produces: route `/_chat/$environmentId/$threadId/agents/$taskId`, navigable from Tasks 8 and 9.

- [ ] **Step 1: Write the failing logic test**

```ts
import { describe, expect, it } from "vite-plus/test";
import { transcriptEntryToBlock } from "./SubagentDetailView.logic.js";

describe("transcriptEntryToBlock", () => {
  it("maps a text entry to a text block", () => {
    const block = transcriptEntryToBlock({
      ordinal: 0,
      kind: "text",
      content: { text: "hi" },
      at: "t0",
    });
    expect(block).toEqual({ type: "text", text: "hi" });
  });

  it("maps a tool_use entry to a tool_use block", () => {
    const block = transcriptEntryToBlock({
      ordinal: 1,
      kind: "tool_use",
      content: { toolName: "Read", input: { path: "/x" } },
      at: "t1",
    });
    expect(block).toMatchObject({ type: "tool_use", toolName: "Read" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vp test run apps/web/src/components/SubagentDetailView.logic.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the logic module**

```ts
// SubagentDetailView.logic.ts
import type { SubagentTranscriptEntry } from "@t3tools/client-runtime/state/subagentRuntime";

export type TranscriptBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly text: string }
  | { readonly type: "tool_use"; readonly toolName: string; readonly input: unknown }
  | { readonly type: "tool_result"; readonly output: unknown };

export function transcriptEntryToBlock(entry: SubagentTranscriptEntry): TranscriptBlock {
  switch (entry.kind) {
    case "text":
      return { type: "text", text: (entry.content as { text: string }).text };
    case "thinking":
      return { type: "thinking", text: (entry.content as { thinking: string }).thinking };
    case "tool_use": {
      const content = entry.content as { toolName: string; input: unknown };
      return { type: "tool_use", toolName: content.toolName, input: content.input };
    }
    case "tool_result":
      return { type: "tool_result", output: entry.content };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vp test run apps/web/src/components/SubagentDetailView.logic.test.ts`
Expected: PASS

- [ ] **Step 5: Add the live-selection hook**

In `apps/web/src/state/entities.ts`, next to `useThreadDetail` (lines 104-108):

```ts
export function useSubagentTranscript(
  ref: ScopedThreadRef | null,
  taskId: RuntimeTaskId,
): ReadonlyArray<SubagentTranscriptEntry> {
  const model = useAgentPanelModel(ref); // use whatever hook already backs AgentsPanel's live data — check what AgentsPanel.tsx's caller passes as `model`
  const agent = [...model.directAgents, ...model.workflows.flatMap((w) => w.unphasedMembers)].find(
    (candidate) => candidate.id === taskId,
  );
  return agent?.transcript ?? EMPTY_TRANSCRIPT;
}
```

This deliberately reuses whatever live atom already backs the Agents panel (from Task 6's work) rather than introducing a second, parallel subscription — since `RuntimeSubagent.transcript` is already kept current by the same fold that keeps `status`/`usage` current, no new atom is needed for "live while open." Only add a new atom in `threadDetail.ts` if, after reading the file, no existing hook exposes the full live agent list to `entities.ts` — in that case mirror `threadMessagesAtomFamily` (lines 116-121) with a `threadAgentsAtomFamily` that reads from the same underlying `threadStateAtom`, `Atom.setIdleTTL(0)`.

- [ ] **Step 6: Build the route and view**

`apps/web/src/components/SubagentDetailView.tsx`:

```tsx
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "./WorkspaceBreadcrumb";
import { transcriptEntryToBlock } from "./SubagentDetailView.logic";
// import the existing single-block renderer used elsewhere in chat rendering — replace this
// placeholder import with the real one found while implementing this task.
import { MessageContentBlock } from "./MessageContentBlock";

export function SubagentDetailView({
  threadTitle,
  onBackToThread,
  agent,
}: {
  readonly threadTitle: string;
  readonly onBackToThread: () => void;
  readonly agent: RuntimeSubagent;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkspaceBreadcrumb>
        <WorkspaceBreadcrumbItem onClick={onBackToThread}>{threadTitle}</WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current>{agent.title}</WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div className="flex-1 overflow-y-auto">
        {agent.transcript.map((entry) => (
          <MessageContentBlock key={entry.ordinal} block={transcriptEntryToBlock(entry)} />
        ))}
      </div>
    </div>
  );
}
```

(`MessageContentBlock` is a placeholder name — while implementing, find the actual component `ChatView.tsx` uses to render one text/thinking/tool_use/tool_result block and import/use that instead, adapting `transcriptEntryToBlock`'s output shape to match whatever prop shape that real renderer expects.)

`apps/web/src/routes/_chat.$environmentId.$threadId.agents.$taskId.tsx`, modeled on `_chat.$environmentId.$threadId.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SidebarInset } from "../components/ui/sidebar"; // match the real import path used in _chat.$environmentId.$threadId.tsx
import { SubagentDetailView } from "../components/SubagentDetailView";
import { useSubagentTranscript, useThreadDetail } from "../state/entities";
import { resolveThreadRouteRef } from "./_chat.$environmentId.$threadId"; // reuse if exported; otherwise inline the equivalent param resolution

function SubagentDetailRouteView() {
  const navigate = useNavigate();
  const { environmentId, threadId, taskId } = Route.useParams();
  const threadRef = resolveThreadRouteRef({ environmentId, threadId });
  const thread = useThreadDetail(threadRef);
  const transcript = useSubagentTranscript(threadRef, taskId);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <SubagentDetailView
        threadTitle={thread?.title ?? threadId}
        onBackToThread={() =>
          navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } })
        }
        agent={
          {
            /* build from thread's live agent list by taskId, or pass transcript + minimal fields directly, matching whatever useSubagentTranscript's real return shape ends up being after Step 5 */
          }
        }
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId/agents/$taskId")({
  component: SubagentDetailRouteView,
});
```

Adjust `SubagentDetailView`'s props if Step 5's hook ends up returning the full `RuntimeSubagent` rather than just the transcript array — prefer passing the whole agent object down in that case, simplifying this route component.

- [ ] **Step 7: Wire navigation from Tasks 8 and 9**

In `Sidebar.tsx`'s subagent row (Task 8) and `AgentsPanel.tsx`'s `onOpen` (Task 9), call:

```ts
navigate({
  to: "/$environmentId/$threadId/agents/$taskId",
  params: { environmentId, threadId, taskId: agent.id },
});
```

- [ ] **Step 8: Regenerate the route tree**

Run: `./node_modules/.bin/vite build` (one-shot, not a persistent dev server — per this repo's own lesson about hand-editing `routeTree.gen.ts`, never edit it directly) from `apps/web`, or whatever this repo's documented route-tree regeneration command is (check `apps/web/package.json` scripts for a `routes`/`generate` script before falling back to a full build).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/routes/_chat.\$environmentId.\$threadId.agents.\$taskId.tsx apps/web/src/components/SubagentDetailView.tsx apps/web/src/components/SubagentDetailView.logic.ts apps/web/src/components/SubagentDetailView.logic.test.ts apps/web/src/state/entities.ts apps/web/src/routes/routeTree.gen.ts apps/web/src/components/Sidebar.tsx apps/web/src/components/AgentsPanel.tsx
git commit -m "feat(web): add subagent detail view reachable from sidebar and Agents panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final check (do this after all tasks land, before considering the feature done)

- [ ] Run the full targeted test scope for everything touched, not the whole repo:
      `./node_modules/.bin/vp test run packages/contracts/src apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/orchestration packages/client-runtime/src apps/web/src/components/Sidebar.subagents.test.ts apps/web/src/components/AgentsPanel.dismissal.test.ts apps/web/src/components/SubagentDetailView.logic.test.ts`
- [ ] Targeted typecheck for every package touched (contracts, server, client-runtime, web) — do not run a repo-wide `vp check`.
- [ ] Manually verify in a real browser, per AGENTS.md's "for UI or frontend changes... use the feature in a browser before reporting complete": open a thread that spawns a Claude subagent, confirm the sidebar shows it nested and un-dismissed by default, dismiss it and confirm it disappears from the sidebar but still shows (deemphasized) in the Agents panel, click it to open the detail view, confirm text/thinking/tool blocks render in order, confirm live updates appear while the subagent is still running, restore it from the Agents panel and confirm it reappears in the sidebar.
