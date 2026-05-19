/**
 * Reset de datos en producción (Opción A — empezar limpio).
 * Requiere CONFIRM_PRODUCCION_RESET=yes para evitar ejecución accidental.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

async function main() {
  if (process.env.CONFIRM_PRODUCCION_RESET !== 'yes') {
    console.error('⚠️  Esto BORRA todos los expedientes, contratos, documentos, usuarios, etc.');
    console.error('Para confirmar, ejecutá:');
    console.error('  CONFIRM_PRODUCCION_RESET=yes npm run db:produccion:reset');
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  if (!rows.length) {
    console.log('No hay tablas en public; nada que borrar.');
    process.exit(0);
  }
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  console.log(`✅ Base de datos vacía (${rows.length} tablas truncadas).`);
  console.log('Siguiente paso: crear Super Admin con npm run db:produccion:admin');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
