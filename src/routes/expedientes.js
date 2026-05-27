const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const cloudinary = require('../cloudinary');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { uploadBuffer } = require('../lib/cloudinaryBufferUpload');
const { buildConsolidatedPdfBuffer } = require('../lib/consolidarExpedientePdf');
const { REQUIRED_CLOSURE, computeChecklist } = require('../lib/expedienteWorkflow');

async function destroyConsolidadoCloudinary(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', invalidate: true }).catch(() => {});
}

function sqlTiposObligatoriosArray() {
  return `ARRAY[${REQUIRED_CLOSURE.map((t) => "'" + String(t).replace(/'/g, "''") + "'").join(',')}]::text[]`;
}

// Listar todos
router.get('/', auth, async (req, res) => {
  try {
    const { estado, area, prioridad, q } = req.query;
    const nReq = REQUIRED_CLOSURE.length;
    const arr = sqlTiposObligatoriosArray();
    let query = `SELECT e.*, 
      (SELECT COUNT(*) FROM documentos d WHERE d.expediente_id = e.id) as total_docs,
      ${nReq} as docs_obligatorios_total,
      (${nReq} - COALESCE((
        SELECT COUNT(DISTINCT d.tipo)::int FROM documentos d
        WHERE d.expediente_id = e.id AND d.tipo = ANY(${arr})
      ), 0)) as docs_faltantes
      FROM expedientes e WHERE 1=1`;
    const params = [];
    let i = 1;
    if (estado) { query += ` AND e.estado = $${i++}`; params.push(estado); }
    if (area)   { query += ` AND e.area = $${i++}`;   params.push(area); }
    if (prioridad) { query += ` AND e.prioridad = $${i++}`; params.push(prioridad); }
    if (q) { query += ` AND (e.numero ILIKE $${i} OR e.descripcion ILIKE $${i} OR e.solicitante ILIKE $${i})`; params.push(`%${q}%`); i++; }
    query += ' ORDER BY e.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** PDF único del expediente (decreto de pago primero + resto de anexos). Reemplaza consolidado anterior en Cloudinary. */
router.post('/:id/consolidar-pdf', auth, async (req, res) => {
  try {
    const exp = await db.query('SELECT * FROM expedientes WHERE id = $1', [req.params.id]);
    if (!exp.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = exp.rows[0];
    const docs = await db.query(
      `SELECT * FROM documentos WHERE expediente_id = $1 AND file_path IS NOT NULL AND trim(file_path) <> '' ORDER BY created_at`,
      [req.params.id]
    );
    if (!docs.rows.length) return res.status(400).json({ error: 'No hay documentos con archivo adjunto' });

    const pdfBuffer = await buildConsolidatedPdfBuffer(docs.rows);
    const fname = `consolidado_${String(row.numero || 'exp').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.pdf`;
    await destroyConsolidadoCloudinary(row.archivo_consolidado_public_id);

    const upload = await uploadBuffer(pdfBuffer, fname, `expedientes/${req.params.id}/consolidados`, {
      resource_type: 'raw',
    });

    await db.query(
      `UPDATE expedientes SET archivo_consolidado_url=$1, archivo_consolidado_public_id=$2, archivo_consolidado_at=NOW(), archivo_consolidado_por=$3, archivo_consolidado_size=$4, archivo_consolidado_mime=$5, updated_at=NOW() WHERE id=$6`,
      [upload.secure_url, upload.public_id, req.user.login, pdfBuffer.length, 'application/pdf', req.params.id]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [
        req.params.id,
        req.user.login,
        'PDF expediente consolidado',
        `Volumen único para archivo físico · ${(pdfBuffer.length / 1024).toFixed(1)} KB`,
        'documento',
      ]
    );
    res.json({
      ok: true,
      archivo_consolidado_url: upload.secure_url,
      archivo_consolidado_public_id: upload.public_id,
      archivo_consolidado_size: pdfBuffer.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al consolidar' });
  }
});

/** Descarga el PDF consolidado guardado (mismo que va a archivo físico). */
router.get('/:id/consolidado', auth, async (req, res) => {
  try {
    const exp = await db.query(
      'SELECT archivo_consolidado_url, archivo_consolidado_mime FROM expedientes WHERE id = $1',
      [req.params.id]
    );
    if (!exp.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const u = exp.rows[0].archivo_consolidado_url;
    if (!u) return res.status(404).json({ error: 'Aún no se ha generado el PDF consolidado' });
    await streamRemoteFileToResponse(u, res, {
      mimeType: exp.rows[0].archivo_consolidado_mime || 'application/pdf',
      filename: 'expediente-consolidado.pdf',
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

// Vincular más solicitudes derivadas a Compras (sin expediente) a este expediente
router.patch('/:id/solicitudes', auth, async (req, res) => {
  try {
    const { solicitud_ids } = req.body || {};
    const exp = await db.query('SELECT id, numero FROM expedientes WHERE id = $1', [req.params.id]);
    if (!exp.rows.length) return res.status(404).json({ error: 'No encontrado' });
    if (!Array.isArray(solicitud_ids) || !solicitud_ids.length) {
      return res.status(400).json({ error: 'Indicá al menos un id de solicitud' });
    }
    const u = await db.query(
      `UPDATE solicitudes SET expediente_id = $1
       WHERE id = ANY($2::uuid[])
         AND expediente_id IS NULL
         AND modulo_destino = 'compras'
         AND estado = 'Derivada'
       RETURNING id, numero`,
      [req.params.id, solicitud_ids]
    );
    for (const s of u.rows) {
      await db.query(
        'INSERT INTO solicitudes_historial (solicitud_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
        [s.id, req.user.login, 'Vinculada a compra', `Expediente ${exp.rows[0].numero}`, 'edicion']
      );
    }
    if (u.rows.length) {
      await db.query(
        'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
        [
          req.params.id,
          req.user.login,
          'Solicitudes vinculadas',
          u.rows.map((r) => r.numero).join(', '),
          'edicion',
        ]
      );
    }
    res.json({ ok: true, vinculadas: u.rows.length, numeros: u.rows.map((r) => r.numero) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener uno
router.get('/:id', auth, async (req, res) => {
  try {
    const exp = await db.query('SELECT * FROM expedientes WHERE id = $1', [req.params.id]);
    if (!exp.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query('SELECT * FROM documentos WHERE expediente_id = $1 ORDER BY created_at', [req.params.id]);
    const hist = await db.query('SELECT * FROM historial WHERE expediente_id = $1 ORDER BY created_at DESC', [req.params.id]);
    const sols = await db.query(
      `SELECT id, numero, descripcion, solicitante, estado, monto, origen_area, establecimiento, created_at
       FROM solicitudes WHERE expediente_id = $1 ORDER BY numero`,
      [req.params.id]
    );
    const checklistPayload = computeChecklist(docs.rows, { solicitudesCount: sols.rows.length });
    res.json({ ...exp.rows[0], documentos: docs.rows, historial: hist.rows, solicitudes: sols.rows, ...checklistPayload });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear
router.post('/', auth, async (req, res) => {
  try {
    const {
      descripcion,
      solicitante,
      area,
      tipo_gasto,
      monto,
      monto_real,
      cuenta_contable,
      prioridad,
      fecha_ingreso,
      observaciones,
      solicitud_ids,
    } = req.body;
    const year = new Date().getFullYear();
    const count = await db.query("SELECT COUNT(*) FROM expedientes WHERE EXTRACT(YEAR FROM created_at) = $1", [year]);
    const numero = `EXP-${year}-${String(parseInt(count.rows[0].count) + 1).padStart(5, '0')}`;
    const montoEst = monto != null && monto !== '' ? Number(monto) : 0;
    const montoRealVal =
      monto_real != null && monto_real !== '' ? Number(monto_real) : null;
    const cuentaVal = cuenta_contable != null ? String(cuenta_contable).trim() || null : null;
    const result = await db.query(
      `INSERT INTO expedientes (numero, descripcion, solicitante, area, tipo_gasto, monto, monto_real, cuenta_contable, prioridad, estado, fecha_ingreso, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Ingresado',$10,$11,$12) RETURNING *`,
      [
        numero,
        descripcion,
        solicitante,
        area,
        tipo_gasto,
        montoEst,
        montoRealVal,
        cuentaVal,
        prioridad || 'Normal',
        fecha_ingreso || new Date(),
        observaciones,
        req.user.login,
      ]
    );
    const row = result.rows[0];
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [row.id, req.user.login, 'Expediente creado', 'Estado inicial: Ingresado', 'creacion']
    );
    let vinculadas = 0;
    if (Array.isArray(solicitud_ids) && solicitud_ids.length) {
      const u = await db.query(
        `UPDATE solicitudes SET expediente_id = $1
         WHERE id = ANY($2::uuid[])
           AND expediente_id IS NULL
           AND modulo_destino = 'compras'
           AND estado = 'Derivada'
         RETURNING id, numero`,
        [row.id, solicitud_ids]
      );
      vinculadas = u.rows.length;
      for (const s of u.rows) {
        await db.query(
          'INSERT INTO solicitudes_historial (solicitud_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
          [s.id, req.user.login, 'Vinculada a compra', `Expediente ${numero}`, 'edicion']
        );
      }
      if (vinculadas) {
        await db.query(
          'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
          [row.id, req.user.login, 'Solicitudes vinculadas al crear compra', u.rows.map((r) => r.numero).join(', '), 'creacion']
        );
      }
    }
    res.status(201).json({ ...row, solicitudes_vinculadas: vinculadas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Monto real y cuenta contable
router.patch('/:id/datos-compra', auth, async (req, res) => {
  try {
    const { monto_real, cuenta_contable } = req.body || {};
    const prev = await db.query(
      'SELECT numero, monto, monto_real, cuenta_contable FROM expedientes WHERE id = $1',
      [req.params.id]
    );
    if (!prev.rows.length) return res.status(404).json({ error: 'No encontrado' });

    const updates = [];
    const params = [];
    let i = 1;
    const notas = [];

    if (monto_real !== undefined) {
      const val =
        monto_real === null || monto_real === ''
          ? null
          : Number(monto_real);
      if (val != null && Number.isNaN(val)) {
        return res.status(400).json({ error: 'Monto real inválido' });
      }
      updates.push(`monto_real = $${i++}`);
      params.push(val);
      const ant = prev.rows[0].monto_real ?? prev.rows[0].monto;
      notas.push(
        `Monto real: $${Number(ant || 0).toLocaleString('es-CL')} → $${Number(val || 0).toLocaleString('es-CL')}`
      );
    }

    if (cuenta_contable !== undefined) {
      const val =
        cuenta_contable === null || cuenta_contable === ''
          ? null
          : String(cuenta_contable).trim().slice(0, 60);
      updates.push(`cuenta_contable = $${i++}`);
      params.push(val);
      notas.push(
        `Cuenta contable: ${prev.rows[0].cuenta_contable || '—'} → ${val || '—'}`
      );
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Indicá monto_real y/o cuenta_contable' });
    }

    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await db.query(
      `UPDATE expedientes SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );

    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Datos de compra actualizados', notas.join(' · '), 'edicion']
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cambiar estado
router.patch('/:id/estado', auth, async (req, res) => {
  try {
    const { estado, comentario } = req.body;
    const prev = await db.query('SELECT estado FROM expedientes WHERE id = $1', [req.params.id]);
    await db.query('UPDATE expedientes SET estado = $1, updated_at = NOW() WHERE id = $2', [estado, req.params.id]);
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Cambio de estado', `${prev.rows[0].estado} → ${estado}${comentario ? ' · ' + comentario : ''}`, 'estado']
    );
    res.json({ ok: true, estado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registrar archivo físico
router.patch('/:id/archivo', auth, async (req, res) => {
  try {
    const { caja, estante, posicion, sala, fecha_archivo, obs_archivo } = req.body;
    await db.query(
      'UPDATE expedientes SET caja=$1, estante=$2, posicion=$3, sala=$4, fecha_archivo=$5, obs_archivo=$6, archivado_por=$7, updated_at=NOW() WHERE id=$8',
      [caja, estante, posicion, sala, fecha_archivo, obs_archivo, req.user.login, req.params.id]
    );
    await db.query(
      'INSERT INTO historial (expediente_id, usuario, accion, nota, tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Archivo físico registrado', `Caja ${caja} · Estante ${estante}${sala ? ' · ' + sala : ''}`, 'archivo']
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'Super Admin') return res.status(403).json({ error: 'Sin permisos' });
    const prev = await db.query('SELECT archivo_consolidado_public_id FROM expedientes WHERE id = $1', [req.params.id]);
    if (prev.rows.length) await destroyConsolidadoCloudinary(prev.rows[0].archivo_consolidado_public_id);
    await db.query('DELETE FROM documentos WHERE expediente_id = $1', [req.params.id]);
    await db.query('DELETE FROM historial WHERE expediente_id = $1', [req.params.id]);
    await db.query('DELETE FROM expedientes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
