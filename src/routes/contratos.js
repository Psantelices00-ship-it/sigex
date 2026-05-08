const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/contratos', req.params.id || 'temp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

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
    res.json({ ...contrato.rows[0], documentos: docs.rows, pagos: pagos.rows, historial: historial.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Crear contrato
router.post('/', auth, async (req, res) => {
  try {
    const { nombre, proveedor, rut_proveedor, monto_total, monto_mensual, fecha_inicio, fecha_termino, area, objeto, observaciones } = req.body;
    const year = new Date().getFullYear();
    const count = await db.query("SELECT COUNT(*) FROM contratos WHERE EXTRACT(YEAR FROM created_at)=$1", [year]);
    const numero = `CON-${year}-${String(parseInt(count.rows[0].count)+1).padStart(4,'0')}`;
    const result = await db.query(
      `INSERT INTO contratos (numero,nombre,proveedor,rut_proveedor,monto_total,monto_mensual,fecha_inicio,fecha_termino,area,objeto,observaciones,estado,creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Vigente',$12) RETURNING *`,
      [numero,nombre,proveedor,rut_proveedor||null,monto_total||0,monto_mensual||0,fecha_inicio||null,fecha_termino||null,area,objeto,observaciones,req.user.login]
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
    const file_path = req.file ? `/uploads/contratos/${req.params.id}/${req.file.filename}` : null;
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
    const dir = path.join(__dirname, '../../uploads/contratos', req.params.id, 'pagos', req.params.pagoId);
    fs.mkdirSync(dir, { recursive: true });
    const file_path = req.file ? `/uploads/contratos/${req.params.id}/pagos/${req.params.pagoId}/${req.file.filename}` : null;
    const result = await db.query(
      `INSERT INTO contratos_pagos_docs (pago_id,contrato_id,nombre,tipo,formato,version,observacion,file_path,file_size,mime_type,cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.pagoId, req.params.id, nombre, tipo, req.body.formato||'PDF', version||1, observacion, file_path, req.file?.size||null, req.file?.mimetype||null, req.user.login]
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

module.exports = router;
