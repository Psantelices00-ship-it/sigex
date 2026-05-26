const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const { parsearMovimientosCartolaPdfTexto, movimientosChequeDeCartola } = require('../lib/chequesCartolaParse');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function normDig(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.replace(/^0+/, '') || '0';
}

function mismoNumCheque(registrado, cartolaDoc) {
  const a = String(registrado || '').trim();
  const b = String(cartolaDoc || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return normDig(a) === normDig(b);
}

async function textoDesdePdfBuffer(buf) {
  if (!buf?.length) return '';
  try {
    const pdfParse = require('pdf-parse');
    const r = await pdfParse(buf);
    return typeof r.text === 'string' ? r.text : '';
  } catch {
    return '';
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const [talonarios, emitidos, cartolas] = await Promise.all([
      db.query('SELECT * FROM cheques_talonarios ORDER BY created_at DESC'),
      db.query('SELECT * FROM cheques_emitidos ORDER BY created_at DESC'),
      db.query(
        `SELECT id, nombre, observacion, file_path, bytes_pdf, movimientos_total, movimientos_cheque_detectados,
          movimientos_parseados, resultado_conciliacion, fecha_importacion, created_at
         FROM cheques_cartolas ORDER BY created_at DESC`
      ),
    ]);
    res.json({
      talonarios: talonarios.rows,
      emitidos: emitidos.rows,
      cartolas: cartolas.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cartolas/:id/archivo', auth, async (req, res) => {
  try {
    const row = await db.query('SELECT file_path, nombre FROM cheques_cartolas WHERE id=$1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const u = row.rows[0].file_path;
    if (!u) return res.status(404).json({ error: 'Sin PDF' });
    await streamRemoteFileToResponse(u, res, {
      mimeType: 'application/pdf',
      filename: row.rows[0].nombre || 'cartola.pdf',
    });
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message || 'No se pudo obtener el archivo' });
  }
});

/** Lista solo talonarios (opcional; el resumen completo es GET /api/cheques). */
router.get('/talonarios', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM cheques_talonarios ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/talonarios', auth, async (req, res) => {
  try {
    const nombre = String(req.body.nombre || 'Talonario').trim();
    const banco = String(req.body.banco || '').trim() || null;
    const desde = parseInt(String(req.body.numero_desde).replace(/\D/g, ''), 10);
    const hasta = parseInt(String(req.body.numero_hasta).replace(/\D/g, ''), 10);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde > hasta) {
      return res.status(400).json({ error: 'Datos del talonario inválidos (desde/hasta)' });
    }
    const result = await db.query(
      `INSERT INTO cheques_talonarios (nombre, banco, numero_desde, numero_hasta, observacion)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nombre, banco, desde, hasta, req.body.observacion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/talonarios/:id', auth, async (req, res) => {
  try {
    const row = await db.query('DELETE FROM cheques_talonarios WHERE id=$1 RETURNING id', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Talonario no encontrado' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/emitidos', auth, async (req, res) => {
  try {
    const beneficiario = String(req.body.beneficiario || '').trim();
    const fecha_emision = String(req.body.fecha_emision || '').slice(0, 10);
    const numero_cheque = String(req.body.numero_cheque || '').trim().replace(/\s/g, '');
    let tipo_pago = String(req.body.tipo_pago || 'OTRO').toUpperCase();
    if (!['REMUNERACION', 'PREVISIONAL', 'OTRO'].includes(tipo_pago)) tipo_pago = 'OTRO';
    const monto = req.body.monto != null && req.body.monto !== '' ? Number(req.body.monto) : null;
    const talonario_id = req.body.talonario_id || null;
    if (!beneficiario || !fecha_emision || !numero_cheque) {
      return res.status(400).json({ error: 'Faltan beneficiario, fecha o N° cheque' });
    }
    if (talonario_id) {
      const tal = await db.query('SELECT * FROM cheques_talonarios WHERE id=$1', [talonario_id]);
      if (!tal.rows.length) return res.status(400).json({ error: 'Talonario no encontrado' });
      const n = parseInt(numero_cheque.replace(/\D/g, ''), 10);
      const t = tal.rows[0];
      if (!Number.isFinite(n) || n < t.numero_desde || n > t.numero_hasta) {
        return res.status(400).json({ error: 'El N° está fuera del talonario' });
      }
    }
    const result = await db.query(
      `INSERT INTO cheques_emitidos (talonario_id, numero_cheque, fecha_emision, beneficiario, tipo_pago, monto, banco_emisor, observacion, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'emitido') RETURNING *`,
      [
        talonario_id,
        numero_cheque,
        fecha_emision,
        beneficiario,
        tipo_pago,
        monto != null && Number.isFinite(monto) ? monto : null,
        req.body.banco_emisor || null,
        req.body.observacion || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/emitidos/:id', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT * FROM cheques_emitidos WHERE id=$1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Cheque no encontrado' });
    const o = req.body || {};
    const estado = ['anulado', 'emitido', 'cobrado'].includes(o.estado) ? o.estado : prev.rows[0].estado;
    const result = await db.query(
      `UPDATE cheques_emitidos SET
        estado=$1,
        observacion=COALESCE($2, observacion),
        banco_emisor=COALESCE($3, banco_emisor),
        monto=COALESCE($4, monto)
       WHERE id=$5 RETURNING *`,
      [
        estado,
        typeof o.observacion === 'string' ? o.observacion.trim() || null : prev.rows[0].observacion,
        typeof o.banco_emisor === 'string' ? o.banco_emisor.trim() || null : prev.rows[0].banco_emisor,
        o.monto != null && Number.isFinite(Number(o.monto)) ? Number(o.monto) : prev.rows[0].monto,
        req.params.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cartolas', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjuntá la cartola en PDF (campo archivo)' });
    }
    const buf = req.file.buffer;
    const nombre = String(req.body.nombre || 'Cartola').trim();
    const texto = await textoDesdePdfBuffer(buf);
    const movimientos_parseados = parsearMovimientosCartolaPdfTexto(texto);
    const movsCheque = movimientosChequeDeCartola(movimientos_parseados);
    const fname = `${Date.now()}-cartola.pdf`;
    const uploaded = await uploadToCloudinary(buf, fname, 'cheques/cartolas', {
      mimetype: 'application/pdf',
      originalname: req.file.originalname || 'cartola.pdf',
    });
    const ins = await db.query(
      `INSERT INTO cheques_cartolas (nombre, observacion, file_path, bytes_pdf, movimientos_total, movimientos_cheque_detectados, movimientos_parseados)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        nombre,
        req.body.observacion || null,
        uploaded.secure_url,
        buf.length,
        movimientos_parseados.length,
        movsCheque.length,
        movimientos_parseados,
      ]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conciliar', auth, async (req, res) => {
  try {
    const cartolaId = req.body.cartola_id;
    const cart = await db.query('SELECT * FROM cheques_cartolas WHERE id=$1', [cartolaId]);
    if (!cart.rows.length) return res.status(404).json({ error: 'Cartola no encontrada' });
    const cartola = cart.rows[0];
    const movs = Array.isArray(cartola.movimientos_parseados)
      ? cartola.movimientos_parseados
      : JSON.parse(cartola.movimientos_parseados || '[]');
    const movsChq = movimientosChequeDeCartola(movs);
    const emitidosRes = await db.query("SELECT * FROM cheques_emitidos WHERE estado = 'emitido'");
    const matchedPairs = [];
    const emitidosUsados = new Set();
    const mkMovKey = (m) => `${m.fecha}|${m.nro_documento}|${m.cargo_fmt || ''}`;
    const movsUsados = new Set();

    for (const m of movsChq) {
      const e = emitidosRes.rows.find(
        (x) => x.estado === 'emitido' && !emitidosUsados.has(x.id) && mismoNumCheque(x.numero_cheque, m.nro_documento)
      );
      if (!e) continue;
      emitidosUsados.add(e.id);
      movsUsados.add(mkMovKey(m));
      const match = {
        nro_documento: m.nro_documento,
        fecha_movimiento: m.fecha,
        descripcion_cartola: m.descripcion,
        cargo_fmt: m.cargo_fmt,
      };
      await db.query(
        `UPDATE cheques_emitidos SET estado='cobrado', cartola_id=$1, fecha_cobro_cartola=$2, match_cartola=$3
         WHERE id=$4`,
        [cartolaId, m.fecha, JSON.stringify(match), e.id]
      );
      matchedPairs.push({ emitido_id: e.id, numero_cheque: e.numero_cheque, movimiento_cartola: m });
    }

    const sin_match_emitidos = emitidosRes.rows
      .filter((x) => x.estado === 'emitido' && !emitidosUsados.has(x.id))
      .map((x) => ({ id: x.id, numero_cheque: x.numero_cheque, beneficiario: x.beneficiario }));
    const sin_match_cartola = movsChq.filter((m) => !movsUsados.has(mkMovKey(m)));
    const pendientes = await db.query("SELECT COUNT(*)::int AS n FROM cheques_emitidos WHERE estado = 'emitido'");

    const resultado = {
      cartola_id: cartolaId,
      fecha_corrida: new Date().toISOString(),
      matched: matchedPairs.length,
      marcados_cobro: matchedPairs.length,
      matched_pairs: matchedPairs,
      pairs: matchedPairs,
      sin_match_emitidos,
      sin_match_cartola,
      movimientos_cheque_en_cartola: movsChq.length,
      emitidos_sin_cobro_global: pendientes.rows[0]?.n ?? 0,
    };
    await db.query('UPDATE cheques_cartolas SET resultado_conciliacion=$1 WHERE id=$2', [
      JSON.stringify(resultado),
      cartolaId,
    ]);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
