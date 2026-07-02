#!/usr/bin/env node
/**
 * Importa PDF mensuales de liquidaciones desde una carpeta local.
 * Uso:
 *   node scripts/importar-liquidaciones-carpeta.js "/ruta/a/carpeta"
 *   node scripts/importar-liquidaciones-carpeta.js "/ruta" --reemplazar
 *   node scripts/importar-liquidaciones-carpeta.js "/ruta" --solo "mayo 26"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const {
  cargarLiquidacionesPdf,
  listarPdfsCarpeta,
} = require('../src/lib/personalLiquidacionService');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function main() {
  const carpeta = process.argv[2];
  if (!carpeta || carpeta.startsWith('--')) {
    console.error('Uso: node scripts/importar-liquidaciones-carpeta.js "/ruta/carpeta" [--reemplazar] [--solo "texto"]');
    process.exit(1);
  }

  const resolved = path.resolve(carpeta);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error('Carpeta no encontrada:', resolved);
    process.exit(1);
  }

  const reemplazar = process.argv.includes('--reemplazar');
  const solo = arg('--solo');
  let archivos = listarPdfsCarpeta(resolved);
  if (solo) {
    const q = String(solo).toLowerCase();
    archivos = archivos.filter((p) => path.basename(p).toLowerCase().includes(q));
  }

  if (!archivos.length) {
    console.error('No hay PDF en la carpeta:', resolved);
    process.exit(1);
  }

  console.log('SIGEX — importación liquidaciones mensuales');
  console.log('Carpeta:', resolved);
  console.log('Archivos PDF:', archivos.length);
  console.log('Reemplazar duplicados:', reemplazar);
  console.log('');

  let ok = 0;
  let omitidos = 0;
  let errores = 0;

  for (let i = 0; i < archivos.length; i++) {
    const filePath = archivos[i];
    const nombre = path.basename(filePath);
    process.stdout.write(`[${i + 1}/${archivos.length}] ${nombre} ... `);
    const t0 = Date.now();

    try {
      const buffer = fs.readFileSync(filePath);
      const result = await cargarLiquidacionesPdf({
        buffer,
        originalname: nombre,
        usuarioLogin: 'script_cli',
        reemplazar,
      });
      ok++;
      console.log(
        `OK ${result.periodo?.etiqueta || `${result.mes}/${result.anio}`} · ${result.total_registros} registros · ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    } catch (e) {
      if (e.code === 'DUPLICATE_PERIODO') {
        omitidos++;
        console.log(`OMITIDO (ya cargado)`);
      } else {
        errores++;
        console.log(`ERROR: ${e.message || e}`);
      }
    }
  }

  console.log('\n--- Resumen ---');
  console.log('Cargados:', ok);
  console.log('Omitidos (duplicado):', omitidos);
  console.log('Errores:', errores);
  process.exit(errores ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
