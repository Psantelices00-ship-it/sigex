const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const {
  armarResumenCarpeta,
  listarCarpetasResumen,
  exportarCarpetaZip,
  exportarCarpetasMasivoZip,
  datosExportCarpeta,
} = require('../lib/personalCarpetaService');

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

function sqlNombreTokens(haystackExpr, tokens, params) {
  let clause = '';
  for (const tok of tokens) {
    params.push(`%${tok}%`);
    clause += ` AND LOWER(${haystackExpr}) LIKE $${params.length}`;
  }
  return clause;
}

async function buscarCoincidenciasPorNombre(termino) {
  const tokens = nombreBusquedaTokens(termino);
  if (!tokens.length) return [];

  const params = [];
  const funcClause = sqlNombreTokens("COALESCE(nombre_completo, '')", tokens, params);
  const r = await db.query(
    `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
            estado_laboral, activo, planta, ubicacion
     FROM personal_funcionarios
     WHERE 1=1${funcClause}
     ORDER BY nombre_completo
     LIMIT 26`,
    params
  );
  return r.rows;
}

function mapCoincidencia(f) {
  return {
    id: f.id,
    rut: formatearRut(f.rut_normalizado),
    rut_normalizado: f.rut_normalizado,
    nombre_completo: f.nombre_completo,
    tipo_funcionario: f.tipo_funcionario,
    estado_laboral: f.estado_laboral,
    activo: f.activo,
    planta: f.planta,
    ubicacion: f.ubicacion,
  };
}

/** GET /carpetas — listado de todas las carpetas con resumen */
router.get('/carpetas', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const data = await listarCarpetasResumen({
      q: req.query?.q,
      estado: req.query?.estado || 'todos',
    });
    res.json(data);
  } catch (err) {
    console.error('[carpetas/listado]', err);
    res.status(500).json({ error: err.message || 'Error al listar carpetas' });
  }
});

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

    if (!nombreBusquedaTokens(termino).length) {
      return res.status(400).json({ error: 'Indicá al menos 3 caracteres para buscar por nombre' });
    }

    const rows = await buscarCoincidenciasPorNombre(termino);
    if (!rows.length) {
      return res.status(404).json({ error: 'No se encontraron funcionarios con ese nombre' });
    }

    if (rows.length > 1) {
      return res.json({
        coincidencias: rows.slice(0, 25).map(mapCoincidencia),
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

    const incluirLiquidaciones = req.body?.incluir_liquidaciones !== false;
    const pack = await datosExportCarpeta(req.params.id, incluirLiquidaciones);
    if (!pack) return res.status(404).json({ error: 'Funcionario no encontrado' });

    await registrarAuditoriaPersonal(req, {
      accion: 'carpeta_exportar_zip',
      entidad: 'personal_funcionarios',
      entidad_id: req.params.id,
      funcionario_id: req.params.id,
      detalle_json: {
        documentos: pack.resumen.documentos.length,
        liquidaciones: pack.liquidacionesRows.length,
      },
    });

    await exportarCarpetaZip({
      res,
      funcionario: pack.resumen.funcionario,
      documentos: pack.resumen.documentos,
      liquidaciones: pack.liquidacionesRows,
      resumenJson: pack.resumenJson,
    });
  } catch (err) {
    console.error('[carpetas/exportar-zip]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Error al exportar carpeta' });
    }
  }
});

/** POST /carpetas/exportar-masivo — ZIP con varias carpetas (subcarpeta por funcionario) */
router.post('/carpetas/exportar-masivo', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const ids = Array.isArray(req.body?.funcionario_ids) ? req.body.funcionario_ids : [];
    if (!ids.length) {
      return res.status(400).json({ error: 'Indicá al menos un funcionario para exportar' });
    }
    if (ids.length > 500) {
      return res.status(400).json({
        error: 'Máximo 500 carpetas por ZIP consolidado. Usá «Guardar en carpeta» para lotes mayores.',
      });
    }

    const incluirLiquidaciones = req.body?.incluir_liquidaciones !== false;

    await registrarAuditoriaPersonal(req, {
      accion: 'carpeta_exportar_masivo',
      entidad: 'personal_funcionarios',
      detalle_json: { cantidad: ids.length, incluir_liquidaciones: incluirLiquidaciones },
    });

    await exportarCarpetasMasivoZip(res, {
      funcionarioIds: ids,
      incluirLiquidaciones,
    });
  } catch (err) {
    console.error('[carpetas/exportar-masivo]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Error al exportar carpetas' });
    }
  }
});

module.exports = router;
