import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import migration053 from "./053_ProjectionThreadsDismissedTasks.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_ProjectionThreadsDismissedTasks", (it) => {
  it.effect("backfills pre-migration thread rows with an empty dismissed set", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        )
        VALUES (
          'thread-pre-migration',
          'project-pre-migration',
          'Pre-migration thread',
          '{"instanceId":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          0,
          0,
          0
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 53 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const column = columns.find((entry) => entry.name === "dismissed_task_ids_json");
      assert.equal(column?.notnull, 1);

      const rows = yield* sql<{ readonly dismissedTaskIdsJson: string }>`
        SELECT dismissed_task_ids_json AS "dismissedTaskIdsJson"
        FROM projection_threads
        WHERE thread_id = 'thread-pre-migration'
      `;
      assert.deepEqual(rows, [{ dismissedTaskIdsJson: "[]" }]);
    }),
  );

  it.effect("re-running the migration against an existing column is a no-op", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 53 });
      // Dev databases can already carry a hand-added column; the PRAGMA guard
      // must make a second application harmless rather than fail on ALTER.
      yield* migration053;

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.equal(columns.filter((entry) => entry.name === "dismissed_task_ids_json").length, 1);
    }),
  );
});
