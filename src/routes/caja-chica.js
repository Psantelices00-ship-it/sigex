const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { requireEditarRegistro } = require('../lib/registroEdicionPermisos');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const TIPOS_GASTO = new Set([
  'CARTAS',
  'FINIQUITO',
  'MENAJE',
  'LIBRERIA',
  'MATERIALES_MANTENCION',
  'PASAJES',
  'INSUMOS_OFICINA',
  'MOVILIZACION',
  'OTRO',
  'TECNOLOGIA',
]);
const CLASES_DOC = new Set([
  'voucher_apertura',
  'decreto_apertura',
  'voucher_reposicion',
  'decreto_reposicion',
  'boleta_gasto',
  'informe_cuadratura',
  'decreto_cierre_periodo',
  'comprobante_cierre',
]);

function normTipoGasto(raw) {
  let u = String(raw || 'OTRO').toUpperCase().replace(/\s+/g, '_');
  if (u === 'TECNOLOGIA') u = 'MATERIALES_MANTENCION';
  return TIPOS_GASTO.has(u) || u === 'MATERIALES_MANTENCION' ? u : 'OTRO';
}

async function loadPeriodoPublic(cajaId, periodoId) {
  const p = await db.query(
    `SELECT * FROM caja_chica_periodos WHERE id=$1 AND caja_id=$2`,
    [periodoId, cajaId]
  );
  if (!p.rows.length) return null;
  const row = p.rows[0];
  const [giros, gastos, docs] = await Promise.all([
    db.query('SELECT * FROM caja_chica_giros WHERE periodo_id=$1 ORDER BY created_at', [periodoId]),
    db.query('SELECT * FROM caja_chica_gastos WHERE periodo_id=$1 ORDER BY fecha, created_at', [periodoId]),
    db.query('SELECT * FROM caja_chica_documentos WHERE periodo_id=$1 ORDER BY created_at', [periodoId]),
  ]);
  return {
    ...row,
    giros_reposicion: giros.rows,
    gastos: gastos.rows.map((g) => ({
      ...g,
      tipo_gasto: String(g.tipo_gasto || '').toUpperCase() === 'TECNOLOGIA' ? 'MATERIALES_MANTENCION' : g.tipo_gasto,
    })),
    documentos: docs.rows,
  };
}

async function loadCajaPublic(cajaId) {
  const c = await db.query('SELECT * FROM caja_chica_cajas WHERE id=$1', [cajaId]);
  if (!c.rows.length) return null;
  const periodos = await db.query(
    'SELECT id, etiqueta, mes, anio, estado, saldo_inicial, fecha_cierre_iso, observaciones_cuadratura, fecha_rendicion, numero_rendicion, created_at FROM caja_chica_periodos WHERE caja_id=$1 ORDER BY anio DESC, mes DESC',
    [cajaId]
  );
  const enriched = [];
  for (const p of periodos.rows) {
    enriched.push(await loadPeriodoPublic(cajaId, p.id));
  }
  return { ...c.rows[0], periodos: enriched };
}

