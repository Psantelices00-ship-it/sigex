const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal, requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const { etiquetaPeriodo } = require('../lib/personalLiquidacionParse');
const { buildLiquidacionesExportPdf, extractSinglePagePdf } = require('../lib/personalLiquidacionExport');
const { cargarLiquidacionesPdf } = require('../lib/personalLiquidacionService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.pdf')) return cb(null, true);
    cb(new Error('Solo se aceptan archivos PDF (.pdf)'));
  },
});

function parseIntSafe(v, def = null) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}

function periodoLabel(row) {
  if (row?.etiqueta) return row.etiqueta;
  return etiquetaPeriodo(row?.mes, row?.anio) || '—';
}

function resolveRutInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const parts = normalizeRutParts(raw);
  return parts?.rut_normalizado || null;
}

function resolveConsultaTermino(query) {
  const raw = String(query?.rut ?? query?.nombre ?? query?.q ?? '').trim();
  if (!raw) return { rut: null, termino: null };
  const rut = resolveRutInput(raw);
  if (rut) return { rut, termino: raw };
  return { rut: null, termino: raw };
}

function nombreBusquedaTokens(input) {
  const tokens = String(input || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length) return tokens;
  const whole = String(input || '').trim().toLowerCase();
  return whole.length >= 3 ? [whole] : [];
}

function sqlNombreTokens(haystackExpr, tokens, params) {
  let clause = '';
  for (const tok of tokens) {
    params.push(`%${tok}%`);
    clause += ` AND LOWER(${haystackExpr}) LIKE $${params.length}`;
  }
  return clause;
}

async function buscarCoincidenciasPorNombre(termino) {
  const tokens = nombreBusquedaTokens(termino);
  if (!tokens.length) return [];

  const params = [];
  const haystackLiq =
    "COALESCE(r.nombre_completo, '') || ' ' || COALESCE(r.apellido_paterno, '') || ' ' || COALESCE(r.apellido_materno, '') || ' ' || COALESCE(r.nombres, '')";
  const liqClause = sqlNombreTokens(haystackLiq, tokens, params);
  const funcClause = sqlNombreTokens('COALESCE(f.nombre_completo, \'\')', tokens, params);

  const r = await db.query(
    `SELECT DISTINCT ON (sub.rut_normalizado)
            sub.rut_normalizado,
            sub.rut_display,
            sub.nombre_completo,
            sub.cargo,
            sub.establecimiento
     FROM (
       SELECT r.rut_normalizado,
              COALESCE(NULLIF(trim(r.rut_display), ''), r.rut_normalizado) AS rut_display,
              r.nombre_completo,
              r.cargo,
              r.establecimiento,
              0 AS prioridad
       FROM personal_liquidaciones_registros r
       WHERE 1=1${liqClause}
       UNION ALL
       SELECT f.rut_normalizado,
              f.rut_numero || '-' || upper(f.rut_dv) AS rut_display,
              f.nombre_completo,
              COALESCE(f.planta, '') AS cargo,
              COALESCE(f.ubicacion, '') AS establecimiento,
              1 AS prioridad
       FROM personal_funcionarios f
       WHERE f.activo = TRUE${funcClause}
     ) sub
     ORDER BY sub.rut_normalizado, sub.prioridad, sub.nombre_completo
     LIMIT 25`,
    params
  );

  return r.rows.map((row) => ({
    rut_normalizado: row.rut_normalizado,
    rut: formatearRut(row.rut_normalizado) || row.rut_display,
    rut_display: row.rut_display,
    nombre_completo: row.nombre_completo,
    cargo: row.cargo || null,
    establecimiento: row.establecimiento || null,
  }));
}

