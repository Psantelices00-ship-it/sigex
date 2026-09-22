#!/usr/bin/env node
/**
 * Importa PDFs planos nombrados por RUT a la ficha/carpeta del funcionario.
 * Uso:
 *   node scripts/importar-pdf-planos-por-rut.js --base "/Volumes/DISCO PABLO/DOCENTES ACTIVOS  AGOSTO 2025"
 *   node scripts/importar-pdf-planos-por-rut.js --base "/ruta" --dry-run
 *   node scripts/importar-pdf-planos-por-rut.js --base "/ruta" --forzar
 *   node scripts/importar-pdf-planos-por-rut.js --base "/ruta" --omitidos-como-consolidado
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { importarPdfPlanosPorRut } = require('../src/lib/personalPdfPlanosPorRutImport');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function main() {
  const base = arg('--base');
  if (!base) {
    console.error(
      'Uso: node scripts/importar-pdf-planos-por-rut.js --base "/ruta/carpeta" [--dry-run] [--forzar] [--omitidos-como-consolidado]'
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const forzar = process.argv.includes('--forzar');
  const omitidosComoConsolidado = process.argv.includes('--omitidos-como-consolidado');
  const omitidosAntesDe = arg('--antes-de');
  const logPath = arg('--log') || path.join(__dirname, '..', 'tmp', 'import-pdf-planos-por-rut.log');

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (line) => {
    console.log(line);
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
  };

  log('SIGEX — importación PDF planos por RUT → ficha/carpeta funcionario');
  log(`Ruta: ${base}`);
  log(
    `Dry run: ${dryRun} | Forzar: ${forzar} | Omitidos→consolidado: ${omitidosComoConsolidado}` +
      (omitidosAntesDe ? ` | Antes de: ${omitidosAntesDe}` : '')
  );
  log('');

  const resumen = await importarPdfPlanosPorRut({
    basePath: base,
    usuarioLogin: 'script_pdf_planos',
    dryRun,
    forzar,
    omitidosComoConsolidado,
    omitidosAntesDe: omitidosAntesDe || null,
    onProgress: async (p) => {
      process.stdout.write(
        `\rProgreso: ${p.indice || '?'}/${p.archivos_total} · cargados ${p.documentos_cargados} · omitidos ${p.documentos_omitidos} · errores ${p.documentos_rechazados}`
      );
    },
  });

  log('\n\n--- Resumen ---');
  log(JSON.stringify(resumen, null, 2));
  logStream.end();
  process.exit(resumen.documentos_rechazados > 0 || resumen.archivos_sin_rut > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('\nError:', e.message || e);
  process.exit(1);
});
