const axios = require('axios');
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'archivo';
}

function contentDispositionAttachment(filename) {
  // Conservar espacios (nomenclatura «16035886.AP Talcahuano.zip»); quitar solo caracteres peligrosos
  const safe = String(filename || 'archivo.zip')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'archivo.zip';
  const asciiFallback = sanitizeFilename(safe);
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
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
      `SELECT lr.id, lr.pagina, lr.funcionario_id, p.mes, p.anio, p.etiqueta, p.file_path
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE p.estado = 'completo'
         AND (lr.funcionario_id = $1 OR lr.rut_normalizado = $2)
       ORDER BY p.anio DESC, p.mes DESC`,
      [funcionarioId, funcionario.rut_normalizado]
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
      rut_numero: funcionario.rut_numero,
      rut_dv: funcionario.rut_dv,
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

/** RUT solo cuerpo (sin puntos, guión ni DV). Ej: 16.035.886-6 → 16035886 */
function rutNumeroSinFormato(funcionario) {
  if (funcionario?.rut_numero) {
    const n = String(funcionario.rut_numero).replace(/\D/g, '');
    if (n) return n;
  }
  const raw = String(funcionario?.rut_normalizado || funcionario?.rut || '').trim();
  if (raw.includes('-')) {
    return raw.split('-')[0].replace(/\D/g, '');
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, -1);
  return digits || 'sin_rut';
}

/**
 * Nomenclatura ZIP / carpeta interna:
 * {RUT sin DV}.AP Talcahuano  — ej. 16035886.AP Talcahuano
 */
function carpetaZipBaseName(funcionario) {
  const codigo = `${rutNumeroSinFormato(funcionario)}.AP Talcahuano`;
  // Conservar espacios; solo quitar caracteres peligrosos para filesystem
  return String(codigo)
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'carpeta';
}

async function liquidacionesRowsForFuncionario(funcionarioId, rutNormalizado) {
  const liq = await db.query(
    `SELECT lr.pagina, lr.id AS registro_id, p.mes, p.anio, p.etiqueta, p.file_path
     FROM personal_liquidaciones_registros lr
     JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
     WHERE p.estado = 'completo'
       AND p.file_path IS NOT NULL AND trim(p.file_path) <> ''
       AND (lr.funcionario_id = $1 OR lr.rut_normalizado = $2)
     ORDER BY p.anio, p.mes`,
    [funcionarioId, rutNormalizado]
  );
  return liq.rows;
}

async function listarCarpetasResumen(filters = {}) {
  const estado = String(filters.estado || 'todos').trim();
  const q = String(filters.q || '').trim().toLowerCase();

  let sql = `
    SELECT f.id, f.rut_normalizado, f.rut_numero, f.rut_dv, f.nombre_completo,
           f.tipo_funcionario, f.estado_laboral, f.activo, f.planta, f.ubicacion,
           f.tipo_contrato, f.fecha_ingreso,
           COUNT(d.id) FILTER (WHERE d.es_activo) AS total_documentos,
           COUNT(d.id) FILTER (WHERE d.es_activo AND d.tipo_documental = 'consolidado_antiguo') AS consolidados,
           COUNT(d.id) FILTER (WHERE d.es_activo AND d.tipo_documental = 'anexo') AS anexos,
           COUNT(d.id) FILTER (
             WHERE d.es_activo AND d.tipo_documental NOT IN ('anexo', 'consolidado_antiguo')
           ) AS obligatorios_cargados
    FROM personal_funcionarios f
    LEFT JOIN personal_documentos d ON d.funcionario_id = f.id
    WHERE 1=1`;
  const params = [];
  if (estado === 'activo' || estado === 'inactivo') {
    params.push(estado);
    sql += ` AND f.estado_laboral = $${params.length}`;
  }
  sql += ` GROUP BY f.id ORDER BY f.nombre_completo`;

  const [funcs, licAgg, liqAgg] = await Promise.all([
    db.query(sql, params),
    db.query(`SELECT funcionario_id, COUNT(*)::int AS total FROM personal_licencias GROUP BY funcionario_id`),
    db.query(
      `SELECT f.id AS funcionario_id,
              COUNT(lr.id) FILTER (WHERE p.estado = 'completo')::int AS total
       FROM personal_funcionarios f
       LEFT JOIN personal_liquidaciones_registros lr
         ON lr.funcionario_id = f.id
         OR (lr.funcionario_id IS NULL AND lr.rut_normalizado = f.rut_normalizado)
       LEFT JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       GROUP BY f.id`
    ),
  ]);

  const licMap = new Map(licAgg.rows.map((r) => [String(r.funcionario_id), r.total]));
  const liqMap = new Map(liqAgg.rows.map((r) => [String(r.funcionario_id), r.total]));

  let carpetas = funcs.rows.map((f) => {
    const totalObligatorios = tiposObligatoriosParaFuncionario(f.tipo_funcionario).length;
    const obligatoriosCargados = parseInt(f.obligatorios_cargados, 10) || 0;
    return {
      id: f.id,
      rut: formatearRut(f.rut_normalizado),
      rut_normalizado: f.rut_normalizado,
      nombre_completo: f.nombre_completo,
      tipo_funcionario: f.tipo_funcionario,
      estado_laboral: f.estado_laboral,
      activo: f.activo,
      planta: f.planta,
      ubicacion: f.ubicacion,
      tipo_contrato: f.tipo_contrato,
      fecha_ingreso: f.fecha_ingreso,
      resumen: {
        total_documentos: parseInt(f.total_documentos, 10) || 0,
        consolidados: parseInt(f.consolidados, 10) || 0,
        anexos: parseInt(f.anexos, 10) || 0,
        obligatorios_cargados: obligatoriosCargados,
        total_obligatorios: totalObligatorios,
        faltantes: Math.max(0, totalObligatorios - obligatoriosCargados),
        licencias: licMap.get(String(f.id)) || 0,
        liquidaciones: liqMap.get(String(f.id)) || 0,
      },
    };
  });

  if (q) {
    const qDigits = q.replace(/\D/g, '');
    carpetas = carpetas.filter((c) => {
      const nombre = String(c.nombre_completo || '').toLowerCase();
      if (nombre.includes(q)) return true;
      if (qDigits.length >= 3) {
        const rutDigits = String(c.rut_normalizado || '').replace(/\D/g, '');
        return rutDigits.includes(qDigits);
      }
      return false;
    });
  }

  return { total: carpetas.length, carpetas };
}

async function createZipArchive() {
  const { ZipArchive } = await import('archiver');
  return new ZipArchive({ zlib: { level: 6 } });
}

/**
 * @param {import('archiver').Archiver} archive
 * @param {object} opts
 */
async function appendCarpetaToArchive(archive, opts) {
  const { funcionario, documentos, liquidaciones, resumenJson, basePrefix = '' } = opts;
  const root = basePrefix ? `${String(basePrefix).replace(/\/$/, '')}/` : '';

  archive.append(JSON.stringify(resumenJson, null, 2), {
    name: `${root}resumen/resumen_funcionario.json`,
  });

  for (const doc of documentos) {
    if (!doc.file_path) continue;
    let folder = 'documentos';
    if (doc.tipo_documental === 'consolidado_antiguo') folder = 'consolidados_antiguos';
    else if (doc.tipo_documental === 'anexo') folder = 'anexos';
    else folder = `documentos/${doc.tipo_documental}`;

    try {
      const buf = await fetchFileBuffer(doc.file_path);
      const fname = sanitizeFilename(doc.nombre_archivo || `${doc.tipo_documental}.pdf`);
      archive.append(buf, { name: `${root}${folder}/${fname}` });
    } catch {
      archive.append(
        JSON.stringify({ error: 'No se pudo descargar', doc_id: doc.id, tipo: doc.tipo_documental }),
        { name: `${root}${folder}/ERROR_${doc.id}.json` }
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
        archive.append(pdf, { name: `${root}liquidaciones/${label}` });
      } catch {
        /* omitir liquidación fallida */
      }
    }
  }
}

async function datosExportCarpeta(funcionarioId, incluirLiquidaciones = true) {
  const resumen = await armarResumenCarpeta(funcionarioId);
  if (!resumen) return null;
  let liquidacionesRows = [];
  if (incluirLiquidaciones && resumen.liquidaciones_total) {
    liquidacionesRows = await liquidacionesRowsForFuncionario(
      resumen.funcionario.id,
      resumen.funcionario.rut_normalizado
    );
  }
  return {
    resumen,
    liquidacionesRows,
    resumenJson: {
      exportado_en: new Date().toISOString(),
      funcionario: resumen.funcionario,
      documentos_resumen: resumen.documentos_resumen,
      licencias: resumen.licencias,
      liquidaciones_total: resumen.liquidaciones_total,
      archivos_incluidos: resumen.documentos.length,
      liquidaciones_incluidas: liquidacionesRows.length,
    },
  };
}

/**
 * @param {object} opts
 * @param {import('express').Response} opts.res
 */
async function exportarCarpetaZip(opts) {
  const { res, funcionario, documentos, liquidaciones, resumenJson } = opts;
  const baseName = carpetaZipBaseName(funcionario);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDispositionAttachment(`${baseName}.zip`));

  const archive = await createZipArchive();

  await new Promise((resolve, reject) => {
    archive.on('error', reject);
    res.on('error', reject);
    archive.on('end', resolve);
    archive.pipe(res);
    appendCarpetaToArchive(archive, { funcionario, documentos, liquidaciones, resumenJson })
      .then(() => archive.finalize())
      .catch(reject);
  });
}

