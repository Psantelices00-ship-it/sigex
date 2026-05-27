const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeCodigoCuenta } = require('../lib/presupuestoCuenta');
const { parseIngresosPresupuestoXlsx } = require('../lib/presupuestoIngresoImportXlsx');
const {
  calcularSeguimientoIngresos,
  enriquecerLineaIngreso,
  totalesIngresos,
} = require('../lib/presupuestoIngresoEjecucion');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function getCargaActiva() {
  const r = await db.query(
    `SELECT * FROM ingresos_presupuesto_cargas WHERE activa = true ORDER BY created_at DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

router.get('/', auth, async (req, res) => {
  try {
    const carga = await getCargaActiva();
    if (!carga) {
      return res.json({
        carga: null,
        totales: null,
        lineas: [],
        ejecucion: null,
        mensaje: 'Importá el Excel de ingresos o indicá los subtítulos de ingreso en el archivo.',
      });
    }

    const { q, solo_imputables, cuenta } = req.query;
    let sql = `SELECT * FROM ingresos_presupuesto_lineas WHERE carga_id = $1`;
    const params = [carga.id];
    if (solo_imputables === 'true') sql += ` AND es_imputable = true`;
    const codigoFiltro = cuenta ? normalizeCodigoCuenta(cuenta) : null;
    if (codigoFiltro) {
      params.push(codigoFiltro);
      sql += ` AND codigo_cuenta = $${params.length}`;
    } else if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      sql += ` AND (codigo_cuenta ILIKE $${params.length} OR denominacion ILIKE $${params.length})`;
    }
    sql += ` ORDER BY codigo_cuenta`;

    const rows = await db.query(sql, params);
    let lineas = rows.rows.map(enriquecerLineaIngreso);
    const imputables = lineas.filter((l) => l.es_imputable);
    const totales = totalesIngresos(imputables.length ? imputables : lineas);
    const ejecucion = calcularSeguimientoIngresos(totales, {
      fechaReferencia: carga.fecha_corte,
      anio: carga.anio,
    });

    res.json({ carga, totales, lineas, ejecucion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/lineas/:id', auth, async (req, res) => {
  try {
    const { ingreso_real } = req.body || {};
    if (ingreso_real === undefined) {
      return res.status(400).json({ error: 'Indicá ingreso_real' });
    }
    const val =
      ingreso_real === null || ingreso_real === '' ? 0 : Math.round(Number(ingreso_real));
    if (Number.isNaN(val) || val < 0) {
      return res.status(400).json({ error: 'Ingreso real inválido' });
    }

    const r = await db.query(
      `UPDATE ingresos_presupuesto_lineas SET ingreso_real = $1 WHERE id = $2 RETURNING *`,
      [val, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Línea no encontrada' });
    res.json(enriquecerLineaIngreso(r.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/importar', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Adjuntá el archivo Excel (.xlsx)' });
    }

    const parsed = parseIngresosPresupuestoXlsx(req.file.buffer, {
      subtitulos: req.body?.subtitulos,
    });

    if (!parsed.lineas.length) {
      return res.status(400).json({
        error:
          'No se encontraron filas de ingreso. Verificá el Excel o indicá subtítulos (ej. 11,12,13) en el formulario de importación.',
        subtitulos_intentados: parsed.subtitulos_filtro,
      });
    }

    await db.query('BEGIN');
    await db.query(
      `UPDATE ingresos_presupuesto_cargas SET activa = false WHERE anio = $1 AND activa = true`,
      [parsed.anio]
    );

    const cargaIns = await db.query(
      `INSERT INTO ingresos_presupuesto_cargas (anio, fecha_corte, titulo, archivo_nombre, subtitulos_filtro, activa, cargado_por)
       VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING *`,
      [
        parsed.anio,
        parsed.fecha_corte,
        `Ingresos · subtítulos ${parsed.subtitulos_filtro} al ${parsed.fecha_corte}`,
        req.file.originalname || 'import.xlsx',
        parsed.subtitulos_filtro,
        req.user.login,
      ]
    );
    const carga = cargaIns.rows[0];

    for (const l of parsed.lineas) {
      await db.query(
        `INSERT INTO ingresos_presupuesto_lineas (
          carga_id, subtitulo, item, asig, sasig, subasig, codigo_cuenta, denominacion,
          presup_vigente, ingreso_oficial, ingreso_real, es_imputable
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          carga.id,
          l.subtitulo,
          l.item,
          l.asig,
          l.sasig,
          l.subasig,
          l.codigo_cuenta,
          l.denominacion,
          l.presup_vigente,
          l.ingreso_oficial,
          l.ingreso_real,
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
      subtitulos: parsed.subtitulos_filtro,
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message || 'Error al importar ingresos' });
  }
});

module.exports = router;
