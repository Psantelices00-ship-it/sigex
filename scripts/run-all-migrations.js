/**
 * Ejecuta todas las migraciones en orden (local vía DATABASE_URL).
 * Uso: node scripts/run-all-migrations.js
 *
 * En Railway (release) NO re-ejecutar: ya están aplicadas y un ECONNRESET
 * deja el deploy en FAILED y tumba el servicio.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID) {
  console.log('SIGEX: migraciones omitidas en Railway (ya aplicadas). Usá run-all-migrations.js en local.');
  process.exit(0);
}

const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('railway') && process.env.DATABASE_SSL !== 'false') {
  process.env.DATABASE_SSL = 'true';
}

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
