const db = require('../db');
const { detectarTipoDocumental } = require('./personalPdfPlanosPorRutImport');
const { TIPO_CONSOLIDADO_IMPORT } = require('./personalDocumentoService');
const {
  isTipoObligatorio,
  permiteMultiplesActivos,
  tipoPermitidoParaFuncionario,
} = require('./personalDocTypes');

/**
 * Promueve consolidados tipables a su ítem de carpeta vigente cuando el slot
 * está vacío. Si el ítem ya tiene un activo, el consolidado se deja igual
 * (queda como duplicado en consolidado).
 */
async function promoverConsolidadoATipos(opts = {}) {
  const dryRun = !!opts.dryRun;
  const funcionarioId = opts.funcionarioId || null;
  const inicio = Date.now();
  const onProgress = opts.onProgress || (() => {});

  const resumen = {
    dry_run: dryRun,
    funcionarios: 0,
    consolidados_revisados: 0,
    promovidos: 0,
    ya_cubiertos: 0,
    sin_tipo: 0,
    errores: 0,
    por_tipo: {},
    muestra: [],
    tiempo_ms: 0,
  };

  const params = [TIPO_CONSOLIDADO_IMPORT];
  let sql = `
    SELECT d.id, d.funcionario_id, d.nombre_archivo, d.tipo_documental, d.es_activo,
           d.version_num, f.tipo_funcionario, f.rut_numero, f.rut_dv, f.nombre_completo
    FROM personal_documentos d
    JOIN personal_funcionarios f ON f.id = d.funcionario_id
    WHERE d.tipo_documental = $1 AND d.es_activo = TRUE
  `;
  if (funcionarioId) {
    params.push(funcionarioId);
    sql += ` AND d.funcionario_id = $${params.length}`;
  }
  sql += ` ORDER BY f.nombre_completo, d.created_at ASC`;

  const rows = (await db.query(sql, params)).rows;
  resumen.consolidados_revisados = rows.length;

  const porFunc = new Map();
  for (const row of rows) {
    if (!porFunc.has(row.funcionario_id)) porFunc.set(row.funcionario_id, []);
    porFunc.get(row.funcionario_id).push(row);
  }
  resumen.funcionarios = porFunc.size;

  // Slots activos (no consolidado) en una sola query
  const activosParams = [TIPO_CONSOLIDADO_IMPORT];
  let activosSql = `
    SELECT funcionario_id, tipo_documental, COALESCE(MAX(version_num), 0)::int AS mx
    FROM personal_documentos
    WHERE es_activo = TRUE AND tipo_documental <> $1
  `;
  if (funcionarioId) {
    activosParams.push(funcionarioId);
    activosSql += ` AND funcionario_id = $${activosParams.length}`;
  }
  activosSql += ` GROUP BY funcionario_id, tipo_documental`;
  const activosRows = (await db.query(activosSql, activosParams)).rows;

  const slotsPorFunc = new Map();
  const maxVerPorFuncTipo = new Map();
  for (const a of activosRows) {
    if (!slotsPorFunc.has(a.funcionario_id)) slotsPorFunc.set(a.funcionario_id, new Set());
    slotsPorFunc.get(a.funcionario_id).add(a.tipo_documental);
    maxVerPorFuncTipo.set(`${a.funcionario_id}|${a.tipo_documental}`, a.mx);
  }

  // Max version también de inactivos (para version_num correcto al promover)
  const verParams = [];
  let verSql = `
    SELECT funcionario_id, tipo_documental, COALESCE(MAX(version_num), 0)::int AS mx
    FROM personal_documentos
  `;
  if (funcionarioId) {
    verParams.push(funcionarioId);
    verSql += ` WHERE funcionario_id = $1`;
  }
  verSql += ` GROUP BY funcionario_id, tipo_documental`;
  const verRows = (await db.query(verSql, verParams)).rows;
  for (const v of verRows) {
    maxVerPorFuncTipo.set(`${v.funcionario_id}|${v.tipo_documental}`, v.mx);
  }

  const updates = []; // { id, tipo, versionNum }
  let iFunc = 0;

  for (const [funcId, docs] of porFunc) {
    iFunc++;
    const tipoFunc = docs[0].tipo_funcionario;
    const slotsOcupados = slotsPorFunc.get(funcId) || new Set();

    for (const doc of docs) {
      const tipo = detectarTipoDocumental(doc.nombre_archivo);

      if (!tipo || tipo === TIPO_CONSOLIDADO_IMPORT) {
        resumen.sin_tipo++;
        continue;
      }
      if (!isTipoObligatorio(tipo) || permiteMultiplesActivos(tipo)) {
        resumen.sin_tipo++;
        continue;
      }
      if (!tipoPermitidoParaFuncionario(tipo, tipoFunc)) {
        resumen.sin_tipo++;
        continue;
      }

      if (slotsOcupados.has(tipo)) {
        resumen.ya_cubiertos++;
        continue;
      }

      const key = `${funcId}|${tipo}`;
      const versionNum = (maxVerPorFuncTipo.get(key) || 0) + 1;
      maxVerPorFuncTipo.set(key, versionNum);
      slotsOcupados.add(tipo);

      updates.push({ id: doc.id, tipo, versionNum });
      resumen.promovidos++;
      resumen.por_tipo[tipo] = (resumen.por_tipo[tipo] || 0) + 1;
      if (resumen.muestra.length < 40) {
        resumen.muestra.push({
          rut: `${docs[0].rut_numero}-${docs[0].rut_dv}`,
          nombre: docs[0].nombre_completo,
          archivo: doc.nombre_archivo,
          tipo,
        });
      }
    }

    if (iFunc % 50 === 0 || iFunc === porFunc.size) {
      onProgress({ ...resumen, funcionarios_procesados: iFunc });
    }
  }

  if (!dryRun && updates.length) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        await client.query(
          `UPDATE personal_documentos
           SET tipo_documental = $1,
               version_num = $2,
               es_activo = TRUE,
               estado = CASE WHEN estado IS NULL OR estado = 'pendiente' THEN 'vigente' ELSE estado END
           WHERE id = $3`,
          [u.tipo, u.versionNum, u.id]
        );
        if ((i + 1) % 100 === 0) {
          onProgress({ ...resumen, updates_aplicados: i + 1, updates_total: updates.length });
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  resumen.tiempo_ms = Date.now() - inicio;
  return resumen;
}

module.exports = { promoverConsolidadoATipos };
