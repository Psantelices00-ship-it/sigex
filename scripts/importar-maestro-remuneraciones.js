#!/usr/bin/env node
/**
 * Importa maestro mensual de remuneraciones (Excel) para módulo Licencias.
 * Uso:
 *   node scripts/importar-maestro-remuneraciones.js --archivo "ruta.xlsx" --mes 5 --anio 2026
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { parseMaestroRemuneracionesExcel } = require('../src/lib/personalMaestroRemuneracionesParse');
const { importarMaestro: importarMaestroDb } = require('../src/lib/personalMaestroRemuneracionesImport');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function importarMaestroDesdeArchivo({ archivo, mes, anio, usuarioLogin }) {
  const buf = fs.readFileSync(archivo);
  const parsed = parseMaestroRemuneracionesExcel(buf);
  if (!parsed.rows.length) throw new Error('Sin filas válidas en el Excel');

  const result = await importarMaestroDb({
    rows: parsed.rows,
    mes,
    anio,
    nombreArchivo: path.basename(archivo),
    usuarioLogin,
  });

  return {
    ...result,
    mes,
    anio,
    duplicados_omitidos: parsed.duplicados_omitidos,
    errores: parsed.errores.length,
  };
}

async function main() {
  const archivo = arg('--archivo');
  const mes = parseInt(arg('--mes'), 10);
  const anio = parseInt(arg('--anio'), 10);
  if (!archivo || !fs.existsSync(archivo)) {
    console.error('Uso: --archivo ruta.xlsx --mes 5 --anio 2026');
    process.exit(1);
  }
  if (!mes || mes < 1 || mes > 12 || !anio) {
    console.error('Indicá --mes (1-12) y --anio');
    process.exit(1);
  }

  const res = await importarMaestroDesdeArchivo({
    archivo: path.resolve(archivo),
    mes,
    anio,
    usuarioLogin: 'script_maestro',
  });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { importarMaestroDesdeArchivo };
