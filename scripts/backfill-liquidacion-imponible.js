#!/usr/bin/env node
/**
 * Extrae monto_imponible (Tope Imponible) de liquidaciones ya cargadas.
 * Uso: node scripts/backfill-liquidacion-imponible.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const db = require('../src/db');
const { parseLiquidacionesPdf } = require('../src/lib/personalLiquidacionParse');

async function fetchPdf(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });
  return Buffer.from(res.data);
}

async function main() {
  const periodos = await db.query(
    `SELECT id, mes, anio, etiqueta, file_path
     FROM personal_liquidaciones_periodos
     WHERE estado = 'completo' AND file_path IS NOT NULL AND trim(file_path) <> ''
     ORDER BY anio, mes`
  );

  let actualizados = 0;
  let sinDato = 0;

  for (const p of periodos.rows) {
    process.stdout.write(`→ ${p.etiqueta || `${p.mes}/${p.anio}`} ... `);
    try {
      const buf = await fetchPdf(p.file_path);
      const parsed = await parseLiquidacionesPdf(buf);
      let n = 0;
      for (const reg of parsed.registros) {
        if (!reg.rut_normalizado || !reg.monto_imponible) {
          if (reg.rut_normalizado) sinDato++;
          continue;
        }
        const r = await db.query(
          `UPDATE personal_liquidaciones_registros
           SET monto_imponible = $1
           WHERE periodo_id = $2 AND pagina = $3`,
          [reg.monto_imponible, p.id, reg.pagina]
        );
        if (r.rowCount) {
          n += r.rowCount;
          actualizados += r.rowCount;
        }
      }
      console.log(`${n} registros`);
    } catch (e) {
      console.log(`ERROR: ${e.message || e}`);
    }
  }

  console.log(JSON.stringify({ periodos: periodos.rows.length, actualizados, sinDato }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