/**
 * @param {import('express').Response} res
 * @param {object} opts
 * @param {string[]} opts.funcionarioIds
 */
async function exportarCarpetasMasivoZip(res, opts) {
  const { funcionarioIds, incluirLiquidaciones = true } = opts;
  const ids = [...new Set((funcionarioIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) throw new Error('No hay funcionarios para exportar');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    contentDispositionAttachment(`carpetas_funcionarias_SIGEX_${ids.length}.zip`)
  );

  const archive = await createZipArchive();

  await new Promise(async (resolve, reject) => {
    archive.on('error', reject);
    res.on('error', reject);
    archive.on('end', resolve);
    archive.pipe(res);

    try {
      const meta = {
        exportado_en: new Date().toISOString(),
        total_solicitado: ids.length,
        incluir_liquidaciones: incluirLiquidaciones,
        funcionarios: [],
      };

      for (const id of ids) {
        const pack = await datosExportCarpeta(id, incluirLiquidaciones);
        if (!pack) continue;
        const prefix = carpetaZipBaseName(pack.resumen.funcionario);
        await appendCarpetaToArchive(archive, {
          funcionario: pack.resumen.funcionario,
          documentos: pack.resumen.documentos,
          liquidaciones: pack.liquidacionesRows,
          resumenJson: pack.resumenJson,
          basePrefix: prefix,
        });
        meta.funcionarios.push({
          id: pack.resumen.funcionario.id,
          rut: pack.resumen.funcionario.rut,
          nombre: pack.resumen.funcionario.nombre_completo,
          documentos: pack.resumen.documentos.length,
          liquidaciones: pack.liquidacionesRows.length,
        });
      }

      meta.total_exportado = meta.funcionarios.length;
      archive.append(JSON.stringify(meta, null, 2), { name: 'resumen/exportacion_masiva.json' });
      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  armarResumenCarpeta,
  listarCarpetasResumen,
  exportarCarpetaZip,
  exportarCarpetasMasivoZip,
  datosExportCarpeta,
  liquidacionesRowsForFuncionario,
  docsResumenForFuncionario,
  carpetaZipBaseName,
};
