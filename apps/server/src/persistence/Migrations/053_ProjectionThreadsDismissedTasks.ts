import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "dismissed_task_ids_json")) {
    // NOT NULL with a constant default so pre-migration rows decode as an
    // empty array without a separate backfill pass.
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN dismissed_task_ids_json TEXT NOT NULL DEFAULT '[]'
    `;
  }
});
