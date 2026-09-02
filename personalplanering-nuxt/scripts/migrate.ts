import { pool, ensureSchema } from '../server/utils/db'

// Kör schema-bootstrap + alla väntande SQL-migreringar och avsluta.
// ensureSchema() kedjar runMigrations() efter bootstrap-strängen.
async function main() {
  await ensureSchema()
  console.log('Migreringar klara.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
