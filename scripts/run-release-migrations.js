/**
 * Migraciones idempotentes para release en Railway (solo tablas nuevas de liquidaciones).
 * Las migraciones 001–021 ya están aplicadas en producción; no re-ejecutar run-all-migrations.js
 * en cada deploy porque puede fallar al recrear índices únicos con datos existentes.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const RELEASE_MIGRATIONS = [];

async function main() {
  const dir = path.join(__dirname, '..', 'src', 'models', 'migrations');
  for (const file of RELEASE_MIGRATIONS) {
    const sqlPath = path.join(dir, file);
    if (!fs.existsSync(sqlPath)) {
      console.warn('Skip (no existe):', file);
      continue;
    }
    process.stdout.write(`→ ${file} ... `);
    await db.query(fs.readFileSync(sqlPath, 'utf8'));
    console.log('OK');
  }
  console.log('Release migrations listas.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Error release migrations:', e.message || e);
  process.exit(1);
});