router.get('/', auth, async (req, res) => {
  try {
    const cajas = await db.query('SELECT * FROM caja_chica_cajas ORDER BY nombre');
    const out = [];
    for (const c of cajas.rows) {
      out.push(await loadCajaPublic(c.id));
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:cajaId/periodos/:periodoId/documentos/:docId/archivo', auth, async (req, res) => {
  try {
    const row = await db.query(
      `SELECT d.* FROM caja_chica_documentos d
       JOIN caja_chica_periodos p ON p.id = d.periodo_id
       WHERE d.id=$1 AND d.periodo_id=$2 AND p.caja_id=$3`,
      [req.params.docId, req.params.periodoId, req.params.cajaId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const doc = row.rows[0];
    if (!doc.file_path) return res.status(404).json({ error: 'Sin archivo' });
    await streamRemoteFileToResponse(doc.file_path, res, { mimeType: doc.mime_type, filename: doc.nombre });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

router.get('/:cajaId/periodos/:periodoId', auth, async (req, res) => {
  try {
    const p = await loadPeriodoPublic(req.params.cajaId, req.params.periodoId);
    if (!p) return res.status(404).json({ error: 'Período no encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:cajaId', auth, async (req, res) => {
  try {
    const c = await loadCajaPublic(req.params.cajaId);
    if (!c) return res.status(404).json({ error: 'Caja no encontrada' });
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:cajaId/periodos', auth, async (req, res) => {
  try {
    const caja = await db.query('SELECT id FROM caja_chica_cajas WHERE id=$1', [req.params.cajaId]);
    if (!caja.rows.length) return res.status(404).json({ error: 'Caja no encontrada' });
    const mes = Number(req.body.mes);
    const anio = Number(req.body.anio);
    const mi = Number.isFinite(mes) ? mes : new Date().getMonth() + 1;
    const yi = Number.isFinite(anio) ? anio : new Date().getFullYear();
    const etiqueta =
      req.body.etiqueta && String(req.body.etiqueta).trim()
        ? String(req.body.etiqueta).trim()
        : `${MESES[Math.min(Math.max(mi, 1), 12) - 1]} ${yi}`;
    const saldo = req.body.saldo_inicial != null ? Number(req.body.saldo_inicial) : 0;
    const result = await db.query(
      `INSERT INTO caja_chica_periodos (caja_id, etiqueta, mes, anio, saldo_inicial, estado)
       VALUES ($1,$2,$3,$4,$5,'abierto') RETURNING *`,
      [req.params.cajaId, etiqueta, mi, yi, Number.isFinite(saldo) ? saldo : 0]
    );
    res.status(201).json(await loadPeriodoPublic(req.params.cajaId, result.rows[0].id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:cajaId/periodos/:periodoId', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT * FROM caja_chica_periodos WHERE id=$1 AND caja_id=$2', [
      req.params.periodoId,
      req.params.cajaId,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    const p = prev.rows[0];
    const o = req.body || {};
    let saldo_inicial = p.saldo_inicial;
    if (typeof o.saldo_inicial === 'number' && Number.isFinite(o.saldo_inicial) && p.estado === 'abierto') {
      saldo_inicial = o.saldo_inicial;
    }
    let estado = p.estado;
    let fecha_cierre_iso = p.fecha_cierre_iso;
    if (o.estado === 'cerrado' && p.estado === 'abierto') {
      estado = 'cerrado';
      fecha_cierre_iso = new Date().toISOString();
    }
    await db.query(
      `UPDATE caja_chica_periodos SET
        saldo_inicial=$1,
        observaciones_cuadratura=COALESCE($2, observaciones_cuadratura),
        fecha_rendicion=COALESCE($3, fecha_rendicion),
        numero_rendicion=COALESCE($4, numero_rendicion),
        estado=$5,
        fecha_cierre_iso=$6,
        updated_at=NOW()
       WHERE id=$7`,
      [
        saldo_inicial,
        typeof o.observaciones_cuadratura === 'string' ? o.observaciones_cuadratura : p.observaciones_cuadratura,
        o.fecha_rendicion !== undefined ? o.fecha_rendicion || null : p.fecha_rendicion,
        typeof o.numero_rendicion === 'string' ? o.numero_rendicion : p.numero_rendicion,
        estado,
        fecha_cierre_iso,
        req.params.periodoId,
      ]
    );
    res.json(await loadPeriodoPublic(req.params.cajaId, req.params.periodoId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:cajaId/periodos/:periodoId/giros', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT estado FROM caja_chica_periodos WHERE id=$1 AND caja_id=$2', [
      req.params.periodoId,
      req.params.cajaId,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    if (prev.rows[0].estado !== 'abierto') {
      return res.status(400).json({ error: 'Período cerrado' });
    }
    const monto = Number(req.body.monto);
    const result = await db.query(
      `INSERT INTO caja_chica_giros (periodo_id, monto, concepto) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.periodoId, Number.isFinite(monto) ? monto : 0, req.body.concepto || 'Reposición de fondos']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:cajaId/periodos/:periodoId/gastos/:gastoId', auth, async (req, res) => {
  try {
    if (!requireEditarRegistro(req, res)) return;
    const prev = await db.query(
      `SELECT g.*, p.estado AS periodo_estado
       FROM caja_chica_gastos g
       JOIN caja_chica_periodos p ON p.id = g.periodo_id
       WHERE g.id=$1 AND g.periodo_id=$2 AND p.caja_id=$3`,
      [req.params.gastoId, req.params.periodoId, req.params.cajaId]
    );
    if (!prev.rows.length) return res.status(404).json({ error: 'Gasto no encontrado' });
    const before = prev.rows[0];
    const o = req.body || {};

    let fecha = before.fecha;
    if (o.fecha !== undefined) {
      fecha = String(o.fecha || '').slice(0, 10);
      if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
    }

    let tipo_gasto = before.tipo_gasto;
    if (o.tipo_gasto !== undefined) tipo_gasto = normTipoGasto(o.tipo_gasto);

    let monto = before.monto;
    if (o.monto !== undefined) {
      const n = Number(o.monto);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Monto inválido' });
      monto = n;
    }

    const strField = (key, maxLen) => {
      if (o[key] === undefined) return before[key] ?? '';
      return String(o[key] ?? '').slice(0, maxLen);
    };

    const numero_boleta = strField('numero_boleta', 40);
    const rut_proveedor = strField('rut_proveedor', 20);
    const proveedor = strField('proveedor', 200);
    const funcionario = strField('funcionario', 120);
    const motivo_destino = strField('motivo_destino', 2000);
    let concepto = before.concepto;
    if (o.concepto !== undefined || o.motivo_destino !== undefined) {
      concepto = String(o.concepto ?? o.motivo_destino ?? before.concepto ?? '').slice(0, 2000) || 'Gasto';
    }

    const result = await db.query(
      `UPDATE caja_chica_gastos SET
        fecha=$1, tipo_gasto=$2, numero_boleta=$3, rut_proveedor=$4, proveedor=$5,
        funcionario=$6, motivo_destino=$7, concepto=$8, monto=$9
       WHERE id=$10 RETURNING *`,
      [
        fecha,
        tipo_gasto,
        numero_boleta,
        rut_proveedor,
        proveedor,
        funcionario,
        motivo_destino,
        concepto,
        monto,
        req.params.gastoId,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:cajaId/periodos/:periodoId/gastos', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT estado FROM caja_chica_periodos WHERE id=$1 AND caja_id=$2', [
      req.params.periodoId,
      req.params.cajaId,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    if (prev.rows[0].estado !== 'abierto') {
      return res.status(400).json({ error: 'Período cerrado' });
    }
    const fecha = String(req.body.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const result = await db.query(
      `INSERT INTO caja_chica_gastos (periodo_id, fecha, tipo_gasto, numero_boleta, rut_proveedor, proveedor, funcionario, motivo_destino, concepto, monto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.params.periodoId,
        fecha,
        normTipoGasto(req.body.tipo_gasto),
        req.body.numero_boleta || '',
        req.body.rut_proveedor || '',
        req.body.proveedor || '',
        req.body.funcionario || '',
        req.body.motivo_destino || '',
        req.body.concepto || req.body.motivo_destino || 'Gasto',
        Number(req.body.monto) || 0,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:cajaId/periodos/:periodoId/documentos', auth, upload.single('archivo'), async (req, res) => {
  try {
    const prev = await db.query('SELECT id FROM caja_chica_periodos WHERE id=$1 AND caja_id=$2', [
      req.params.periodoId,
      req.params.cajaId,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    const clase = String(req.body.clase || '').trim();
    if (!CLASES_DOC.has(clase)) return res.status(400).json({ error: 'Clase de documento inválida' });
    let file_path = null;
    let file_size = null;
    let mime_type = null;
    if (req.file) {
      const fname = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const uploaded = await uploadToCloudinary(req.file.buffer, fname, `caja-chica/${req.params.cajaId}/${req.params.periodoId}`, {
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });
      file_path = uploaded.secure_url;
      file_size = req.file.size;
      mime_type = req.file.mimetype;
    }
    const exclusivos = ['voucher_apertura', 'decreto_apertura', 'informe_cuadratura', 'decreto_cierre_periodo', 'comprobante_cierre'];
    if (exclusivos.includes(clase)) {
      await db.query('DELETE FROM caja_chica_documentos WHERE periodo_id=$1 AND clase=$2', [req.params.periodoId, clase]);
    }
    const ref_id = req.body.ref_id != null && req.body.ref_id !== '' ? String(req.body.ref_id) : null;
    if (['voucher_reposicion', 'decreto_reposicion', 'boleta_gasto'].includes(clase) && ref_id) {
      await db.query('DELETE FROM caja_chica_documentos WHERE periodo_id=$1 AND clase=$2 AND ref_id=$3', [
        req.params.periodoId,
        clase,
        ref_id,
      ]);
    }
    const result = await db.query(
      `INSERT INTO caja_chica_documentos (periodo_id, clase, ref_id, nombre, tipo, formato, observacion, file_path, file_size, mime_type, cargado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.params.periodoId,
        clase,
        ref_id,
        req.body.nombre || 'Documento',
        req.body.tipo || clase,
        req.body.formato || 'PDF',
        req.body.observacion || '',
        file_path,
        file_size,
        mime_type,
        req.user.login,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:cajaId/periodos/:periodoId/documentos/:docId', auth, async (req, res) => {
  try {
    const row = await db.query(
      `DELETE FROM caja_chica_documentos d
       USING caja_chica_periodos p
       WHERE d.id=$1 AND d.periodo_id=$2 AND p.id=d.periodo_id AND p.caja_id=$3
       RETURNING d.id`,
      [req.params.docId, req.params.periodoId, req.params.cajaId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Documento no encontrado' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
