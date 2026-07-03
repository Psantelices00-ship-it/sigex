#!/usr/bin/env node
/**
 * Importa historial de licencias médicas desde Excel.
 * Uso:
 *   node scripts/importar-licencias-historial.js --archivo "/ruta/licencias.xlsx"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { parseLicenciasHistorialExcel } = require('../src/lib/personalLicenciasHistorialParse');
const { importarLicenciasHistorial } = require('../src/lib/personalLicenciasHistorialImport');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function main() {
  const archivo = arg('--archivo');
  if (!archivo || !fs.existsSync(archivo)) {
    console.error('Uso: --archivo "/ruta/licencias.xlsx"');
    process.exit(1);
  }

  console.log('Leyendo', archivo);
  const buf = fs.readFileSync(archivo);
  const parsed = parseLicenciasHistorialExcel(buf);
  console.log(`Filas Excel: ${parsed.total}, válidas: ${parsed.rows.length}, errores parseo: ${parsed.errores.length}`);

  const res = await importarLicenciasHistorial({
    rows: parsed.rows,
    usuarioLogin: 'script_licencias',
  });

  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
