const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('../cloudinary');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { uploadBuffer } = require('../lib/cloudinaryBufferUpload');
const { buildMergedPdf } = require('../lib/consolidarPdfLib');
const {
  MOTHER_DOC_ORDER,
  MONTHLY_PAGO_DOC_ORDER,
  computeMotherChecklist,
  computeMonthlyPagoChecklist,
} = require('../lib/contratoWorkflow');

const uploadToCloudinary = require('../cloudinary_upload');

async function destroyCloudinaryPublicId(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', invalidate: true }).catch(() =>
    cloudinary.uploader.destroy(publicId, { invalidate: true }).catch(() => {})
  );
}

function destroyCloudinaryIfUrl(filePath) {
  if (!filePath || !filePath.includes('res.cloudinary.com')) return Promise.resolve();
  const m = filePath.match(/\/(?:raw|image|video|auto)\/upload\/(?:v\d+\/)?(.+?)(?:\?|#|$)/);
  if (!m) return Promise.resolve();
  let publicId = decodeURIComponent(m[1]);
  const ext = publicId.includes('.') ? publicId.split('.').pop().toLowerCase() : '';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt'].includes(ext)) {
    publicId = publicId.slice(0, publicId.lastIndexOf('.'));
  }
  return cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'raw' })
    .catch(() => cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'auto' }).catch(() => {}));
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Listar contratos
router.get('/', auth, async (req, res) => {
  try {
    const { q, estado } = req.query;
    let query = `SELECT c.*,
      (SELECT COUNT(*) FROM contratos_documentos cd WHERE cd.contrato_id = c.id) as docs_base,
      (SELECT COUNT(*) FROM contratos_pagos cp WHERE cp.contrato_id = c.id) as total_pagos
      FROM contratos c WHERE 1=1`;
    const params = [];
    let i = 1;
    if (q) { query += ` AND (c.numero ILIKE $${i} OR c.nombre ILIKE $${i} OR c.proveedor ILIKE $${i})`; params.push('%'+q+'%'); i++; }
    if (estado) { query += ` AND c.estado = $${i++}`; params.push(estado); }
    query += ' ORDER BY c.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Ver/descargar documento base (proxy; rutas explícitas antes de GET /:id)
router.get('/:id/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM contratos_documentos WHERE id=$1 AND contrato_id=$2',
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

// Ver/descargar documento de un pago mensual
router.get('/:id/pagos/:pagoId/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM contratos_pagos_docs WHERE id=$1 AND pago_id=$2 AND contrato_id=$3',
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

/** PDF único fase madre (solicitud → contrato firmado). */
router.post('/:id/consolidar-madre-pdf', auth, async (req, res) => {
  try {
    const c = await db.query('SELECT * FROM contratos WHERE id=$1', [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = c.rows[0];
    const docs = await db.query(
      `SELECT * FROM contratos_documentos WHERE contrato_id=$1 AND file_path IS NOT NULL AND trim(file_path) <> '' ORDER BY created_at`,
      [req.params.id]
    );
    if (!docs.rows.length) return res.status(400).json({ error: 'No hay documentos base con archivo' });
    const pdfBuffer = await buildMergedPdf(docs.rows, MOTHER_DOC_ORDER);
    await destroyCloudinaryPublicId(row.archivo_madre_consolidado_public_id);
    const fname = `contrato_madre_${String(row.numero || 'con').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.pdf`;
    const upload = await uploadBuffer(pdfBuffer, fname, `contratos/${req.params.id}/consolidados/madre`, { resource_type: 'raw' });
    await db.query(
      `UPDATE contratos SET archivo_madre_consolidado_url=$1, archivo_madre_consolidado_public_id=$2, archivo_madre_consolidado_at=NOW(), archivo_madre_consolidado_por=$3, archivo_madre_consolidado_size=$4, archivo_madre_consolidado_mime=$5, updated_at=NOW() WHERE id=$6`,
      [upload.secure_url, upload.public_id, req.user.login, pdfBuffer.length, 'application/pdf', req.params.id]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)', [
      req.params.id,
      req.user.login,
      'PDF fase madre consolidado',
      `Volumen solicitud → contrato firmado · ${(pdfBuffer.length / 1024).toFixed(1)} KB`,
      'documento',
    ]);
    res.json({ ok: true, archivo_madre_consolidado_url: upload.secure_url, archivo_madre_consolidado_size: pdfBuffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al consolidar fase madre' });
  }
});

router.get('/:id/consolidado-madre', auth, async (req, res) => {
  try {
    const c = await db.query(
      'SELECT archivo_madre_consolidado_url, archivo_madre_consolidado_mime FROM contratos WHERE id=$1',
      [req.params.id]
    );
    if (!c.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const u = c.rows[0].archivo_madre_consolidado_url;
    if (!u) return res.status(404).json({ error: 'Aún no se ha generado el PDF de fase madre' });
    await streamRemoteFileToResponse(u, res, {
      mimeType: c.rows[0].archivo_madre_consolidado_mime || 'application/pdf',
      filename: 'contrato-fase-madre-consolidado.pdf',
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

/** PDF único del período mensual (decreto → comprobante). */
router.post('/:id/pagos/:pagoId/consolidar-mes-pdf', auth, async (req, res) => {
  try {
    const p = await db.query('SELECT * FROM contratos_pagos WHERE id=$1 AND contrato_id=$2', [req.params.pagoId, req.params.id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Pago no encontrado' });
    const row = p.rows[0];
    const docs = await db.query(
      `SELECT * FROM contratos_pagos_docs WHERE pago_id=$1 AND contrato_id=$2 AND file_path IS NOT NULL AND trim(file_path) <> '' ORDER BY created_at`,
      [req.params.pagoId, req.params.id]
    );
    if (!docs.rows.length) return res.status(400).json({ error: 'No hay documentos de este período con archivo' });
    const pdfBuffer = await buildMergedPdf(docs.rows, MONTHLY_PAGO_DOC_ORDER);
    await destroyCloudinaryPublicId(row.archivo_mes_consolidado_public_id);
    const fname = `pago_${row.anio}_${String(row.mes).padStart(2, '0')}_${Date.now()}.pdf`;
    const upload = await uploadBuffer(pdfBuffer, fname, `contratos/${req.params.id}/pagos/${req.params.pagoId}/consolidados`, {
      resource_type: 'raw',
    });
    await db.query(
      `UPDATE contratos_pagos SET archivo_mes_consolidado_url=$1, archivo_mes_consolidado_public_id=$2, archivo_mes_consolidado_at=NOW(), archivo_mes_consolidado_por=$3, archivo_mes_consolidado_size=$4, archivo_mes_consolidado_mime=$5 WHERE id=$6 AND contrato_id=$7`,
      [upload.secure_url, upload.public_id, req.user.login, pdfBuffer.length, 'application/pdf', req.params.pagoId, req.params.id]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)', [
      req.params.id,
      req.user.login,
      'PDF período mensual consolidado',
      `${row.periodo} · ${(pdfBuffer.length / 1024).toFixed(1)} KB`,
      'documento',
    ]);
    res.json({ ok: true, archivo_mes_consolidado_url: upload.secure_url, archivo_mes_consolidado_size: pdfBuffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al consolidar período' });
  }
});

router.get('/:id/pagos/:pagoId/consolidado-mes', auth, async (req, res) => {
  try {
    const p = await db.query(
      'SELECT archivo_mes_consolidado_url, archivo_mes_consolidado_mime FROM contratos_pagos WHERE id=$1 AND contrato_id=$2',
      [req.params.pagoId, req.params.id]
    );
    if (!p.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const u = p.rows[0].archivo_mes_consolidado_url;
    if (!u) return res.status(404).json({ error: 'Aún no hay PDF consolidado de este período' });
    await streamRemoteFileToResponse(u, res, {
      mimeType: p.rows[0].archivo_mes_consolidado_mime || 'application/pdf',
      filename: 'contrato-periodo-consolidado.pdf',
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

// Obtener contrato con todo su detalle
router.get('/:id', auth, async (req, res) => {
  try {
    const contrato = await db.query('SELECT * FROM contratos WHERE id=$1', [req.params.id]);
    if (!contrato.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const docs = await db.query('SELECT * FROM contratos_documentos WHERE contrato_id=$1 ORDER BY created_at', [req.params.id]);
    const pagos = await db.query(`
      SELECT cp.*, 
        json_agg(cpd.* ORDER BY cpd.created_at) FILTER (WHERE cpd.id IS NOT NULL) as documentos
      FROM contratos_pagos cp
      LEFT JOIN contratos_pagos_docs cpd ON cpd.pago_id = cp.id
      WHERE cp.contrato_id=$1
      GROUP BY cp.id
      ORDER BY cp.anio, cp.mes`, [req.params.id]);
    const historial = await db.query('SELECT * FROM contratos_historial WHERE contrato_id=$1 ORDER BY created_at DESC', [req.params.id]);
    const mother = computeMotherChecklist(docs.rows);
    const pagosEnriched = pagos.rows.map((p) => {
      const docList = Array.isArray(p.documentos) ? p.documentos.filter((d) => d && d.id) : [];
      const mes = computeMonthlyPagoChecklist(docList);
      return {
        ...p,
        documentos: docList,
        checklist_mes: mes.checklist,
        faltantes_mes: mes.faltantes,
        puede_cerrar_mes: mes.puede_cerrar,
        mes_cargados: mes.cargados,
        mes_total_obligatorios: mes.total_obligatorios,
      };
    });
    res.json({
      ...contrato.rows[0],
      documentos: docs.rows,
      pagos: pagosEnriched,
      historial: historial.rows,
      checklist_madre: mother.checklist,
      faltantes_madre: mother.faltantes,
      puede_cerrar_madre: mother.puede_cerrar,
      madre_cargados: mother.cargados,
      madre_total_obligatorios: mother.total_obligatorios,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Crear contrato
router.post('/', auth, async (req, res) => {
  try {
    const {
      nombre, proveedor, rut_proveedor, monto_total, monto_mensual, fecha_inicio, fecha_termino, area, objeto, observaciones, moneda: monedaBody,
    } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre es obligatorio' });
    if (!proveedor || !String(proveedor).trim()) return res.status(400).json({ error: 'Proveedor es obligatorio' });
    if (!area || !String(area).trim()) return res.status(400).json({ error: 'Área es obligatoria' });
    const moneda = ['CLP', 'UF', 'USD'].includes(monedaBody) ? monedaBody : 'CLP';
    const objetoSafe = objeto != null && String(objeto).trim() ? String(objeto).trim() : 'Sin descripción';
    const toNum = (v) => {
      if (v === '' || v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const mt = toNum(monto_total);
    const mm = toNum(monto_mensual);
    const year = new Date().getFullYear();
    const count = await db.query("SELECT COUNT(*) FROM contratos WHERE EXTRACT(YEAR FROM created_at)=$1", [year]);
    const numero = `CON-${year}-${String(parseInt(count.rows[0].count)+1).padStart(4,'0')}`;
    const result = await db.query(
      `INSERT INTO contratos (numero,nombre,proveedor,rut_proveedor,monto_total,monto_mensual,moneda,fecha_inicio,fecha_termino,area,objeto,observaciones,estado,creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Vigente',$13) RETURNING *`,
      [numero, String(nombre).trim(), String(proveedor).trim(), rut_proveedor||null, mt, mm, moneda, fecha_inicio||null, fecha_termino||null, String(area).trim(), objetoSafe, observaciones||null, req.user.login]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [result.rows[0].id, req.user.login, 'Contrato creado', `N° ${numero}`, 'creacion']);
    res.status(201).json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Subir documento base del contrato
router.post('/:id/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, tipo, version, observacion } = req.body;
    let file_path = null;
    if (req.file) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g,'_').substring(0,50);
      const fname = `${Date.now()}-${baseName}.${ext}`;
      const uploaded = await uploadToCloudinary(req.file.buffer, fname, `contratos/${req.params.id}`, {
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });
      file_path = uploaded.secure_url;
    }
    const result = await db.query(
      `INSERT INTO contratos_documentos (contrato_id,nombre,tipo,formato,version,observacion,file_path,file_size,mime_type,cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, nombre, tipo, req.body.formato||'PDF', version||1, observacion, file_path, req.file?.size||null, req.file?.mimetype||null, req.user.login]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Documento cargado', `"${nombre}" (${tipo})`, 'documento']);
    res.status(201).json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Crear pago mensual
router.post('/:id/pagos', auth, async (req, res) => {
  try {
    const { mes, anio, monto, observaciones } = req.body;
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const periodo = `${meses[parseInt(mes)-1]} ${anio}`;
    const existing = await db.query('SELECT id FROM contratos_pagos WHERE contrato_id=$1 AND mes=$2 AND anio=$3', [req.params.id, mes, anio]);
    if (existing.rows.length) return res.status(400).json({ error: `Ya existe un pago para ${periodo}` });
    const result = await db.query(
      `INSERT INTO contratos_pagos (contrato_id,mes,anio,periodo,monto,estado,observaciones,creado_por)
       VALUES ($1,$2,$3,$4,$5,'Pendiente',$6,$7) RETURNING *`,
      [req.params.id, mes, anio, periodo, monto||0, observaciones||null, req.user.login]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Pago mensual creado', `Período: ${periodo}`, 'pago']);
    res.status(201).json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Subir documento a pago mensual
router.post('/:id/pagos/:pagoId/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const { nombre, tipo, version, observacion } = req.body;
    let file_path = null;
    let pago_file_size = null, pago_mime = null;
    if (req.file) {
      const fname = Date.now()+'-'+req.file.originalname.replace(/[^a-zA-Z0-9.]/g,'_');
      const res2 = await uploadToCloudinary(req.file.buffer, fname, `contratos/${req.params.id}/pagos/${req.params.pagoId}`, {
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });
      file_path = res2.secure_url; pago_file_size = req.file.size; pago_mime = req.file.mimetype;
    }
    const result = await db.query(
      `INSERT INTO contratos_pagos_docs (pago_id,contrato_id,nombre,tipo,formato,version,observacion,file_path,file_size,mime_type,cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.pagoId, req.params.id, nombre, tipo, req.body.formato||'PDF', version||1, observacion, file_path, pago_file_size, pago_mime, req.user.login]
    );
    // Verificar si el pago está completo
    const docs = await db.query('SELECT tipo FROM contratos_pagos_docs WHERE pago_id=$1', [req.params.pagoId]);
    const tiposReq = ['Factura','Recepción Conforme','Decreto de Pago','Comprobante de Pago'];
    const tiposCargados = docs.rows.map(d=>d.tipo);
    const completo = tiposReq.every(t => tiposCargados.includes(t));
    if (completo) {
      await db.query('UPDATE contratos_pagos SET estado=$1 WHERE id=$2', ['Pagado', req.params.pagoId]);
    }
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Documento de pago cargado', `"${nombre}" (${tipo})`, 'documento']);
    res.status(201).json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Cambiar estado contrato
router.patch('/:id/estado', auth, async (req, res) => {
  try {
    const { estado, comentario } = req.body;
    const prev = await db.query('SELECT estado FROM contratos WHERE id=$1', [req.params.id]);
    await db.query('UPDATE contratos SET estado=$1, updated_at=NOW() WHERE id=$2', [estado, req.params.id]);
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Cambio de estado', `${prev.rows[0]?.estado} → ${estado}${comentario?' · '+comentario:''}`, 'estado']);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Registrar archivo físico de pago mensual
router.patch('/:id/pagos/:pagoId/archivo', auth, async (req, res) => {
  try {
    const { caja, estante, posicion, sala, fecha_archivo, obs_archivo } = req.body;
    await db.query(
      'UPDATE contratos_pagos SET caja=$1,estante=$2,posicion=$3,sala=$4,fecha_archivo=$5,obs_archivo=$6,archivado_por=$7 WHERE id=$8 AND contrato_id=$9',
      [caja, estante, posicion||null, sala||null, fecha_archivo||null, obs_archivo||null, req.user.login, req.params.pagoId, req.params.id]
    );
    await db.query('INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Pago archivado físicamente', `Caja ${caja} · Estante ${estante}${sala?' · '+sala:''}`, 'archivo']);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Eliminar documento base del contrato
router.delete('/:id/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM contratos_documentos WHERE id=$1 AND contrato_id=$2',
      [req.params.docId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    await destroyCloudinaryIfUrl(row.rows[0].file_path);
    await db.query('DELETE FROM contratos_documentos WHERE id=$1', [req.params.docId]);
    await db.query(
      'INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Documento base eliminado', row.rows[0].nombre, 'documento']
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar documento de un pago mensual
router.delete('/:id/pagos/:pagoId/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query(
      'SELECT * FROM contratos_pagos_docs WHERE id=$1 AND pago_id=$2 AND contrato_id=$3',
      [req.params.docId, req.params.pagoId, req.params.id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    await destroyCloudinaryIfUrl(row.rows[0].file_path);
    await db.query('DELETE FROM contratos_pagos_docs WHERE id=$1', [req.params.docId]);
    const docs = await db.query('SELECT tipo FROM contratos_pagos_docs WHERE pago_id=$1', [req.params.pagoId]);
    const tiposReq = ['Factura', 'Recepción Conforme', 'Decreto de Pago', 'Comprobante de Pago'];
    const tiposCargados = docs.rows.map(d => d.tipo);
    const completo = tiposReq.every(t => tiposCargados.includes(t));
    await db.query('UPDATE contratos_pagos SET estado=$1 WHERE id=$2', [completo ? 'Pagado' : 'Pendiente', req.params.pagoId]);
    await db.query(
      'INSERT INTO contratos_historial (contrato_id,usuario,accion,nota,tipo) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, req.user.login, 'Documento de pago eliminado', row.rows[0].nombre, 'documento']
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
