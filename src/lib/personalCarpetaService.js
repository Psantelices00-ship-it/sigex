const axios = require('axios');
const archiver = require('archiver');
const db = require('../db');
const { formatearRut } = require('./rutChileno');
const {
  isTipoObligatorio,
  tiposObligatoriosParaFuncionario,
  tipoDocumentalLabel,
} = require('./personalDocTypes');
const { extractSinglePagePdf } = require('./personalLiquidacionExport');
const { etiquetaPeriodo } = require('./personalLiquidacionParse');

function sanitizeFilename(name) {
  return String(name || 'archivo')
    .replace(/[^\w\s.\-áéíóúñÁÉÍÓÚÑ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

async function fetchFileBuffer(url) {
  const res = await axios.get(String(url).trim(), {
    responseType: 'arraybuffer',
    timeout: 180000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });
  return Buffer.from(res.data);
}

async function docsResumenForFuncionario(funcionarioId, tipoFuncionario) {
  const activos = await db.query(
    `SELECT tipo_documental, estado, fecha_vencimiento
     FROM personal_documentos
     WHERE funcionario_id = $1 AND es_activo = TRUE`,
    [funcionarioId]
  );
  const obligatoriosMeta = tiposObligatoriosParaFuncionario(tipoFuncionario);
  const obligatorios = obligatoriosMeta.map((t) => t.key);
  const obligatoriosActivos = activos.rows.filter(
    (r) => isTipoObligatorio(r.tipo_documental) && obligatorios.includes(r.tipo_documental)
  );
  const presentes = new Set(obligatoriosActivos.map((r) => r.tipo_documental));
  const faltantes = obligatorios.filter((k) => !presentes.has(k));
  return {
    total_obligatorios: obligatorios.length,
    cargados: presentes.size,
    faltantes,
    vencidos: obligatoriosActivos.filter((r) => r.estado === 'vencido').length,
    proximos_vencer: obligatoriosActivos.filter((r) => r.estado === 'proximo_vencer').length,
    consolidados_antiguos: activos.rows.filter((r) => r.tipo_documental === 'consolidado_antiguo').length,
    anexos: activos.rows.filter((r) => r.tipo_documental === 'anexo').length,
    total_documentos_activos: activos.rows.length,
  };
}

async function armarResumenCarpeta(funcionarioId) {
  const funcR = await db.query('SELECT * FROM personal_funcionarios WHERE id = $1', [funcionarioId]);
  if (!funcR.rows.length) return null;
  const funcionario = funcR.rows[0];

  const [docsResumen, docs, licencias, liquidaciones, auditoria] = await Promise.all([
    docsResumenForFuncionario(funcionarioId, funcionario.tipo_funcionario),
    db.query(
      `SELECT id, tipo_documental, nombre_archivo, file_path, estado, fecha_vencimiento,
              version_num, origen_carga, cargado_por, created_at, es_activo
       FROM personal_documentos
       WHERE funcionario_id = $1 AND es_activo = TRUE
       ORDER BY tipo_documental, created_at DESC`,
      [funcionarioId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(dias), 0)::int AS dias_total
       FROM personal_licencias WHERE funcionario_id = $1`,
      [funcionarioId]
    ),
    db.query(
      `SELECT lr.id, lr.pagina, p.mes, p.anio, p.etiqueta, p.file_path
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE lr.rut_normalizado = $1 AND p.estado = 'completo'
       ORDER BY p.anio DESC, p.mes DESC`,
      [funcionario.rut_normalizado]
    ),
    db.query(
      `SELECT accion, entidad, created_at, detalle_json
       FROM personal_auditoria
       WHERE funcionario_id = $1
       ORDER BY created_at DESC LIMIT 15`,
      [funcionarioId]
    ),
  ]);

  const documentos = docs.rows.map((d) => ({
    ...d,
    tipo_label: tipoDocumentalLabel(d.tipo_documental),
  }));

  const grupos = {
    obligatorios: documentos.filter(
      (d) => d.tipo_documental !== 'anexo' && d.tipo_documental !== 'consolidado_antiguo'
    ),
    anexos: documentos.filter((d) => d.tipo_documental === 'anexo'),
    consolidados: documentos.filter((d) => d.tipo_documental === 'consolidado_antiguo'),
  };

  return {
    funcionario: {
      id: funcionario.id,
      rut: formatearRut(funcionario.rut_normalizado),
      rut_normalizado: funcionario.rut_normalizado,
      nombre_completo: funcionario.nombre_completo,
      tipo_funcionario: funcionario.tipo_funcionario,
      estado_laboral: funcionario.estado_laboral,
      activo: funcionario.activo,
      planta: funcionario.planta,
      ubicacion: funcionario.ubicacion,
      tipo_contrato: funcionario.tipo_contrato,
      fecha_ingreso: funcionario.fecha_ingreso,
    },
    documentos_resumen: docsResumen,
    documentos,
    grupos,
    licencias: {
      total: licencias.rows[0]?.total || 0,
      dias_total: licencias.rows[0]?.dias_total || 0,
    },
    liquidaciones: liquidaciones.rows.map((r) => ({
      id: r.id,
      mes: r.mes,
      anio: r.anio,
      etiqueta: r.etiqueta || etiquetaPeriodo(r.mes, r.anio),
    })),
    liquidaciones_total: liquidaciones.rows.length,
    auditoria_reciente: auditoria.rows,
  };
}

/**
 * @param {object} opts
 * @param {import('express').Response} opts.res
 * @param {object} opts.funcionario
 * @param {object[]} opts.documentos
 * @param {object[]} [opts.liquidaciones]
 * @param {object} opts.resumenJson
 */
async function exportarCarpetaZip(opts) {
  const { res, funcionario, documentos, liquidaciones, resumenJson } = opts;
  const baseName = sanitizeFilename(
    `${funcionario.rut_normalizado}_${funcionario.nombre_completo || 'carpeta'}`
  );

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    throw err;
  });
  archive.pipe(res);

  archive.append(JSON.stringify(resumenJson, null, 2), { name: 'resumen/resumen_funcionario.json' });

  for (const doc of documentos) {
    if (!doc.file_path) continue;
    let folder = 'documentos';
    if (doc.tipo_documental === 'consolidado_antiguo') folder = 'consolidados_antiguos';
    else if (doc.tipo_documental === 'anexo') folder = 'anexos';
    else folder = `documentos/${doc.tipo_documental}`;

    try {
      const buf = await fetchFileBuffer(doc.file_path);
      const fname = sanitizeFilename(doc.nombre_archivo || `${doc.tipo_documental}.pdf`);
      archive.append(buf, { name: `${folder}/${fname}` });
    } catch {
      archive.append(
        JSON.stringify({ error: 'No se pudo descargar', doc_id: doc.id, tipo: doc.tipo_documental }),
        { name: `${folder}/ERROR_${doc.id}.json` }
      );
    }
  }

  if (liquidaciones?.length) {
    for (const liq of liquidaciones) {
      if (!liq.file_path || !liq.pagina) continue;
      try {
        const pdf = await extractSinglePagePdf(liq.file_path, liq.pagina);
        const label = sanitizeFilename(
          `${liq.anio}-${String(liq.mes).padStart(2, '0')}_${liq.etiqueta || 'liquidacion'}.pdf`
        );
        archive.append(pdf, { name: `liquidaciones/${label}` });
      } catch {
        /* omitir liquidación fallida */
      }
    }
  }

  await archive.finalize();
}

module.exports = {
  armarResumenCarpeta,
  exportarCarpetaZip,
  docsResumenForFuncionario,
};
