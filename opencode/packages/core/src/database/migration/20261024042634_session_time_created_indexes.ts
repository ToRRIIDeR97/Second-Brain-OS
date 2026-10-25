import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261024042634_session_time_created_indexes",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_project_time_created_id_idx\` ON \`session\` (\`project_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_time_created_id_idx\` ON \`session\` (\`time_created\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
