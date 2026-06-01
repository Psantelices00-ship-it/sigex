const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const {
  puedeEditarHonorario,
  diffHonorario,
  registrarAuditoriaHonorario,
} = require('../lib/honorarioAuditoria');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function periodoLabel(mes, anio) {
  const mi = Math.min(Math.max(Number(mes) || 1, 1), 12);
  const yi = Number(anio) || new Date().getFullYear();
  return `${MESES[mi - 1]} ${yi}`;
}

router.get('/', auth, async (req, res) => {
  try {
    const { q, estado } = req.query;
    let query = `SELECT h.*,
      (SELECT COUNT(*)::int FROM honorarios_documentos hd WHERE hd.honorario_id = h.id) AS docs_base,
      (SELECT COUNT(*)::int FROM honorarios_pagos hp WHERE hp.honorario_id = h.id) AS total_pagos
      FROM honorarios h WHERE 1=1`;
    const params = [];
    let i = 1;
    if (q) {
      query += ` AND (h.numero ILIKE $${i} OR h.nombre ILIKE $${i} OR h.profesional ILIKE $${i})`;
      params.push(`%${q}%`);
      i++;
    }
    if (estado) {
      query += ` AND h.estado = $${i++}`;
      params.push(estado);
    }
    query += ' ORDER BY h.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM honorarios_documentos WHERE id=$1 AND honorario_id=$2',
      [req.params.docId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const doc = row.rows[0];
    if (!doc.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(doc.file_path, res, { mimeType: doc.mime_type, filename: doc.nombre });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/:id/pagos/:pagoId/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM honorarios_pagos_docs WHERE id=$1 AND pago_id=$2 AND honorario_id=$3',
      [req.params.docId, req.params.pagoId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const doc = row.rows[0];
    if (!doc.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(doc.file_path, res, { mimeType: doc.mime_type, filename: doc.nombre });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const hon = await db.query('SELECT * FROM honorarios WHERE id=$1', [req.params.id]);
    if (!hon.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query('SELECT * FROM honorarios_documentos WHERE honorario_id=$1 ORDER BY created_at', [req.params.id]);
    const pagos = await db.query(
      `SELECT hp.*,
        COALESCE(json_agg(hpd.* ORDER BY hpd.created_at) FILTER (WHERE hpd.id IS NOT NULL), '[]') AS documentos
       FROM honorarios_pagos hp
       LEFT JOIN honorarios_pagos_docs hpd ON hpd.pago_id = hp.id
       WHERE hp.honorario_id = $1
       GROUP BY hp.id
       ORDER BY hp.anio, hp.mes`,
      [req.params.id]
    );
    const pagosNorm = pagos.rows.map((p) => ({
      ...p,
      documentos: Array.isArray(p.documentos) ? p.documentos.filter((d) => d && d.id) : [],
    }));
    res.json({ ...hon.rows[0], documentos: docs.rows, pagos: pagosNorm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const {
      nombre,
      objeto,
      profesional,
      rut_profesional,
      monto_mensual,
      moneda,
      fecha_inicio,
      fecha_termino,
      area,
      observaciones,
      estado,
    } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre es obligatorio' });
    if (!profesional || !String(profesional).trim()) return res.status(400).json({ error: 'Profesional es obligatorio' });
    const year = new Date().getFullYear();
    const count = await db.query('SELECT COUNT(*) FROM honorarios WHERE EXTRACT(YEAR FROM created_at)=$1', [year]);
    const numero = `HN-${year}-${String(parseInt(count.rows[0].count, 10) + 1).padStart(4, '0')}`;
    const result = await db.query(
      `INSERT INTO honorarios (numero, nombre, objeto, profesional, rut_profesional, monto_mensual, moneda, fecha_inicio, fecha_termino, area, observaciones, estado, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        numero,
        String(nombre).trim(),
        objeto || null,
        String(profesional).trim(),
        rut_profesional || null,
        Number(monto_mensual) || 0,
        ['CLP', 'UF', 'USD'].includes(moneda) ? moneda : 'CLP',
        fecha_inicio || null,
        fecha_termino || null,
        area || null,
        observaciones || null,
        estado || 'Vigente',
        req.user.login,
      ]
    );
    res.status(201).json({ ...result.rows[0], documentos: [], pagos: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function rutQuitarFormato(rut) {
  return String(rut || '')
    .replace(/\./g, '')
    .replace(/-/g, '')
    .trim()
    .toUpperCase();
}

function rutDvEsperado(cuerpo) {
  let suma = 0;
  let mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function validarRutChileno(rut) {
  const limpio = rutQuitarFormato(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  return rutDvEsperado(limpio.slice(0, -1)) === limpio.slice(-1);
}

const ESTADOS_HONORARIO = ['Vigente', 'Suspendido', 'Terminado', 'En Renovación'];

async function updateHonorario(req, res) {
  try {
    if (!puedeEditarHonorario(req.user)) {
      return res.status(403).json({ error: 'Sin permisos para editar encargos de honorarios' });
    }
    const prev = await db.query('SELECT * FROM honorarios WHERE id=$1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const before = prev.rows[0];

    const body = req.body || {};
    if (body.profesional !== undefined && !String(body.profesional).trim()) {
      return res.status(400).json({ error: 'El nombre del profesional es obligatorio' });
    }
    if (body.rut_profesional !== undefined) {
      const rut = String(body.rut_profesional).trim();
      if (!rut) return res.status(400).json({ error: 'El RUT es obligatorio' });
      if (!validarRutChileno(rut)) return res.status(400).json({ error: 'RUT inválido' });
      body.rut_profesional = rut;
    }
    if (body.monto_mensual !== undefined) {
      const m = Number(body.monto_mensual);
      if (!Number.isFinite(m) || m <= 0) {
        return res.status(400).json({ error: 'El monto mensual debe ser mayor a cero' });
      }
      body.monto_mensual = m;
    }
    if (body.fecha_inicio !== undefined && body.fecha_termino !== undefined) {
      if (!body.fecha_inicio || !body.fecha_termino) {
        return res.status(400).json({ error: 'Las fechas de vigencia son obligatorias' });
      }
      if (String(body.fecha_inicio) >= String(body.fecha_termino)) {
        return res.status(400).json({ error: 'La fecha de inicio debe ser anterior al término' });
      }
    }
    if (body.objeto !== undefined && !String(body.objeto).trim()) {
      return res.status(400).json({ error: 'La descripción del servicio es obligatoria' });
    }
    if (body.estado !== undefined && !ESTADOS_HONORARIO.includes(String(body.estado).trim())) {
      return res.status(400).json({ error: 'Estado no válido' });
    }

    const fields = ['nombre', 'objeto', 'profesional', 'rut_profesional', 'monto_mensual', 'moneda', 'fecha_inicio', 'fecha_termino', 'area', 'observaciones', 'estado'];
    const updates = [];
    const params = [];
    let i = 1;
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        params.push(body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await db.query(
      `UPDATE honorarios SET ${updates.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    const after = result.rows[0];
    const cambios = diffHonorario(before, after, fields);
    await registrarAuditoriaHonorario(db, req.params.id, req.user?.login || req.user?.nombre, cambios);
    res.json(after);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.put('/:id', auth, updateHonorario);
router.patch('/:id', auth, updateHonorario);

router.post('/:id/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const hon = await db.query('SELECT id FROM honorarios WHERE id=$1', [req.params.id]);
    if (!hon.rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo' });
    const { nombre, tipo, version, observacion } = req.body;
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const fname = `${Date.now()}-${baseName}.${ext}`;
    const uploaded = await uploadToCloudinary(req.file.buffer, fname, `honorarios/${req.params.id}`, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    const result = await db.query(
      `INSERT INTO honorarios_documentos (honorario_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.params.id,
        nombre || req.file.originalname,
        tipo || 'Otro',
        req.body.formato || 'PDF',
        version || 1,
        observacion || null,
        uploaded.secure_url,
        req.file.size,
        req.file.mimetype,
        req.user.login,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pagos', auth, async (req, res) => {
  try {
    const { mes, anio, monto, observaciones } = req.body;
    const label = periodoLabel(mes, anio);
    const existing = await db.query('SELECT id FROM honorarios_pagos WHERE honorario_id=$1 AND mes=$2 AND anio=$3', [
      req.params.id,
      mes,
      anio,
    ]);
    if (existing.rows.length) return res.status(400).json({ error: `Ya existe un pago para ${label}` });
    const result = await db.query(
      `INSERT INTO honorarios_pagos (honorario_id, mes, anio, periodo, monto, estado, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,'Pendiente',$6,$7) RETURNING *`,
      [req.params.id, mes, anio, label, monto || 0, observaciones || null, req.user.login]
    );
    res.status(201).json({ ...result.rows[0], documentos: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pagos/:pagoId/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const pago = await db.query('SELECT id FROM honorarios_pagos WHERE id=$1 AND honorario_id=$2', [
      req.params.pagoId,
      req.params.id,
    ]);
    if (!pago.rows.length) return res.status(404).json({ error: 'Pago no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo' });
    const { nombre, tipo, version, observacion } = req.body;
    const fname = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const uploaded = await uploadToCloudinary(req.file.buffer, fname, `honorarios/${req.params.id}/pagos/${req.params.pagoId}`, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });
    const result = await db.query(
      `INSERT INTO honorarios_pagos_docs (pago_id, honorario_id, nombre, tipo, formato, version, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.params.pagoId,
        req.params.id,
        nombre || req.file.originalname,
        tipo || 'Otro',
        req.body.formato || 'PDF',
        version || 1,
        observacion || null,
        uploaded.secure_url,
        req.file.size,
        req.file.mimetype,
        req.user.login,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/pagos/:pagoId/archivo', auth, async (req, res) => {
  try {
    const { caja, estante, posicion, sala, fecha_archivo, obs_archivo } = req.body;
    const result = await db.query(
      `UPDATE honorarios_pagos SET caja=$1, estante=$2, posicion=$3, sala=$4, fecha_archivo=$5, obs_archivo=$6, archivado_por=$7
       WHERE id=$8 AND honorario_id=$9 RETURNING *`,
      [caja, estante, posicion || null, sala || null, fecha_archivo || null, obs_archivo || null, req.user.login, req.params.pagoId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/pagos/:pagoId', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT id FROM honorarios_pagos WHERE id=$1 AND honorario_id=$2', [
      req.params.pagoId,
      req.params.id,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    const updates = [];
    const params = [];
    let i = 1;
    if (req.body.monto !== undefined) {
      updates.push(`monto = $${i++}`);
      params.push(Number(req.body.monto) || 0);
    }
    if (req.body.observaciones !== undefined) {
      updates.push(`observaciones = $${i++}`);
      params.push(typeof req.body.observaciones === 'string' ? req.body.observaciones.trim() || null : null);
    }
    if (req.body.estado !== undefined) {
      updates.push(`estado = $${i++}`);
      params.push(String(req.body.estado).trim() || 'Pendiente');
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.pagoId, req.params.id);
    const result = await db.query(
      `UPDATE honorarios_pagos SET ${updates.join(', ')} WHERE id=$${i++} AND honorario_id=$${i} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/pagos/:pagoId', auth, async (req, res) => {
  try {
    const row = await db.query(
      'DELETE FROM honorarios_pagos WHERE id=$1 AND honorario_id=$2 RETURNING id',
      [req.params.pagoId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query('DELETE FROM honorarios_documentos WHERE id=$1 AND honorario_id=$2 RETURNING id', [
      req.params.docId,
      req.params.id,
    ]);
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/pagos/:pagoId/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query(
      'DELETE FROM honorarios_pagos_docs WHERE id=$1 AND pago_id=$2 AND honorario_id=$3 RETURNING id',
      [req.params.docId, req.params.pagoId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (!puedeEditarHonorario(req.user)) {
      return res.status(403).json({ error: 'Sin permisos para eliminar encargos de honorarios' });
    }
    const prev = await db.query('SELECT id, numero, nombre FROM honorarios WHERE id=$1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });
    await db.query('DELETE FROM honorarios WHERE id=$1', [req.params.id]);
    res.json({ ok: true, id: req.params.id, numero: prev.rows[0].numero });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