function parseRangoConsulta(query) {
  const desdeMes = parseIntSafe(query.desde_mes, 1);
  const desdeAnio = parseIntSafe(query.desde_anio, 2000);
  const hastaMes = parseIntSafe(query.hasta_mes, 12);
  const hastaAnio = parseIntSafe(query.hasta_anio, new Date().getFullYear());
  const desdeKey = desdeAnio * 100 + desdeMes;
  const hastaKey = hastaAnio * 100 + hastaMes;
  return {
    desdeMes,
    desdeAnio,
    hastaMes,
    hastaAnio,
    desdeKey: Math.min(desdeKey, hastaKey),
    hastaKey: Math.max(desdeKey, hastaKey),
  };
}

const ULTIMAS_LIQUIDACIONES_PERMITIDAS = new Set([3, 6, 12, 24]);

function parseUltimasLiquidaciones(query) {
  const n = parseIntSafe(query?.ultimas);
  if (!n || !ULTIMAS_LIQUIDACIONES_PERMITIDAS.has(n)) return null;
  return n;
}

async function consultaLiquidacionesPorRut(rut, rango, ultimas) {
  let rows;
  if (ultimas) {
    const r = await db.query(
      `SELECT r.id, r.pagina, r.rut_display, r.apellido_paterno, r.apellido_materno, r.nombres,
              r.nombre_completo, r.cargo, r.establecimiento, r.funcionario_id,
              p.id AS periodo_id, p.mes, p.anio, p.etiqueta, p.establecimiento AS periodo_establecimiento
       FROM personal_liquidaciones_registros r
       JOIN personal_liquidaciones_periodos p ON p.id = r.periodo_id
       WHERE r.rut_normalizado = $1
         AND p.estado = 'completo'
       ORDER BY p.anio DESC, p.mes DESC, r.pagina
       LIMIT $2`,
      [rut, ultimas]
    );
    rows = [...r.rows].reverse();
  } else {
    const r = await db.query(
      `SELECT r.id, r.pagina, r.rut_display, r.apellido_paterno, r.apellido_materno, r.nombres,
              r.nombre_completo, r.cargo, r.establecimiento, r.funcionario_id,
              p.id AS periodo_id, p.mes, p.anio, p.etiqueta, p.establecimiento AS periodo_establecimiento
       FROM personal_liquidaciones_registros r
       JOIN personal_liquidaciones_periodos p ON p.id = r.periodo_id
       WHERE r.rut_normalizado = $1
         AND p.estado = 'completo'
         AND (p.anio * 100 + p.mes) BETWEEN $2 AND $3
       ORDER BY p.anio, p.mes, r.pagina`,
      [rut, rango.desdeKey, rango.hastaKey]
    );
    rows = r.rows;
  }

  const funcionario = await db.query(
    'SELECT id, rut_normalizado, nombre_completo, tipo_funcionario, planta FROM personal_funcionarios WHERE rut_normalizado = $1',
    [rut]
  );

  return { rows, funcionario: funcionario.rows[0] || null };
}

async function liquidacionesParaExportar(rut, rango, ultimas) {
  if (ultimas) {
    const r = await db.query(
      `SELECT r.pagina, r.nombre_completo, r.rut_display,
              p.file_path, p.mes, p.anio, p.etiqueta
       FROM personal_liquidaciones_registros r
       JOIN personal_liquidaciones_periodos p ON p.id = r.periodo_id
       WHERE r.rut_normalizado = $1
         AND p.estado = 'completo'
         AND p.file_path IS NOT NULL AND trim(p.file_path) <> ''
       ORDER BY p.anio DESC, p.mes DESC, r.pagina
       LIMIT $2`,
      [rut, ultimas]
    );
    return [...r.rows].reverse();
  }

  const r = await db.query(
    `SELECT r.pagina, r.nombre_completo, r.rut_display,
            p.file_path, p.mes, p.anio, p.etiqueta
     FROM personal_liquidaciones_registros r
     JOIN personal_liquidaciones_periodos p ON p.id = r.periodo_id
     WHERE r.rut_normalizado = $1
       AND p.estado = 'completo'
       AND p.file_path IS NOT NULL AND trim(p.file_path) <> ''
       AND (p.anio * 100 + p.mes) BETWEEN $2 AND $3
     ORDER BY p.anio, p.mes, r.pagina`,
    [rut, rango.desdeKey, rango.hastaKey]
  );
  return r.rows;
}

