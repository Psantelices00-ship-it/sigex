/**
 * Ejecuta todas las migraciones en orden (local/Railway vía DATABASE_URL).
 * Uso: node scripts/run-all-migrations.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'models', 'migrations');

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sqlPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    process.stdout.write(`→ ${file} ... `);
    await db.query(sql);
    console.log('OK');
  }
  console.log(`\n${files.length} migración(es) aplicada(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nError:', e.message || e);
  process.exit(1);
});
