const db = require('../db');

/**
 * @param {object} opts
 * @param {object[]} opts.rows parsed rows from parseMaestroRemuneracionesExcel
 * @param {number} opts.mes
 * @param {number} opts.anio
 * @param {string} opts.nombreArchivo
 * @param {string} opts.usuarioLogin
 */
async function importarMaestro(opts) {
  const { rows, mes, anio, nombreArchivo, usuarioLogin } = opts;
  if (!rows?.length) throw new Error('Sin filas para importar');

  const funcRows = await db.query('SELECT id, rut_normalizado FROM personal_funcionarios');
  const funcByRut = new Map(funcRows.rows.map((r) => [r.rut_normalizado, r.id]));

  const ex = await db.query(
    'SELECT id FROM personal_maestro_remuneraciones_periodos WHERE mes = $1 AND anio = $2',
    [mes, anio]
  );

  let periodoId;
  if (ex.rows.length) {
    periodoId = ex.rows[0].id;
    await db.query('DELETE FROM personal_maestro_remuneraciones WHERE periodo_id = $1', [periodoId]);
    await db.query(
      `UPDATE personal_maestro_remuneraciones_periodos
       SET nombre_archivo = $1, cargado_por = $2, total_registros = 0 WHERE id = $3`,
      [nombreArchivo, usuarioLogin, periodoId]
    );
  } else {
    const ins = await db.query(
      `INSERT INTO personal_maestro_remuneraciones_periodos (mes, anio, nombre_archivo, cargado_por)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [mes, anio, nombreArchivo, usuarioLogin]
    );
    periodoId = ins.rows[0].id;
  }

  const CHUNK = 200;
  let registros = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      params.push(
        periodoId,
        funcByRut.get(row.rut_normalizado) || null,
        row.rut_normalizado,
        row.fondo,
        row.salud,
        row.tipo_contrato,
        row.imposiciones,
        row.seg_cesantia_emp,
        row.sueldos
      );
    }
    await db.query(
      `INSERT INTO personal_maestro_remuneraciones
         (periodo_id, funcionario_id, rut_normalizado, fondo, salud, tipo_contrato,
          imposiciones, seg_cesantia_emp, sueldos)
       VALUES ${values.join(', ')}`,
      params
    );
    registros += chunk.length;
  }

  await db.query(
    'UPDATE personal_maestro_remuneraciones_periodos SET total_registros = $1 WHERE id = $2',
    [registros, periodoId]
  );

  return { periodo_id: periodoId, registros };
}

module.exports = { importarMaestro };
