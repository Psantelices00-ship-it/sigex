const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const ESTABLECIMIENTOS_RBD = require('../lib/establecimientosRbd');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ESTADOS_VALIDOS = new Set(['Ingresada', 'En revisión', 'Rechazada', 'Derivada']);
const MODULOS_VALIDOS = new Set(['compras', 'contratos', 'honorarios', 'caja_chica']);
const ORIGENES_VALIDOS = new Set(['RBD', 'Infraestructura', 'Administración central']);

function areaEtiqueta(origen_area, establecimiento) {
  if (origen_area === 'RBD') return (establecimiento && String(establecimiento).trim()) || 'RBD (sin establecimiento)';
  return origen_area || '—';
}

function logHistorial(solicitudId, usuario, accion, nota, tipo, documentoId = null) {
  return db.query(
    'INSERT INTO solicitudes_historial (solicitud_id, usuario, accion, nota, tipo, documento_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [solicitudId, usuario, accion, nota, tipo, documentoId]
  );
}

router.get('/meta/establecimientos', auth, (req, res) => {
  res.json({ establecimientos: ESTABLECIMIENTOS_RBD });
});

router.get('/', auth, async (req, res) => {
  try {
    const { q, estado, modulo_destino, doc_q } = req.query;
    let query = `SELECT s.*,
      e.numero as expediente_numero
      FROM solicitudes s
      LEFT JOIN expedientes e ON e.id = s.expediente_id
      WHERE 1=1`;
    const params = [];
    let i = 1;
    if (estado) {
      query += ` AND s.estado = $${i++}`;
      params.push(estado);
    }
    if (modulo_destino) {
      query += ` AND s.modulo_destino = $${i++}`;
      params.push(modulo_destino);
    }
    if (q) {
      const p = `%${q}%`;
      query += ` AND (
        s.numero ILIKE $${i} OR s.numero_vinculacion ILIKE $${i}
        OR s.descripcion ILIKE $${i} OR s.solicitante ILIKE $${i}
        OR COALESCE(s.establecimiento,'') ILIKE $${i}
        OR COALESCE(s.origen_area,'') ILIKE $${i}
        OR s.area ILIKE $${i}
      )`;
      params.push(p);
      i++;
    }
    if (doc_q) {
      const p = `%${doc_q}%`;
      query += ` AND EXISTS (
        SELECT 1 FROM solicitudes_documentos d
        WHERE d.solicitud_id = s.id
        AND (d.nombre ILIKE $${i} OR d.tipo ILIKE $${i} OR COALESCE(d.observacion,'') ILIKE $${i})
      )`;
      params.push(p);
      i++;
    }
    if (req.query.para_vincular_compras === 'true' || req.query.para_vincular_compras === '1') {
      query += ` AND s.expediente_id IS NULL AND s.modulo_destino = 'compras' AND s.estado = 'Derivada'`;
    }
    query += ' ORDER BY s.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function nombreArchivoDescarga(row) {
  let n = (row.nombre && String(row.nombre).trim()) || 'documento';
  const mime = (row.mime_type || '').toLowerCase();
  const url = (row.file_path || '').toLowerCase();
  const isPdf = mime.includes('pdf') || url.includes('.pdf') || (row.formato || '').toUpperCase() === 'PDF';
  if (isPdf && !/\.pdf$/i.test(n)) n = `${n.replace(/\.+$/i, '')}.pdf`;
  return n.slice(0, 200);
}

router.get('/:id/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const doc = await db.query(
      'SELECT * FROM solicitudes_documentos WHERE id = $1 AND solicitud_id = $2',
      [req.params.docId, req.params.id]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = doc.rows[0];
    if (!row.file_path) return res.status(404).json({ error: 'Sin archivo' });
    const fname = nombreArchivoDescarga(row);
    let mime = row.mime_type && String(row.mime_type).trim();
    if (!mime || mime.includes('octet-stream')) {
      mime = fname.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mime || 'application/octet-stream';
    }
    await streamRemoteFileToResponse(row.file_path, res, { mimeType: mime, filename: fname });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.post('/:id/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const sol = await db.query('SELECT id FROM solicitudes WHERE id = $1', [req.params.id]);
    if (!sol.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo' });
    const { nombre, tipo, version, observacion } = req.body;
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const fname = `${Date.now()}-${baseName}.${ext}`;
    const uploaded = await uploadToCloudinary(req.file.buffer, fname, `solicitudes/${req.params.id}/docs`, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    const file_path = uploaded.secure_url;
    const result = await db.query(
      `INSERT INTO solicitudes_documentos (solicitud_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.params.id,
        nombre || req.file.originalname,
        tipo || 'Adjunto',
        req.body.formato || 'PDF',
        version || 1,
        observacion || null,
        file_path,
        req.file.size,
        req.file.mimetype,
        req.user.login,
      ]
    );
    const docRow = result.rows[0];
    await logHistorial(
      req.params.id,
      req.user.login,
      'Documento adjunto',
      `${docRow.nombre} (${docRow.tipo})`,
      'documento',
      docRow.id
    );
    res.status(201).json(docRow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/documentos/:docId', auth, async (req, res) => {
  try {
    const doc = await db.query(
      'SELECT * FROM solicitudes_documentos WHERE id = $1 AND solicitud_id = $2',
      [req.params.docId, req.params.id]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'No encontrado' });
    await db.query('DELETE FROM solicitudes_documentos WHERE id = $1', [req.params.docId]);
    await logHistorial(req.params.id, req.user.login, 'Documento eliminado', doc.rows[0].nombre, 'documento', null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const row = await db.query(
      `SELECT s.*, e.numero as expediente_numero
       FROM solicitudes s
       LEFT JOIN expedientes e ON e.id = s.expediente_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query(
      'SELECT * FROM solicitudes_documentos WHERE solicitud_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    const hist = await db.query(
      'SELECT * FROM solicitudes_historial WHERE solicitud_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const sol = row.rows[0];
    const historial = hist.rows.map((h) => ({
      ...h,
      solicitud_numero: sol.numero,
      solicitud_solicitante: sol.solicitante,
      solicitud_vinculacion: sol.numero_vinculacion || null,
    }));
    res.json({ ...sol, documentos: docs.rows, historial });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const {
      descripcion,
      solicitante,
      tipo_gasto,
      monto,
      prioridad,
      fecha_ingreso,
      observaciones,
      expediente_id,
      numero_vinculacion,
      origen_area: origenBody,
      establecimiento,
    } = req.body;
    const origen_area = ORIGENES_VALIDOS.has(origenBody) ? origenBody : 'Administración central';
    const est = establecimiento != null ? String(establecimiento).trim() : '';
    if (origen_area === 'RBD' && !est) {
      return res.status(400).json({ error: 'Si el origen es RBD debe indicar el establecimiento' });
    }
    if (!descripcion || !String(descripcion).trim()) {
      return res.status(400).json({ error: 'La descripción es obligatoria' });
    }
    if (!solicitante || !String(solicitante).trim()) {
      return res.status(400).json({ error: 'El solicitante es obligatorio' });
    }
    if (expediente_id) {
      const ex = await db.query('SELECT id FROM expedientes WHERE id = $1', [expediente_id]);
      if (!ex.rows.length) return res.status(400).json({ error: 'Expediente no existe' });
    }
    const year = new Date().getFullYear();
    const nums = await db.query(
      'SELECT numero FROM solicitudes WHERE EXTRACT(YEAR FROM created_at) = $1',
      [year]
    );
    const re = new RegExp(`^SOL-${year}-(\\d+)$`);
    let maxSeq = 0;
    for (const row of nums.rows) {
      const m = row.numero && String(row.numero).match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    const numero = `SOL-${year}-${String(maxSeq + 1).padStart(5, '0')}`;
    const toNum = (v) => {
      if (v === '' || v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const nv =
      numero_vinculacion != null && String(numero_vinculacion).trim()
        ? String(numero_vinculacion).trim().slice(0, 80)
        : null;
    const area = String(areaEtiqueta(origen_area, est || null)).slice(0, 80);
    const result = await db.query(
      `INSERT INTO solicitudes (
        expediente_id, numero, numero_vinculacion, descripcion, solicitante, area, origen_area, establecimiento,
        tipo_gasto, monto, prioridad, estado, modulo_destino, fecha_ingreso, observaciones, creado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Ingresada',NULL,$12,$13,$14) RETURNING *`,
      [
        expediente_id || null,
        numero,
        nv,
        String(descripcion).trim(),
        String(solicitante).trim().slice(0, 100),
        area,
        origen_area,
        origen_area === 'RBD' ? est : null,
        tipo_gasto || null,
        toNum(monto),
        prioridad || 'Normal',
        fecha_ingreso || new Date().toISOString().slice(0, 10),
        observaciones || null,
        req.user.login,
      ]
    );
    const nota = [`N° ${numero}`, nv ? `Vinculación: ${nv}` : null, `Origen: ${origen_area}`].filter(Boolean).join(' · ');
    await logHistorial(result.rows[0].id, req.user.login, 'Solicitud creada', nota, 'creacion', null);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const {
      estado,
      modulo_destino,
      motivo_rechazo,
      expediente_id,
      observaciones,
      numero_vinculacion,
      origen_area: origenBody,
      establecimiento,
    } = req.body;
    const prev = await db.query('SELECT * FROM solicitudes WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const p = prev.rows[0];
    const updates = [];
    const params = [];
    let i = 1;
    if (estado !== undefined) {
      if (!ESTADOS_VALIDOS.has(estado)) {
        return res.status(400).json({ error: `Estado no válido. Use: ${[...ESTADOS_VALIDOS].join(', ')}` });
      }
      updates.push(`estado = $${i++}`);
      params.push(estado);
    }
    if (modulo_destino !== undefined) {
      if (modulo_destino === null || modulo_destino === '') {
        updates.push('modulo_destino = NULL');
      } else {
        if (!MODULOS_VALIDOS.has(modulo_destino)) {
          return res.status(400).json({ error: `Módulo no válido. Use: ${[...MODULOS_VALIDOS].join(', ')}` });
        }
        updates.push(`modulo_destino = $${i++}`);
        params.push(modulo_destino);
      }
    }
    if (motivo_rechazo !== undefined) {
      updates.push(`motivo_rechazo = $${i++}`);
      params.push(motivo_rechazo || null);
    }
    if (expediente_id !== undefined) {
      if (expediente_id === null || expediente_id === '') {
        updates.push('expediente_id = NULL');
      } else {
        const ex = await db.query('SELECT id FROM expedientes WHERE id = $1', [expediente_id]);
        if (!ex.rows.length) return res.status(400).json({ error: 'Expediente no existe' });
        updates.push(`expediente_id = $${i++}`);
        params.push(expediente_id);
      }
    }
    if (observaciones !== undefined) {
      updates.push(`observaciones = $${i++}`);
      params.push(observaciones);
    }
    if (numero_vinculacion !== undefined) {
      const nv =
        numero_vinculacion != null && String(numero_vinculacion).trim()
          ? String(numero_vinculacion).trim().slice(0, 80)
          : null;
      updates.push(`numero_vinculacion = $${i++}`);
      params.push(nv);
    }
    if (origenBody !== undefined) {
      if (!ORIGENES_VALIDOS.has(origenBody)) {
        return res.status(400).json({ error: `Origen no válido. Use: ${[...ORIGENES_VALIDOS].join(', ')}` });
      }
      updates.push(`origen_area = $${i++}`);
      params.push(origenBody);
    }
    if (establecimiento !== undefined) {
      updates.push(`establecimiento = $${i++}`);
      params.push(establecimiento != null && String(establecimiento).trim() ? String(establecimiento).trim() : null);
    }
    const effectiveOrigen = origenBody !== undefined ? origenBody : (p.origen_area || 'Administración central');
    const effectiveEst = establecimiento !== undefined ? (establecimiento != null ? String(establecimiento).trim() : '') : (p.establecimiento || '');
    if (origenBody !== undefined || establecimiento !== undefined) {
      if (effectiveOrigen === 'RBD' && !effectiveEst) {
        return res.status(400).json({ error: 'Si el origen es RBD debe indicar el establecimiento' });
      }
      const areaLabel = String(
        areaEtiqueta(effectiveOrigen, effectiveOrigen === 'RBD' ? effectiveEst : null)
      ).slice(0, 80);
      updates.push(`area = $${i++}`);
      params.push(areaLabel);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const q = `UPDATE solicitudes SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`;
    const result = await db.query(q, params);
    const row = result.rows[0];
    const notas = [];
    if (estado !== undefined && estado !== p.estado) notas.push(`Estado: ${p.estado} → ${estado}`);
    if (modulo_destino !== undefined) notas.push(`Módulo destino: ${modulo_destino || '—'}`);
    if (numero_vinculacion !== undefined) notas.push('N° vinculación actualizado');
    if (origenBody !== undefined || establecimiento !== undefined) notas.push(`Origen / establecimiento actualizado`);
    await logHistorial(req.params.id, req.user.login, 'Solicitud actualizada', notas.join(' · ') || 'Cambios registrados', 'edicion', null);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') {
      return res.status(403).json({ error: 'Solo Super Admin puede eliminar solicitudes' });
    }
    const prev = await db.query(
      'SELECT id, numero, expediente_id FROM solicitudes WHERE id = $1',
      [req.params.id]
    );
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrada' });
    if (prev.rows[0].expediente_id) {
      return res.status(400).json({
        error:
          'No se puede eliminar: la solicitud está incorporada en un expediente de compra. Desvinculá desde Compras si corresponde.',
        expediente_id: prev.rows[0].expediente_id,
      });
    }
    await db.query('DELETE FROM solicitudes WHERE id = $1', [req.params.id]);
    res.json({ ok: true, numero: prev.rows[0].numero });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
