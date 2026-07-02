/**
 * Release en Railway: las migraciones ya están aplicadas en producción.
 * No re-ejecutar run-all-migrations.js en cada deploy (rompe índices con datos existentes).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function main() {
  console.log('SIGEX release: migraciones omitidas (ya aplicadas).');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
