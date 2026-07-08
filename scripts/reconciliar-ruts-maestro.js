/**
 * Reconcilia RUTs de personal_funcionarios contra el maestro Excel (fuente de verdad).
 *
 * Uso:
 *   node scripts/reconciliar-ruts-maestro.js "/ruta/MAESTRO MAYO 2026 EDUCACION.xlsx"
 *   node scripts/reconciliar-ruts-maestro.js "/ruta/maestro.xlsx" --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../src/db');
const { normalizeRutParts, formatearRut } = require('../src/lib/rutChileno');

const dryRun = process.argv.includes('--dry-run');
const excelPath = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.xlsx'));

function normNombre(n) {
  return String(n || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseMaestroRows(path) {
  const wb = XLSX.readFile(path, { cellDates: true, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const byNombre = new Map();
  const byRut = new Map();
  const errores = [];

  raw.forEach((row, idx) => {
    const linea = idx + 2;
    const rutRaw = row.rut ?? row.RUT ?? row.Rut ?? '';
    const parts = normalizeRutParts(String(rutRaw).trim());
    if (!parts) {
      errores.push({ linea, rut: String(rutRaw), error: 'RUT inválido en maestro' });
      return;
    }
    const nombre = String(row.nombre ?? row.NOMBRE ?? '').trim();
    if (!nombre) {
      errores.push({ linea, rut: formatearRut(parts.rut_normalizado), error: 'Nombre vacío' });
      return;
    }
    const key = normNombre(nombre);
    const entry = { ...parts, nombre_completo: nombre, linea };
    byNombre.set(key, entry);
    byRut.set(parts.rut_normalizado, entry);
  });

  return { byNombre, byRut, total: raw.length, errores };
}

async function updateRutReferences(oldRut, newRut, client) {
  const tables = [
    ['personal_liquidaciones_registros', 'rut_normalizado'],
    ['personal_maestro_remuneraciones', 'rut_normalizado'],
  ];
  for (const [table, col] of tables) {
    await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [newRut, oldRut]);
  }
}

async function main() {
  if (!excelPath || !fs.existsSync(excelPath)) {
    console.error('Uso: node scripts/reconciliar-ruts-maestro.js "/ruta/maestro.xlsx" [--dry-run]');
    process.exit(1);
  }

  const maestro = parseMaestroRows(excelPath);
  console.log(`Maestro: ${maestro.total} filas, ${maestro.byNombre.size} nombres únicos, ${maestro.errores.length} errores parseo`);

  const funcs = await db.query(
    `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo
     FROM personal_funcionarios ORDER BY nombre_completo`
  );

  let fixed = 0;
  let ok = 0;
  let sinMaestro = 0;
  let skipped = 0;
  const incidencias = [];

  for (const row of funcs.rows) {
    const key = normNombre(row.nombre_completo);
    const ref = maestro.byNombre.get(key);
    if (!ref) {
      sinMaestro++;
      continue;
    }

    if (ref.rut_normalizado === row.rut_normalizado) {
      ok++;
      continue;
    }

    const dup = await db.query(
      'SELECT id, nombre_completo FROM personal_funcionarios WHERE rut_normalizado = $1 AND id <> $2',
      [ref.rut_normalizado, row.id]
    );
    if (dup.rows.length) {
      skipped++;
      incidencias.push({
        nombre: row.nombre_completo,
        actual: formatearRut({ rut_numero: row.rut_numero, rut_dv: row.rut_dv }),
        maestro: formatearRut(ref.rut_normalizado),
        error: `Conflicto: ya existe ${dup.rows[0].nombre_completo}`,
      });
      continue;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${row.nombre_completo}: ${formatearRut({ rut_numero: row.rut_numero, rut_dv: row.rut_dv })} → ${formatearRut(ref.rut_normalizado)}`
    );

    if (!dryRun) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE personal_funcionarios
           SET rut_normalizado = $1, rut_numero = $2, rut_dv = $3, updated_at = NOW()
           WHERE id = $4`,
          [ref.rut_normalizado, ref.rut_numero, ref.rut_dv, row.id]
        );
        await updateRutReferences(row.rut_normalizado, ref.rut_normalizado, client);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        skipped++;
        incidencias.push({
          nombre: row.nombre_completo,
          actual: formatearRut({ rut_numero: row.rut_numero, rut_dv: row.rut_dv }),
          maestro: formatearRut(ref.rut_normalizado),
          error: e.message || String(e),
        });
      } finally {
        client.release();
      }
    }

    fixed++;
  }

  const resumen = {
    dryRun,
    excel: excelPath,
    funcionarios_db: funcs.rows.length,
    maestro_nombres: maestro.byNombre.size,
    ok,
    corregidos: fixed,
    sin_maestro: sinMaestro,
    skipped,
    errores_maestro: maestro.errores.length,
    incidencias: incidencias.slice(0, 80),
  };
  console.log(JSON.stringify(resumen, null, 2));
  process.exit(skipped > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
