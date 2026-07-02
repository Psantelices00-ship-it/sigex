const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { validatePersonalPdf } = require('../lib/personalPdfValidate');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal, requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const { parseLiquidacionesPdf, etiquetaPeriodo } = require('../lib/personalLiquidacionParse');
const { buildLiquidacionesExportPdf, extractSinglePagePdf } = require('../lib/personalLiquidacionExport');

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

async function insertRegistrosBatch(periodoId, registros) {
  const ruts = [...new Set(registros.map((r) => r.rut_normalizado).filter(Boolean))];
  const funcMap = new Map();
  if (ruts.length) {
    const fr = await db.query(
      `SELECT id, rut_normalizado FROM personal_funcionarios WHERE rut_normalizado = ANY($1::text[])`,
      [ruts]
    );
    for (const row of fr.rows) funcMap.set(row.rut_normalizado, row.id);
  }

  const CHUNK = 80;
  for (let i = 0; i < registros.length; i += CHUNK) {
    const slice = registros.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const reg of slice) {
      const funcionarioId = funcMap.get(reg.rut_normalizado) || null;
      values.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      params.push(
        periodoId,
        reg.pagina,
        reg.rut_normalizado,
        reg.rut_display,
        reg.apellido_paterno,
        reg.apellido_materno,
        reg.nombres,
        reg.nombre_completo,
        reg.cargo,
        reg.establecimiento,
        funcionarioId
      );
    }
    await db.query(
      `INSERT INTO personal_liquidaciones_registros
        (periodo_id, pagina, rut_normalizado, rut_display, apellido_paterno, apellido_materno,
         nombres, nombre_completo, cargo, establecimiento, funcionario_id)
       VALUES ${values.join(', ')}`,
      params
    );
  }
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
  let periodoId = null;
  try {
    if (!requireGestionPersonal(req, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjuntá el PDF mensual de liquidaciones' });
    }

    const pdfErr = validatePersonalPdf(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (pdfErr) return res.status(400).json({ error: pdfErr });

    const parsed = await parseLiquidacionesPdf(req.file.buffer);
    if (!parsed.registros.length) {
      return res.status(400).json({
        error: 'No se detectaron liquidaciones en el PDF. Verificá que sea el formato estándar DEIS/MINEDUC.',
      });
    }

    const mesBody = parseIntSafe(req.body?.mes);
    const anioBody = parseIntSafe(req.body?.anio);
    const mes = mesBody || parsed.mes;
    const anio = anioBody || parsed.anio;
    if (!mes || !anio) {
      return res.status(400).json({ error: 'No se pudo detectar mes/año. Indicalos manualmente en el formulario.' });
    }

    const establecimiento =
      String(req.body?.establecimiento || parsed.establecimiento || '').trim() || null;
    const etiqueta = String(req.body?.etiqueta || etiquetaPeriodo(mes, anio) || '').trim();

    const dup = await db.query(
      `SELECT id FROM personal_liquidaciones_periodos
       WHERE mes = $1 AND anio = $2 AND COALESCE(establecimiento, '') = COALESCE($3, '')`,
      [mes, anio, establecimiento]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        error: `Ya existe una carga para ${etiqueta}${establecimiento ? ` (${establecimiento})` : ''}. Eliminá el período anterior antes de volver a cargar.`,
        periodo_id: dup.rows[0].id,
      });
    }

    const ins = await db.query(
      `INSERT INTO personal_liquidaciones_periodos
        (mes, anio, etiqueta, establecimiento, nombre_archivo, file_path, file_size,
         total_paginas, total_registros, estado, cargado_por)
       VALUES ($1,$2,$3,$4,$5,'', $6, $7, 0, 'procesando', $8)
       RETURNING *`,
      [
        mes,
        anio,
        etiqueta,
        establecimiento,
        req.file.originalname,
        req.file.size,
        parsed.total_paginas,
        req.user.login,
      ]
    );
    periodoId = ins.rows[0].id;

    const folder = `personal/liquidaciones/${periodoId}`;
    const fname = `liquidaciones_${anio}_${String(mes).padStart(2, '0')}.pdf`;
    const uploaded = await uploadToCloudinary(req.file.buffer, fname, folder, {
      mimetype: 'application/pdf',
      originalname: req.file.originalname,
    });

    await db.query(
      `UPDATE personal_liquidaciones_periodos
       SET file_path = $1, cloudinary_public_id = $2
       WHERE id = $3`,
      [uploaded.secure_url, uploaded.public_id, periodoId]
    );

    await insertRegistrosBatch(periodoId, parsed.registros);

    const upd = await db.query(
      `UPDATE personal_liquidaciones_periodos
       SET total_registros = $1, estado = 'completo', error_mensaje = NULL
       WHERE id = $2
       RETURNING *`,
      [parsed.registros.length, periodoId]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'liquidaciones_carga_mes',
      entidad: 'personal_liquidaciones_periodos',
      entidad_id: periodoId,
      detalle_json: {
        mes,
        anio,
        establecimiento,
        total_registros: parsed.registros.length,
        nombre_archivo: req.file.originalname,
      },
    });

    res.status(201).json(upd.rows[0]);
  } catch (err) {
    console.error('[personal/liquidaciones/carga]', err);
    if (periodoId) {
      await db
        .query(
          `UPDATE personal_liquidaciones_periodos SET estado = 'error', error_mensaje = $1 WHERE id = $2`,
          [String(err.message || err).slice(0, 500), periodoId]
        )
        .catch(() => {});
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

/** GET /liquidaciones/consulta */
router.get('/liquidaciones/consulta', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const rut = resolveRutInput(req.query.rut);
    if (!rut) {
      return res.status(400).json({ error: 'Indicá un RUT válido' });
    }

    const desdeMes = parseIntSafe(req.query.desde_mes, 1);
    const desdeAnio = parseIntSafe(req.query.desde_anio, 2000);
    const hastaMes = parseIntSafe(req.query.hasta_mes, 12);
    const hastaAnio = parseIntSafe(req.query.hasta_anio, new Date().getFullYear());

    const desdeKey = desdeAnio * 100 + desdeMes;
    const hastaKey = hastaAnio * 100 + hastaMes;

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
      [rut, Math.min(desdeKey, hastaKey), Math.max(desdeKey, hastaKey)]
    );

    const funcionario = await db.query(
      'SELECT id, rut_normalizado, nombre_completo, tipo_funcionario, planta FROM personal_funcionarios WHERE rut_normalizado = $1',
      [rut]
    );

    res.json({
      rut: formatearRut(rut),
      rut_normalizado: rut,
      funcionario: funcionario.rows[0] || null,
      desde: { mes: desdeMes, anio: desdeAnio },
      hasta: { mes: hastaMes, anio: hastaAnio },
      total: r.rows.length,
      liquidaciones: r.rows.map((row) => ({
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

    const desdeMes = parseIntSafe(req.body?.desde_mes, 1);
    const desdeAnio = parseIntSafe(req.body?.desde_anio, 2000);
    const hastaMes = parseIntSafe(req.body?.hasta_mes, 12);
    const hastaAnio = parseIntSafe(req.body?.hasta_anio, new Date().getFullYear());
    const desdeKey = desdeAnio * 100 + desdeMes;
    const hastaKey = hastaAnio * 100 + hastaMes;

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
      [rut, Math.min(desdeKey, hastaKey), Math.max(desdeKey, hastaKey)]
    );

    if (!r.rows.length) {
      return res.status(404).json({ error: 'No hay liquidaciones para ese RUT en el período indicado' });
    }

    const items = r.rows.map((row) => ({
      file_path: row.file_path,
      pagina: row.pagina,
      etiqueta: periodoLabel(row),
    }));

    const pdfBuffer = await buildLiquidacionesExportPdf(items);
    const nombre = r.rows[0].nombre_completo || rut;
    const safeName = String(nombre)
      .replace(/[/\\:*?"<>|]/g, '_')
      .slice(0, 80);
    const fname = `liquidaciones_${safeName}_${desdeAnio}-${String(desdeMes).padStart(2, '0')}_${hastaAnio}-${String(hastaMes).padStart(2, '0')}.pdf`;

    await registrarAuditoriaPersonal(req, {
      accion: 'liquidaciones_exportar',
      entidad: 'personal_liquidaciones_registros',
      detalle_json: { rut, desde_mes: desdeMes, desde_anio: desdeAnio, hasta_mes: hastaMes, hasta_anio: hastaAnio, paginas: items.length },
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
