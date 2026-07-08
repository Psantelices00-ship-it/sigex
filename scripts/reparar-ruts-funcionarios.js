/**
 * Repara RUTs mal parseados (ej. 9.144.200-0 → 91.442.000-8).
 *
 * Uso:
 *   node scripts/reparar-ruts-funcionarios.js
 *   node scripts/reparar-ruts-funcionarios.js --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');
const { formatearRut, repairStoredRutParts } = require('../src/lib/rutChileno');

const dryRun = process.argv.includes('--dry-run');

function fmtStored(row) {
  let n = String(row.rut_numero || '');
  let out = '';
  while (n.length > 3) {
    out = `.${n.slice(-3)}${out}`;
    n = n.slice(0, -3);
  }
  return `${n}${out}-${String(row.rut_dv || '').toUpperCase()}`;
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
  const r = await db.query(
    `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo
     FROM personal_funcionarios
     ORDER BY nombre_completo`
  );

  let fixed = 0;
  let skipped = 0;
  const incidencias = [];

  for (const row of r.rows) {
    const repaired = repairStoredRutParts(row.rut_numero, row.rut_dv);
    if (!repaired || repaired.rut_normalizado === row.rut_normalizado) continue;

    const dup = await db.query('SELECT id, nombre_completo FROM personal_funcionarios WHERE rut_normalizado = $1 AND id <> $2', [
      repaired.rut_normalizado,
      row.id,
    ]);
    if (dup.rows.length) {
      skipped++;
      incidencias.push({
        nombre: row.nombre_completo,
        actual: fmtStored(row),
        propuesto: formatearRut(repaired.rut_normalizado),
        error: `Ya existe otro funcionario: ${dup.rows[0].nombre_completo}`,
      });
      continue;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${row.nombre_completo}: ${fmtStored(row)} → ${formatearRut(repaired.rut_normalizado)}`
    );

    if (!dryRun) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE personal_funcionarios
           SET rut_normalizado = $1, rut_numero = $2, rut_dv = $3, updated_at = NOW()
           WHERE id = $4`,
          [repaired.rut_normalizado, repaired.rut_numero, repaired.rut_dv, row.id]
        );
        await updateRutReferences(row.rut_normalizado, repaired.rut_normalizado, client);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        skipped++;
        incidencias.push({
          nombre: row.nombre_completo,
          actual: fmtStored(row),
          propuesto: formatearRut(repaired.rut_normalizado),
          error: e.message || String(e),
        });
      } finally {
        client.release();
      }
    }

    fixed++;
  }

  console.log(JSON.stringify({ dryRun, total: r.rows.length, fixed, skipped, incidencias: incidencias.slice(0, 50) }, null, 2));
  process.exit(skipped > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
