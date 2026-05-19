/**
 * Ejecuta un archivo .sql contra DATABASE_URL (Railway) o PG* local (.env).
 * Uso: node scripts/run-sql-file.js src/models/produccion-reset-datos.sql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Uso: node scripts/run-sql-file.js <ruta-al-archivo.sql>');
  process.exit(1);
}

const sqlPath = path.isAbsolute(fileArg) ? fileArg : path.join(__dirname, '..', fileArg);
if (!fs.existsSync(sqlPath)) {
  console.error('No existe:', sqlPath);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

async function main() {
  await db.query(sql);
  console.log('OK:', path.basename(sqlPath));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