/** GET /liquidaciones/periodos */
router.get('/liquidaciones/periodos', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const r = await db.query(
      `SELECT id, mes, anio, etiqueta, establecimiento, nombre_archivo, file_size,
              total_paginas, total_registros, estado, error_mensaje, cargado_por, created_at
       FROM personal_liquidaciones_periodos
       ORDER BY anio DESC, mes DESC, created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar períodos' });
  }
});

/** GET /liquidaciones/periodos/:id */
router.get('/liquidaciones/periodos/:id', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const r = await db.query('SELECT * FROM personal_liquidaciones_periodos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al cargar período' });
  }
});

/** POST /liquidaciones/periodos — carga PDF mensual */
router.post('/liquidaciones/periodos', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjuntá el PDF mensual de liquidaciones' });
    }

    const mesBody = parseIntSafe(req.body?.mes);
    const anioBody = parseIntSafe(req.body?.anio);
    const establecimientoBody = String(req.body?.establecimiento || '').trim() || undefined;

    const result = await cargarLiquidacionesPdf({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      usuarioLogin: req.user.login,
      mes: mesBody || undefined,
      anio: anioBody || undefined,
      establecimiento: establecimientoBody,
      reemplazar: req.body?.reemplazar === '1' || req.body?.reemplazar === 'true',
    });

    await registrarAuditoriaPersonal(req, {
      accion: 'liquidaciones_carga_mes',
      entidad: 'personal_liquidaciones_periodos',
      entidad_id: result.periodo.id,
      detalle_json: {
        mes: result.mes,
        anio: result.anio,
        establecimiento: result.establecimiento,
        total_registros: result.total_registros,
        nombre_archivo: req.file.originalname,
      },
    });

    res.status(201).json(result.periodo);
  } catch (err) {
    console.error('[personal/liquidaciones/carga]', err);
    if (err.code === 'DUPLICATE_PERIODO') {
      return res.status(409).json({
        error: `${err.message}. Eliminá el período anterior o marcá reemplazar.`,
        periodo_id: err.periodo_id,
      });
    }
    res.status(500).json({ error: err.message || 'Error al procesar liquidaciones' });
  }
});

/** DELETE /liquidaciones/periodos/:id */
router.delete('/liquidaciones/periodos/:id', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const r = await db.query(
      'DELETE FROM personal_liquidaciones_periodos WHERE id = $1 RETURNING id, etiqueta',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    await registrarAuditoriaPersonal(req, {
      accion: 'liquidaciones_eliminar_mes',
      entidad: 'personal_liquidaciones_periodos',
      entidad_id: req.params.id,
      detalle_json: { etiqueta: r.rows[0].etiqueta },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al eliminar período' });
  }
});

/** GET /liquidaciones/periodos/:id/archivo — PDF mensual completo */
router.get('/liquidaciones/periodos/:id/archivo', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const r = await db.query('SELECT * FROM personal_liquidaciones_periodos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    const row = r.rows[0];
    if (!row.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(row.file_path, res, {
      mimeType: 'application/pdf',
      filename: row.nombre_archivo || 'liquidaciones.pdf',
      download: req.query.download === '1',
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al abrir archivo' });
  }
});

/** GET /liquidaciones/consulta — por RUT o nombre (apellidos / nombres) */
router.get('/liquidaciones/consulta', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const { rut: rutDirecto, termino } = resolveConsultaTermino(req.query);
    if (!rutDirecto && !termino) {
      return res.status(400).json({ error: 'Indicá un RUT o nombre para buscar' });
    }

    const rango = parseRangoConsulta(req.query);
    const ultimas = parseUltimasLiquidaciones(req.query);
    const rangoJson = {
      desde: { mes: rango.desdeMes, anio: rango.desdeAnio },
      hasta: { mes: rango.hastaMes, anio: rango.hastaAnio },
      ultimas,
    };

    let rut = rutDirecto;
    if (!rut) {
      const coincidencias = await buscarCoincidenciasPorNombre(termino);
      if (!coincidencias.length) {
        return res.json({
          multiple: false,
          termino_busqueda: termino,
          rut: null,
          rut_normalizado: null,
          funcionario: null,
          ...rangoJson,
          total: 0,
          liquidaciones: [],
        });
      }
      if (coincidencias.length > 1) {
        return res.json({
          multiple: true,
          termino_busqueda: termino,
          coincidencias,
          ...rangoJson,
        });
      }
      rut = coincidencias[0].rut_normalizado;
    }

    const { rows, funcionario } = await consultaLiquidacionesPorRut(rut, rango, ultimas);

    res.json({
      multiple: false,
      termino_busqueda: termino || null,
      rut: formatearRut(rut),
      rut_normalizado: rut,
      funcionario,
      ...rangoJson,
      total: rows.length,
      liquidaciones: rows.map((row) => ({
        ...row,
        periodo_label: periodoLabel(row),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error en consulta' });
  }
});

/** POST /liquidaciones/exportar — PDF con liquidaciones de un funcionario en un rango */
router.post('/liquidaciones/exportar', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const rut = resolveRutInput(req.body?.rut);
    if (!rut) return res.status(400).json({ error: 'Indicá un RUT válido' });

    const rango = parseRangoConsulta(req.body);
    const ultimas = parseUltimasLiquidaciones(req.body);

    const exportRows = await liquidacionesParaExportar(rut, rango, ultimas);

    if (!exportRows.length) {
      return res.status(404).json({ error: 'No hay liquidaciones para ese RUT en el período indicado' });
    }

    const items = exportRows.map((row) => ({
      file_path: row.file_path,
      pagina: row.pagina,
      etiqueta: periodoLabel(row),
    }));

    const pdfBuffer = await buildLiquidacionesExportPdf(items);
    const nombre = exportRows[0].nombre_completo || rut;
    const safeName = String(nombre)
      .replace(/[/\\:*?"<>|]/g, '_')
      .slice(0, 80);
    const fname = ultimas
      ? `liquidaciones_${safeName}_ultimas_${ultimas}.pdf`
      : `liquidaciones_${safeName}_${rango.desdeAnio}-${String(rango.desdeMes).padStart(2, '0')}_${rango.hastaAnio}-${String(rango.hastaMes).padStart(2, '0')}.pdf`;

    await registrarAuditoriaPersonal(req, {
      accion: 'liquidaciones_exportar',
      entidad: 'personal_liquidaciones_registros',
      detalle_json: {
        rut,
        desde_mes: rango.desdeMes,
        desde_anio: rango.desdeAnio,
        hasta_mes: rango.hastaMes,
        hasta_anio: rango.hastaAnio,
        ultimas,
        paginas: items.length,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[personal/liquidaciones/exportar]', err);
    res.status(500).json({ error: err.message || 'Error al generar PDF' });
  }
});

/** GET /liquidaciones/registros/:id/archivo — una liquidación (una página) */
router.get('/liquidaciones/registros/:id/archivo', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const r = await db.query(
      `SELECT r.*, p.file_path, p.etiqueta, p.mes, p.anio
       FROM personal_liquidaciones_registros r
       JOIN personal_liquidaciones_periodos p ON p.id = r.periodo_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    const row = r.rows[0];
    if (!row.file_path) return res.status(404).json({ error: 'Sin archivo mensual' });

    const pdfBuffer = await extractSinglePagePdf(row.file_path, row.pagina);
    const fname = `liquidacion_${row.rut_display || 'funcionario'}_${periodoLabel(row)}.pdf`.replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al abrir liquidación' });
  }
});

module.exports = router;
