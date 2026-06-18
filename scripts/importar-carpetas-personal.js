#!/usr/bin/env node
/**
 * Importa carpetas PDF del disco TOSHIBA al módulo Personal.
 * Uso:
 *   node scripts/importar-carpetas-personal.js
 *   node scripts/importar-carpetas-personal.js --limite 10 --dry-run
 *   node scripts/importar-carpetas-personal.js --base "/Volumes/TOSHIBA EXT/..."
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.PERSONAL_IMPORT_CARPETAS_ENABLED = process.env.PERSONAL_IMPORT_CARPETAS_ENABLED || '1';

const {
  DEFAULT_BASE,
  importarCarpetasDesdeDisco,
} = require('../src/lib/personalCarpetasImport');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function main() {
  const base = arg('--base') || DEFAULT_BASE;
  const limite = Number(arg('--limite')) || 0;
  const dryRun = process.argv.includes('--dry-run');

  console.log('SIGEX — importación carpetas funcionarias');
  console.log('Ruta:', base);
  console.log('Límite carpetas:', limite || 'sin límite');
  console.log('Dry run:', dryRun);
  console.log('');

  const resumen = await importarCarpetasDesdeDisco({
    basePath: base,
    usuarioLogin: 'script_cli',
    limiteCarpetas: limite,
    dryRun,
    onProgress: async (p) => {
      if (p.indice && p.carpetas_total) {
        process.stdout.write(`\rProgreso: ${p.indice}/${p.carpetas_total} carpetas…`);
      }
    },
  });

  console.log('\n\n--- Resumen ---');
  console.log(JSON.stringify(resumen, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('\nError:', e.message || e);
  process.exit(1);
});
