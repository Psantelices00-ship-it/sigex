const db = require('../db');

/**
 * @param {object} opts
 * @param {object[]} opts.rows
 * @param {string} opts.usuarioLogin
 * @param {boolean} [opts.omitirExistentes]
 */
async function importarLicenciasHistorial(opts) {
  const { rows, usuarioLogin, omitirExistentes = true } = opts;
  const resumen = {
    filas_excel: rows.length,
    insertadas: 0,
    omitidas_duplicado: 0,
    omitidas_sin_funcionario: 0,
    errores_insercion: 0,
    incidencias: [],
  };

  const funcRows = await db.query('SELECT id, rut_normalizado FROM personal_funcionarios');
  const funcByRut = new Map(funcRows.rows.map((r) => [r.rut_normalizado, r.id]));

  let existentes = new Set();
  if (omitirExistentes) {
    const nums = [...new Set(rows.map((r) => r.numero_licencia).filter(Boolean))];
    if (nums.length) {
      const CHUNK = 500;
      for (let i = 0; i < nums.length; i += CHUNK) {
        const slice = nums.slice(i, i + CHUNK);
        const r = await db.query(
          `SELECT numero_licencia FROM personal_licencias
           WHERE numero_licencia = ANY($1::text[])`,
          [slice]
        );
        for (const row of r.rows) existentes.add(row.numero_licencia);
      }
    }
  }

  const pendientes = [];
  for (const row of rows) {
    const funcionarioId = funcByRut.get(row.rut_normalizado);
    if (!funcionarioId) {
      resumen.omitidas_sin_funcionario++;
      if (resumen.incidencias.length < 50) {
        resumen.incidencias.push({
          linea: row.linea,
          rut: row.rut_display,
          tipo: 'sin_funcionario',
          mensaje: 'RUT no está en SIGEX',
        });
      }
      continue;
    }

    if (row.numero_licencia && existentes.has(row.numero_licencia)) {
      resumen.omitidas_duplicado++;
      continue;
    }

    pendientes.push({ ...row, funcionario_id: funcionarioId });
    if (row.numero_licencia) existentes.add(row.numero_licencia);
  }

  const CHUNK = 150;
  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const chunk = pendientes.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      params.push(
        row.funcionario_id,
        row.numero_licencia,
        row.fecha_tramitacion,
        row.fecha_inicio,
        row.fecha_termino,
        row.dias,
        usuarioLogin,
        usuarioLogin
      );
    }
    try {
      const r = await db.query(
        `INSERT INTO personal_licencias
           (funcionario_id, numero_licencia, fecha_tramitacion, fecha_inicio, fecha_termino,
            dias, created_by, updated_by)
         VALUES ${values.join(', ')}
         RETURNING id`,
        params
      );
      resumen.insertadas += r.rowCount;
    } catch (e) {
      resumen.errores_insercion += chunk.length;
      if (resumen.incidencias.length < 50) {
        resumen.incidencias.push({ tipo: 'error_lote', mensaje: e.message || String(e) });
      }
    }
  }

  return resumen;
}

module.exports = { importarLicenciasHistorial };
