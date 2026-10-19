import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261019002129_session_query_indexes",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_project_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_time_created_id_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_time_created_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`todo_session_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_project_time_updated_idx\` ON \`session\` (\`project_id\`,\`time_updated\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_directory_parent_archived_idx\` ON \`session\` (\`directory\`,\`parent_id\`,\`time_archived\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_time_updated_id_idx\` ON \`session\` (\`time_updated\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
