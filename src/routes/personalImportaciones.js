const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { parseFuncionariosExcel } = require('../lib/personalFuncionariosExcel');
const { requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const {
  DEFAULT_BASE,
  carpetaImportHabilitado,
  importarCarpetasDesdeDisco,
} = require('../lib/personalCarpetasImport');

/** Evita dos importaciones de carpetas simultáneas en el mismo proceso. */
let carpetaImportRunning = false;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return cb(null, true);
    cb(new Error('Solo Excel (.xls o .xlsx)'));
  },
});

router.post('/importaciones/funcionarios-excel', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    if (!req.file?.buffer) return res.status(400).json({ error: 'Adjuntá el archivo Excel' });

    const inicio = Date.now();
    const imp = await db.query(
      `INSERT INTO personal_importaciones (tipo, estado, usuario_login) VALUES ('funcionarios_excel', 'procesando', $1) RETURNING id`,
      [req.user.login]
    );
    const importId = imp.rows[0].id;

    const { rows, errores: erroresParseo } = parseFuncionariosExcel(req.file.buffer);
    let creados = 0;
    let actualizados = 0;
    const errores = [...erroresParseo];

    for (const row of rows) {
      try {
        const exist = await db.query('SELECT id FROM personal_funcionarios WHERE rut_normalizado = $1', [
          row.rut_normalizado,
        ]);
        if (exist.rows.length) {
          await db.query(
            `UPDATE personal_funcionarios SET
              nombre_completo = $1, tipo_funcionario = $2, planta = $3, ubicacion = $4,
              fecha_ingreso = COALESCE($5, fecha_ingreso), fecha_nacimiento = COALESCE($6, fecha_nacimiento),
              profesion = COALESCE($7, profesion), tipo_contrato = COALESCE($8, tipo_contrato),
              updated_at = NOW(), updated_by = $9
             WHERE id = $10`,
            [
              row.nombre_completo,
              row.tipo_funcionario,
              row.planta,
              row.ubicacion,
              row.fecha_ingreso,
              row.fecha_nacimiento,
              row.profesion,
              row.tipo_contrato,
              req.user.login,
              exist.rows[0].id,
            ]
          );
          actualizados++;
        } else {
          await db.query(
            `INSERT INTO personal_funcionarios
              (rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
               planta, ubicacion, fecha_ingreso, fecha_nacimiento, profesion, tipo_contrato, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
            [
              row.rut_normalizado,
              row.rut_numero,
              row.rut_dv,
              row.nombre_completo,
              row.tipo_funcionario,
              row.planta,
              row.ubicacion,
              row.fecha_ingreso,
              row.fecha_nacimiento,
              row.profesion,
              row.tipo_contrato,
              req.user.login,
            ]
          );
          creados++;
        }
      } catch (e) {
        errores.push({ linea: row.linea, rut: row.rut_normalizado, error: e.message });
      }
    }

    const resumen = {
      filas_leidas: rows.length + erroresParseo.length,
      filas_validas: rows.length,
      funcionarios_creados: creados,
      funcionarios_actualizados: actualizados,
      errores: errores.length,
      detalle_errores: errores.slice(0, 100),
      tiempo_ms: Date.now() - inicio,
      archivo: req.file.originalname,
    };

    await db.query(
      `UPDATE personal_importaciones SET estado = 'completado', fin = NOW(), resumen_json = $2 WHERE id = $1`,
      [importId, JSON.stringify(resumen)]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'importacion_funcionarios_excel',
      entidad: 'personal_importaciones',
      entidad_id: importId,
      detalle_json: resumen,
    });

    res.json({ importacion_id: importId, ...resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/importaciones/:id', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const r = await db.query(
      `SELECT id, tipo, estado, usuario_login, inicio, fin, resumen_json, error_mensaje
       FROM personal_importaciones WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Importación no encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/importaciones/carpetas-pdf', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    if (!carpetaImportHabilitado()) {
      return res.status(403).json({
        error:
          'Importación de carpetas solo disponible con el API en local (o PERSONAL_IMPORT_CARPETAS_ENABLED=1). Conectá el disco TOSHIBA y ejecutá el backend en tu Mac.',
      });
    }
    if (carpetaImportRunning) {
      return res.status(409).json({ error: 'Ya hay una importación de carpetas en curso en este servidor' });
    }

    const body = req.body || {};
    const limiteCarpetas = Number(body.limite_carpetas) || 0;
    const dryRun = body.dry_run === true || body.dry_run === 'true';
    const basePath = body.base_path || DEFAULT_BASE;

    const imp = await db.query(
      `INSERT INTO personal_importaciones (tipo, estado, usuario_login, resumen_json)
       VALUES ('carpetas_pdf', 'procesando', $1, $2) RETURNING id`,
      [
        req.user.login,
        JSON.stringify({ base_path: basePath, limite_carpetas: limiteCarpetas, dry_run: dryRun, progreso: 0 }),
      ]
    );
    const importId = imp.rows[0].id;

    res.status(202).json({
      importacion_id: importId,
      estado: 'procesando',
      mensaje: dryRun
        ? 'Simulación iniciada (no se suben archivos)'
        : 'Importación iniciada. Consultá el progreso en esta pantalla.',
    });

    carpetaImportRunning = true;
    setImmediate(async () => {
      try {
        const resumen = await importarCarpetasDesdeDisco({
          basePath,
          usuarioLogin: req.user.login,
          importacionId: importId,
          limiteCarpetas,
          dryRun,
          onProgress: async (partial) => {
            await db.query(`UPDATE personal_importaciones SET resumen_json = $2 WHERE id = $1`, [
              importId,
              JSON.stringify({ ...partial, progreso: partial.indice, estado_job: 'procesando' }),
            ]);
          },
        });

        await db.query(
          `UPDATE personal_importaciones SET estado = 'completado', fin = NOW(), resumen_json = $2 WHERE id = $1`,
          [importId, JSON.stringify({ ...resumen, estado_job: 'completado' })]
        );

        await registrarAuditoriaPersonal(req, {
          accion: dryRun ? 'importacion_carpetas_simulacion' : 'importacion_carpetas_pdf',
          entidad: 'personal_importaciones',
          entidad_id: importId,
          detalle_json: {
            carpetas: resumen.carpetas_procesadas,
            documentos_cargados: resumen.documentos_cargados,
            rechazados: resumen.documentos_rechazados,
          },
        });
      } catch (err) {
        await db.query(
          `UPDATE personal_importaciones SET estado = 'error', fin = NOW(), error_mensaje = $2 WHERE id = $1`,
          [importId, err.message || String(err)]
        );
      } finally {
        carpetaImportRunning = false;
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/importaciones', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const r = await db.query(
      `SELECT id, tipo, estado, usuario_login, inicio, fin, resumen_json, error_mensaje
       FROM personal_importaciones ORDER BY inicio DESC LIMIT 30`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
