const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeCodigoCuenta } = require('../lib/presupuestoCuenta');
const { parseEjecucionPresupuestoXlsx } = require('../lib/presupuestoImportXlsx');
const {
  calcularSeguimientoEjecucion,
  enriquecerLineaConPct,
} = require('../lib/presupuestoEjecucion');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function getCargaActiva() {
  const r = await db.query(
    `SELECT * FROM presupuesto_cargas WHERE activa = true ORDER BY created_at DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

async function getComprometidoPorCuenta() {
  const r = await db.query(
    `SELECT cuenta_contable,
            COALESCE(SUM(COALESCE(NULLIF(monto_real, 0), monto, 0)), 0)::bigint AS comprometido
     FROM expedientes
     WHERE cuenta_contable IS NOT NULL AND trim(cuenta_contable) <> ''
     GROUP BY cuenta_contable`
  );
  const map = new Map();
  for (const row of r.rows) {
    const cod = normalizeCodigoCuenta(row.cuenta_contable);
    if (!cod) continue;
    const prev = map.get(cod) || 0;
    map.set(cod, prev + Number(row.comprometido || 0));
  }
  return map;
}

function enriquecerLineas(lineas, comprometidoMap) {
  return lineas.map((l) => {
    const comprometido = comprometidoMap.get(l.codigo_cuenta) || 0;
    const disponible = Number(l.saldo_oficial || 0) - comprometido;
    return {
      ...l,
      comprometido_sigex: comprometido,
      disponible_sigex: disponible,
    };
  });
}

function totalesDesdeLineas(lineas) {
  return lineas.reduce(
    (acc, l) => {
      acc.presup_vigente += Number(l.presup_vigente || 0);
      acc.devengado += Number(l.devengado || 0);
      acc.saldo_oficial += Number(l.saldo_oficial || 0);
      acc.comprometido_sigex += Number(l.comprometido_sigex || 0);
      acc.disponible_sigex += Number(l.disponible_sigex || 0);
      return acc;
    },
    {
      presup_vigente: 0,
      devengado: 0,
      saldo_oficial: 0,
      comprometido_sigex: 0,
      disponible_sigex: 0,
    }
  );
}

// Resumen + líneas cuenta 22 (carga activa)
router.get('/', auth, async (req, res) => {
  try {
    const carga = await getCargaActiva();
    if (!carga) {
      return res.json({
        carga: null,
        totales: null,
        lineas: [],
        mensaje: 'Importá el Excel de ejecución presupuestaria (subtítulo 22).',
      });
    }

    const { q, solo_imputables, cuenta } = req.query;
    let sql = `SELECT * FROM presupuesto_lineas WHERE carga_id = $1`;
    const params = [carga.id];
    if (solo_imputables === 'true') {
      sql += ` AND es_imputable = true`;
    }
    const codigoFiltro = cuenta ? normalizeCodigoCuenta(cuenta) : null;
    if (codigoFiltro) {
      params.push(codigoFiltro);
      sql += ` AND codigo_cuenta = $${params.length}`;
    } else if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      sql += ` AND (codigo_cuenta ILIKE $${params.length} OR denominacion ILIKE $${params.length})`;
    }
    sql += ` ORDER BY codigo_cuenta`;

    const lineasDb = await db.query(sql, params);
    const comprometidoMap = await getComprometidoPorCuenta();
    let lineas = enriquecerLineas(lineasDb.rows, comprometidoMap).map(enriquecerLineaConPct);
    const lineasImputables = lineas.filter((l) => l.es_imputable);
    const totales = totalesDesdeLineas(lineasImputables.length ? lineasImputables : lineas);

    const ejecucion = calcularSeguimientoEjecucion(totales, {
      fechaReferencia: carga.fecha_corte,
      anio: carga.anio,
    });

    let detalleCuenta = null;
    if (codigoFiltro && lineas.length === 1) {
      const compras = await db.query(
        `SELECT id, numero, descripcion, estado, created_at,
                COALESCE(NULLIF(monto_real, 0), monto, 0) AS monto_comprometido
         FROM expedientes
         WHERE cuenta_contable IS NOT NULL AND trim(cuenta_contable) <> ''
         ORDER BY created_at DESC`
      );
      detalleCuenta = {
        linea: lineas[0],
        compras: compras.rows.filter((e) => normalizeCodigoCuenta(e.cuenta_contable) === codigoFiltro),
      };
    }

    res.json({ carga, totales, lineas, ejecucion, detalle_cuenta: detalleCuenta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalle de una cuenta (para formulario de compra)
router.get('/cuenta/:codigo', auth, async (req, res) => {
  try {
    const codigo = normalizeCodigoCuenta(req.params.codigo);
    if (!codigo) return res.status(400).json({ error: 'Código de cuenta inválido' });

    const carga = await getCargaActiva();
    if (!carga) return res.status(404).json({ error: 'No hay presupuesto cargado' });

    const linea = await db.query(
      `SELECT * FROM presupuesto_lineas WHERE carga_id = $1 AND codigo_cuenta = $2`,
      [carga.id, codigo]
    );
    if (!linea.rows.length) {
      return res.status(404).json({ error: 'Cuenta no encontrada en la ejecución cargada', codigo_cuenta: codigo });
    }

    const comprometidoMap = await getComprometidoPorCuenta();
    const [enriquecida] = enriquecerLineas(linea.rows, comprometidoMap).map(enriquecerLineaConPct);

    const ejecucionCuenta = calcularSeguimientoEjecucion(
      {
        presup_vigente: enriquecida.presup_vigente,
        devengado: enriquecida.devengado,
        comprometido_sigex: enriquecida.comprometido_sigex,
      },
      { fechaReferencia: carga.fecha_corte, anio: carga.anio }
    );

    const compras = await db.query(
      `SELECT id, numero, descripcion, estado,
              COALESCE(NULLIF(monto_real, 0), monto, 0) AS monto_comprometido
       FROM expedientes
       WHERE cuenta_contable IS NOT NULL
         AND trim(cuenta_contable) <> ''
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const vinculadas = compras.rows.filter(
      (e) => normalizeCodigoCuenta(e.cuenta_contable) === codigo
    );

    res.json({ carga, linea: enriquecida, compras: vinculadas, ejecucion: ejecucionCuenta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cuentas imputables (autocompletar en compras)
router.get('/cuentas-imputables', auth, async (req, res) => {
  try {
    const carga = await getCargaActiva();
    if (!carga) return res.json([]);
    const { q } = req.query;
    let sql = `SELECT codigo_cuenta, denominacion, saldo_oficial, es_imputable
               FROM presupuesto_lineas WHERE carga_id = $1 AND es_imputable = true`;
    const params = [carga.id];
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      sql += ` AND (codigo_cuenta ILIKE $${params.length} OR denominacion ILIKE $${params.length})`;
    }
    sql += ` ORDER BY codigo_cuenta LIMIT 80`;
    const r = await db.query(sql, params);
    const comprometidoMap = await getComprometidoPorCuenta();
    res.json(enriquecerLineas(r.rows, comprometidoMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importar Excel (solo subtítulo 22 por defecto)
router.post('/importar', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Adjuntá el archivo Excel (.xlsx)' });
    }

    const parsed = parseEjecucionPresupuestoXlsx(req.file.buffer, {
      subtitulo: req.body?.subtitulo || '22',
    });

    if (!parsed.lineas.length) {
      return res.status(400).json({
        error: `No se encontraron filas para subtítulo ${parsed.subtitulo_filtro} en el Excel`,
      });
    }

    await db.query('BEGIN');
    await db.query(
      `UPDATE presupuesto_cargas SET activa = false WHERE anio = $1 AND activa = true`,
      [parsed.anio]
    );

    const cargaIns = await db.query(
      `INSERT INTO presupuesto_cargas (anio, fecha_corte, titulo, archivo_nombre, subtitulo_filtro, activa, cargado_por)
       VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING *`,
      [
        parsed.anio,
        parsed.fecha_corte,
        `Ejecución subtítulo ${parsed.subtitulo_filtro} al ${parsed.fecha_corte}`,
        req.file.originalname || 'import.xlsx',
        parsed.subtitulo_filtro,
        req.user.login,
      ]
    );
    const carga = cargaIns.rows[0];

    for (const l of parsed.lineas) {
      await db.query(
        `INSERT INTO presupuesto_lineas (
          carga_id, subtitulo, item, asig, sasig, subasig, codigo_cuenta, denominacion,
          presup_inicial, presup_vigente, devengado, saldo_oficial, deuda_exigible, es_imputable
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          carga.id,
          l.subtitulo,
          l.item,
          l.asig,
          l.sasig,
          l.subasig,
          l.codigo_cuenta,
          l.denominacion,
          l.presup_inicial,
          l.presup_vigente,
          l.devengado,
          l.saldo_oficial,
          l.deuda_exigible,
          l.es_imputable,
        ]
      );
    }

    await db.query('COMMIT');

    res.status(201).json({
      ok: true,
      carga,
      importados: parsed.total_lineas,
      imputables: parsed.imputables,
      anio: parsed.anio,
      fecha_corte: parsed.fecha_corte,
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message || 'Error al importar' });
  }
});

module.exports = router;
