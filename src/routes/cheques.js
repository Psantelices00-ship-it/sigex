const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const uploadToCloudinary = require('../cloudinary_upload');
const { streamRemoteFileToResponse } = require('../streamRemoteFile');
const {
  parsearMovimientosCartolaPdfTexto,
  movimientosChequeDeCartola,
  fechaCartolaAIsoDate,
} = require('../lib/chequesCartolaParse');
const { requireEditarRegistro } = require('../lib/registroEdicionPermisos');

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

function parseMovimientosCartolaGuardados(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Array.isArray(raw) ? raw : [];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const v = JSON.parse(t);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
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
    if (!requireEditarRegistro(req, res)) return;
    const prev = await db.query('SELECT * FROM cheques_emitidos WHERE id=$1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Cheque no encontrado' });
    const o = req.body || {};
    const prevRow = prev.rows[0];

    let beneficiario = prevRow.beneficiario;
    if (o.beneficiario !== undefined) {
      beneficiario = String(o.beneficiario || '').trim();
      if (!beneficiario) return res.status(400).json({ error: 'El beneficiario es obligatorio' });
    }

    let fecha_emision = prevRow.fecha_emision;
    if (o.fecha_emision !== undefined) {
      fecha_emision = String(o.fecha_emision || '').slice(0, 10);
      if (!fecha_emision) return res.status(400).json({ error: 'La fecha de emisión es obligatoria' });
    }

    let numero_cheque = prevRow.numero_cheque;
    if (o.numero_cheque !== undefined) {
      numero_cheque = String(o.numero_cheque || '').trim().replace(/\s/g, '');
      if (!numero_cheque) return res.status(400).json({ error: 'El N° de cheque es obligatorio' });
    }

    let tipo_pago = prevRow.tipo_pago;
    if (o.tipo_pago !== undefined) {
      let t = String(o.tipo_pago || 'OTRO').toUpperCase();
      if (!['REMUNERACION', 'PREVISIONAL', 'OTRO'].includes(t)) t = 'OTRO';
      tipo_pago = t;
    }

    let talonario_id = prevRow.talonario_id;
    if (o.talonario_id !== undefined) {
      talonario_id = o.talonario_id || null;
    }
    if (talonario_id) {
      const tal = await db.query('SELECT * FROM cheques_talonarios WHERE id=$1', [talonario_id]);
      if (!tal.rows.length) return res.status(400).json({ error: 'Talonario no encontrado' });
      const n = parseInt(String(numero_cheque).replace(/\D/g, ''), 10);
      const t = tal.rows[0];
      if (!Number.isFinite(n) || n < t.numero_desde || n > t.numero_hasta) {
        return res.status(400).json({ error: 'El N° está fuera del talonario' });
      }
    }

    let monto = prevRow.monto;
    if (o.monto !== undefined) {
      if (o.monto === '' || o.monto == null) monto = null;
      else {
        const n = Number(o.monto);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'Monto inválido' });
        monto = n;
      }
    }

    let banco_emisor = prevRow.banco_emisor;
    if (o.banco_emisor !== undefined) {
      banco_emisor = typeof o.banco_emisor === 'string' ? o.banco_emisor.trim() || null : null;
    }

    let observacion = prevRow.observacion;
    if (o.observacion !== undefined) {
      observacion = typeof o.observacion === 'string' ? o.observacion.trim() || null : null;
    }

    let estado = prevRow.estado;
    if (o.estado !== undefined) {
      if (!['anulado', 'emitido', 'cobrado'].includes(o.estado)) {
        return res.status(400).json({ error: 'Estado no válido' });
      }
      estado = o.estado;
    }

    const result = await db.query(
      `UPDATE cheques_emitidos SET
        talonario_id=$1,
        numero_cheque=$2,
        fecha_emision=$3,
        beneficiario=$4,
        tipo_pago=$5,
        monto=$6,
        banco_emisor=$7,
        observacion=$8,
        estado=$9
       WHERE id=$10 RETURNING *`,
      [
        talonario_id,
        numero_cheque,
        fecha_emision,
        beneficiario,
        tipo_pago,
        monto,
        banco_emisor,
        observacion,
        estado,
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
    const movimientos_parseados = parsearMovimientosCartolaPdfTexto(texto) || [];
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
        JSON.stringify(movimientos_parseados),
      ]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conciliar', auth, async (req, res) => {
  const cartolaId = req.body?.cartola_id;
  if (!cartolaId) {
    return res.status(400).json({ error: 'Falta cartola_id en el cuerpo de la solicitud' });
  }

  try {
    const cart = await db.query('SELECT * FROM cheques_cartolas WHERE id=$1', [cartolaId]);
    if (!cart.rows.length) return res.status(404).json({ error: 'Cartola no encontrada' });
    const cartola = cart.rows[0];
    const movs = parseMovimientosCartolaGuardados(cartola.movimientos_parseados);
    const movsChq = movimientosChequeDeCartola(movs);
    if (!movsChq.length) {
      return res.status(400).json({
        error: 'La cartola no tiene movimientos de cheque parseados. Volvé a importar el PDF.',
        movimientos_total: movs.length,
      });
    }

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
      const fechaCobroIso = fechaCartolaAIsoDate(m.fecha);
      if (m.fecha && !fechaCobroIso) {
        console.warn('[cheques/conciliar] fecha no convertida', m.nro_documento, m.fecha);
      }
      const match = {
        nro_documento: m.nro_documento,
        fecha_movimiento: m.fecha,
        fecha_cobro_iso: fechaCobroIso,
        descripcion_cartola: m.descripcion,
        cargo_fmt: m.cargo_fmt,
      };
      await db.query(
        `UPDATE cheques_emitidos SET estado='cobrado', cartola_id=$1, fecha_cobro_cartola=$2, match_cartola=$3::jsonb
         WHERE id=$4`,
        [cartolaId, fechaCobroIso, JSON.stringify(match), e.id]
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
    await db.query('UPDATE cheques_cartolas SET resultado_conciliacion=$1::jsonb WHERE id=$2', [
      JSON.stringify(resultado),
      cartolaId,
    ]);
    res.json(resultado);
  } catch (err) {
    console.error('[cheques/conciliar]', cartolaId, err?.message, err?.stack);
    res.status(500).json({
      error: err.message || 'Error en conciliación',
      code: 'CONCILIAR_ERROR',
      cartola_id: cartolaId,
    });
  }
});

module.exports = router;
