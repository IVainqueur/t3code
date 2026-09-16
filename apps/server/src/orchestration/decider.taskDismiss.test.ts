import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  RuntimeTaskId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(input: {
  readonly dismissedTaskIds?: ReadonlyArray<string>;
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        dismissedTaskIds: (input.dismissedTaskIds ?? []).map((id) => RuntimeTaskId.make(id)),
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      } as OrchestrationThread,
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("task dismiss/restore decider", (it) => {
  it.effect("task.dismiss adds the taskId to dismissedTaskIds", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "task.dismiss",
          commandId: CommandId.make("cmd-dismiss1"),
          threadId: ThreadId.make("thread-1"),
          taskId: RuntimeTaskId.make("task_abc"),
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task.dismissed");
      if (events[0]?.type === "task.dismissed") {
        expect(events[0].payload.taskId).toBe("task_abc");
      }
    }),
  );

  it.effect("task.dismiss is idempotent when already dismissed", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "task.dismiss",
          commandId: CommandId.make("cmd-dismiss2"),
          threadId: ThreadId.make("thread-1"),
          taskId: RuntimeTaskId.make("task_abc"),
        },
        readModel: makeReadModel({ dismissedTaskIds: ["task_abc"] }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task.dismissed");
      if (events[0]?.type === "task.dismissed") {
        expect(events[0].payload.taskId).toBe("task_abc");
      }
    }),
  );

  it.effect("task.restore removes the taskId from dismissedTaskIds", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "task.restore",
          commandId: CommandId.make("cmd-restore1"),
          threadId: ThreadId.make("thread-1"),
          taskId: RuntimeTaskId.make("task_abc"),
        },
        readModel: makeReadModel({ dismissedTaskIds: ["task_abc"] }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task.restored");
      if (events[0]?.type === "task.restored") {
        expect(events[0].payload.taskId).toBe("task_abc");
      }
    }),
  );

  it.effect("task.restore is idempotent when not dismissed", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "task.restore",
          commandId: CommandId.make("cmd-restore2"),
          threadId: ThreadId.make("thread-1"),
          taskId: RuntimeTaskId.make("task_abc"),
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("task.restored");
    }),
  );

  it.effect("rejects dismissing a task on an archived thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "task.dismiss",
          commandId: CommandId.make("cmd-dismiss-archived"),
          threadId: ThreadId.make("thread-1"),
          taskId: RuntimeTaskId.make("task_abc"),
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
