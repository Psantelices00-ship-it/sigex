const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const { armarResumenCarpeta, exportarCarpetaZip } = require('../lib/personalCarpetaService');

function resolveRutInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const parts = normalizeRutParts(raw);
  return parts?.rut_normalizado || null;
}

function nombreBusquedaTokens(input) {
  const tokens = String(input || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length) return tokens;
  const whole = String(input || '').trim().toLowerCase();
  return whole.length >= 3 ? [whole] : [];
}

/** GET /carpetas/consulta — buscar funcionario (activos e inactivos) */
router.get('/carpetas/consulta', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const rut = resolveRutInput(req.query?.rut);
    const termino = String(req.query?.nombre || req.query?.q || '').trim();

    if (!rut && !termino) {
      return res.status(400).json({ error: 'Indicá RUT o nombre del funcionario' });
    }

    if (rut) {
      const r = await db.query(
        `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
                estado_laboral, activo, planta, ubicacion
         FROM personal_funcionarios WHERE rut_normalizado = $1`,
        [rut]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Funcionario no encontrado' });
      const resumen = await armarResumenCarpeta(r.rows[0].id);
      return res.json(resumen);
    }

    const tokens = nombreBusquedaTokens(termino);
    if (!tokens.length) {
      return res.status(400).json({ error: 'Indicá al menos 3 caracteres para buscar por nombre' });
    }

    const all = await db.query(
      `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
              estado_laboral, activo, planta, ubicacion
       FROM personal_funcionarios
       ORDER BY nombre_completo
       LIMIT 2000`
    );

    const qLower = termino.toLowerCase();
    let rows = all.rows.filter((f) => {
      const nombre = String(f.nombre_completo || '').toLowerCase();
      return tokens.every((t) => nombre.includes(t)) || nombre.includes(qLower);
    });

    if (!rows.length) {
      return res.status(404).json({ error: 'No se encontraron funcionarios con ese nombre' });
    }

    if (rows.length > 1) {
      return res.json({
        coincidencias: rows.slice(0, 25).map((f) => ({
          id: f.id,
          rut: formatearRut(f.rut_normalizado),
          rut_normalizado: f.rut_normalizado,
          nombre_completo: f.nombre_completo,
          tipo_funcionario: f.tipo_funcionario,
          estado_laboral: f.estado_laboral,
          activo: f.activo,
          planta: f.planta,
          ubicacion: f.ubicacion,
        })),
      });
    }

    const resumen = await armarResumenCarpeta(rows[0].id);
    res.json(resumen);
  } catch (err) {
    console.error('[carpetas/consulta]', err);
    res.status(500).json({ error: err.message || 'Error en consulta' });
  }
});

/** GET /carpetas/funcionarios/:id/resumen */
router.get('/carpetas/funcionarios/:id/resumen', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const resumen = await armarResumenCarpeta(req.params.id);
    if (!resumen) return res.status(404).json({ error: 'Funcionario no encontrado' });
    res.json(resumen);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al cargar carpeta' });
  }
});

/** POST /carpetas/funcionarios/:id/exportar-zip */
router.post('/carpetas/funcionarios/:id/exportar-zip', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const resumen = await armarResumenCarpeta(req.params.id);
    if (!resumen) return res.status(404).json({ error: 'Funcionario no encontrado' });

    const incluirLiquidaciones = req.body?.incluir_liquidaciones !== false;
    let liquidacionesRows = [];
    if (incluirLiquidaciones && resumen.liquidaciones_total) {
      const liq = await db.query(
        `SELECT lr.pagina, p.mes, p.anio, p.etiqueta, p.file_path
         FROM personal_liquidaciones_registros lr
         JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
         WHERE lr.rut_normalizado = $1 AND p.estado = 'completo'
           AND p.file_path IS NOT NULL AND trim(p.file_path) <> ''
         ORDER BY p.anio, p.mes`,
        [resumen.funcionario.rut_normalizado]
      );
      liquidacionesRows = liq.rows;
    }

    await registrarAuditoriaPersonal(req, {
      accion: 'carpeta_exportar_zip',
      entidad: 'personal_funcionarios',
      entidad_id: req.params.id,
      funcionario_id: req.params.id,
      detalle_json: {
        documentos: resumen.documentos.length,
        liquidaciones: liquidacionesRows.length,
      },
    });

    await exportarCarpetaZip({
      res,
      funcionario: resumen.funcionario,
      documentos: resumen.documentos,
      liquidaciones: liquidacionesRows,
      resumenJson: {
        exportado_en: new Date().toISOString(),
        funcionario: resumen.funcionario,
        documentos_resumen: resumen.documentos_resumen,
        licencias: resumen.licencias,
        liquidaciones_total: resumen.liquidaciones_total,
        archivos_incluidos: resumen.documentos.length,
        liquidaciones_incluidas: liquidacionesRows.length,
      },
    });
  } catch (err) {
    console.error('[carpetas/exportar-zip]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Error al exportar carpeta' });
    }
  }
});

module.exports = router;
