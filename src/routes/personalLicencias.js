const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal, requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');
const { etiquetaPeriodo } = require('../lib/personalLiquidacionParse');
const { parseMaestroRemuneracionesExcel } = require('../lib/personalMaestroRemuneracionesParse');
const { armarDatosFormularioLicencia, diasEntreFechas } = require('../lib/personalLicenciasCodigos');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return cb(null, true);
    cb(new Error('Solo se aceptan archivos Excel (.xls o .xlsx)'));
  },
});

function parseIntSafe(v, def = null) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}

function parseDateInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

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
  const funcClause = sqlNombreTokens('COALESCE(f.nombre_completo, \'\')', tokens, params);

  const r = await db.query(
    `SELECT f.rut_normalizado, f.nombre_completo, f.tipo_funcionario, f.planta
     FROM personal_funcionarios f
     WHERE f.activo = TRUE${funcClause}
     ORDER BY f.nombre_completo
     LIMIT 25`,
    params
  );

  return r.rows.map((row) => ({
    rut_normalizado: row.rut_normalizado,
    rut: formatearRut(row.rut_normalizado),
    nombre_completo: row.nombre_completo,
    tipo_funcionario: row.tipo_funcionario,
    planta: row.planta,
  }));
}

function fechaReferenciaParts(query) {
  const raw = parseDateInput(query?.fecha_referencia) || new Date().toISOString().slice(0, 10);
  const d = new Date(raw + 'T12:00:00');
  return {
    fecha: raw,
    mes: d.getMonth() + 1,
    anio: d.getFullYear(),
    periodoKey: d.getFullYear() * 100 + (d.getMonth() + 1),
  };
}

async function obtenerFuncionarioPorRut(rut) {
  const r = await db.query(
    `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
            estado_laboral, planta, ubicacion, tipo_contrato, fecha_ingreso
     FROM personal_funcionarios WHERE rut_normalizado = $1`,
    [rut]
  );
  return r.rows[0] || null;
}

async function ultimoMaestroHasta(rut, periodoKey) {
  const r = await db.query(
    `SELECT mr.*, p.mes, p.anio, p.etiqueta
     FROM personal_maestro_remuneraciones mr
     JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
     WHERE mr.rut_normalizado = $1
       AND (p.anio * 100 + p.mes) <= $2
     ORDER BY p.anio DESC, p.mes DESC
     LIMIT 1`,
    [rut, periodoKey]
  );
  return r.rows[0] || null;
}

async function ultimasImponibles(rut, periodoKey, limite = 3) {
  const r = await db.query(
    `SELECT mr.imposiciones, p.mes, p.anio
     FROM personal_maestro_remuneraciones mr
     JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
     WHERE mr.rut_normalizado = $1
       AND (p.anio * 100 + p.mes) <= $2
       AND mr.imposiciones IS NOT NULL
       AND mr.imposiciones > 0
     ORDER BY p.anio DESC, p.mes DESC
     LIMIT $3`,
    [rut, periodoKey, limite]
  );
  return r.rows
    .map((row) => ({
      mes: row.mes,
      anio: row.anio,
      etiqueta: etiquetaPeriodo(row.mes, row.anio),
      monto_imponible: Number(row.imposiciones),
    }))
    .reverse();
}

async function listarLicenciasFuncionario(funcionarioId) {
  const r = await db.query(
    `SELECT id, funcionario_id, fecha_tramitacion, fecha_inicio, fecha_termino, dias, notas,
            created_by, updated_by, created_at, updated_at
     FROM personal_licencias
     WHERE funcionario_id = $1
     ORDER BY fecha_inicio DESC, created_at DESC`,
    [funcionarioId]
  );
  return r.rows;
}

async function armarFichaLicencia(funcionario, ref) {
  const maestro = await ultimoMaestroHasta(funcionario.rut_normalizado, ref.periodoKey);
  const tipoContrato = maestro?.tipo_contrato || funcionario.tipo_contrato;
  const datosFormulario = armarDatosFormularioLicencia({
    fondo: maestro?.fondo,
    salud: maestro?.salud,
    tipo_contrato: tipoContrato,
    seg_cesantia_emp: maestro?.seg_cesantia_emp,
  });

  const imponibles = await ultimasImponibles(funcionario.rut_normalizado, ref.periodoKey, 3);
  const licencias = await listarLicenciasFuncionario(funcionario.id);

  return {
    funcionario: {
      id: funcionario.id,
      rut: formatearRut(funcionario.rut_normalizado),
      rut_normalizado: funcionario.rut_normalizado,
      nombre_completo: funcionario.nombre_completo,
      tipo_funcionario: funcionario.tipo_funcionario,
      planta: funcionario.planta,
      ubicacion: funcionario.ubicacion,
      estado_laboral: funcionario.estado_laboral,
      fecha_ingreso: funcionario.fecha_ingreso,
    },
    fecha_referencia: ref.fecha,
    maestro_periodo: maestro
      ? {
          mes: maestro.mes,
          anio: maestro.anio,
          etiqueta: etiquetaPeriodo(maestro.mes, maestro.anio),
        }
      : null,
    datos_formulario: datosFormulario,
    ultimas_remuneraciones_imponibles: imponibles,
    licencias,
    avisos: maestro
      ? []
      : [
          'No hay maestro de remuneraciones cargado para este funcionario hasta la fecha de consulta. Subí el Excel mensual en la pestaña Maestro.',
        ],
  };
}

/** GET /licencias/consulta */
router.get('/licencias/consulta', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const rut = resolveRutInput(req.query?.rut);
    const termino = String(req.query?.nombre || req.query?.q || '').trim();
    const ref = fechaReferenciaParts(req.query);

    if (!rut && !termino) {
      return res.status(400).json({ error: 'Indicá RUT o nombre del funcionario' });
    }

    if (!rut && termino) {
      const coincidencias = await buscarCoincidenciasPorNombre(termino);
      if (!coincidencias.length) {
        return res.status(404).json({ error: 'No se encontraron funcionarios con ese nombre' });
      }
      if (coincidencias.length > 1) {
        return res.json({ coincidencias, fecha_referencia: ref.fecha });
      }
      const func = await obtenerFuncionarioPorRut(coincidencias[0].rut_normalizado);
      if (!func) return res.status(404).json({ error: 'Funcionario no encontrado' });
      return res.json(await armarFichaLicencia(func, ref));
    }

    const func = await obtenerFuncionarioPorRut(rut);
    if (!func) return res.status(404).json({ error: 'Funcionario no encontrado' });
    res.json(await armarFichaLicencia(func, ref));
  } catch (err) {
    console.error('[licencias/consulta]', err);
    res.status(500).json({ error: err.message || 'Error en consulta' });
  }
});

/** GET /licencias/maestro/periodos */
router.get('/licencias/maestro/periodos', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const r = await db.query(
      `SELECT id, mes, anio, nombre_archivo, total_registros, cargado_por, created_at
       FROM personal_maestro_remuneraciones_periodos
       ORDER BY anio DESC, mes DESC`
    );
    res.json(
      r.rows.map((row) => ({
        ...row,
        etiqueta: etiquetaPeriodo(row.mes, row.anio),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar maestros' });
  }
});

/** POST /licencias/maestro — importar Excel mensual */
router.post('/licencias/maestro', auth, upload.single('archivo'), async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjuntá el maestro de remuneraciones (Excel)' });
    }

    const mes = parseIntSafe(req.body?.mes);
    const anio = parseIntSafe(req.body?.anio);
    if (!mes || mes < 1 || mes > 12 || !anio) {
      return res.status(400).json({ error: 'Indicá mes (1-12) y año del maestro' });
    }

    const parsed = parseMaestroRemuneracionesExcel(req.file.buffer);
    if (!parsed.rows.length) {
      return res.status(400).json({ error: 'El Excel no tiene filas válidas' });
    }

    const { importarMaestro } = require('../lib/personalMaestroRemuneracionesImport');
    const result = await importarMaestro({
      rows: parsed.rows,
      mes,
      anio,
      nombreArchivo: req.file.originalname || 'maestro.xlsx',
      usuarioLogin: req.user.login,
    });

    await registrarAuditoriaPersonal(req, {
      accion: 'maestro_remuneraciones_importar',
      entidad: 'personal_maestro_remuneraciones_periodos',
      entidad_id: result.periodo_id,
      detalle_json: { mes, anio, insertados: result.registros, errores: parsed.errores.length },
    });

    res.status(201).json({
      periodo_id: result.periodo_id,
      mes,
      anio,
      etiqueta: etiquetaPeriodo(mes, anio),
      registros: result.registros,
      duplicados_omitidos: parsed.duplicados_omitidos,
      errores: parsed.errores,
      total_filas_excel: parsed.total,
    });
  } catch (err) {
    console.error('[licencias/maestro]', err);
    res.status(500).json({ error: err.message || 'Error al importar maestro' });
  }
});

/** POST /licencias/registros */
router.post('/licencias/registros', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const o = req.body || {};
    const funcionarioId = o.funcionario_id;
    const fechaInicio = parseDateInput(o.fecha_inicio);
    const fechaTermino = parseDateInput(o.fecha_termino);
    if (!funcionarioId) return res.status(400).json({ error: 'funcionario_id requerido' });
    if (!fechaInicio || !fechaTermino) {
      return res.status(400).json({ error: 'fecha_inicio y fecha_termino son obligatorias' });
    }

    const dias = parseIntSafe(o.dias) || diasEntreFechas(fechaInicio, fechaTermino);
    const r = await db.query(
      `INSERT INTO personal_licencias
         (funcionario_id, fecha_tramitacion, fecha_inicio, fecha_termino, dias, notas, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [
        funcionarioId,
        parseDateInput(o.fecha_tramitacion),
        fechaInicio,
        fechaTermino,
        dias,
        o.notas ? String(o.notas).trim() : null,
        req.user.login,
      ]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'licencia_crear',
      entidad: 'personal_licencias',
      entidad_id: r.rows[0].id,
      funcionario_id: funcionarioId,
      detalle_json: { fecha_inicio: fechaInicio, fecha_termino: fechaTermino, dias },
    });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al crear licencia' });
  }
});

/** PATCH /licencias/registros/:id */
router.patch('/licencias/registros/:id', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const prev = await db.query('SELECT * FROM personal_licencias WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Licencia no encontrada' });
    const before = prev.rows[0];
    const o = req.body || {};

    const fechaInicio = o.fecha_inicio !== undefined ? parseDateInput(o.fecha_inicio) : before.fecha_inicio;
    const fechaTermino = o.fecha_termino !== undefined ? parseDateInput(o.fecha_termino) : before.fecha_termino;
    const fechaTram = o.fecha_tramitacion !== undefined ? parseDateInput(o.fecha_tramitacion) : before.fecha_tramitacion;
    let dias = o.dias !== undefined ? parseIntSafe(o.dias) : before.dias;
    if (!dias) dias = diasEntreFechas(fechaInicio, fechaTermino);

    const r = await db.query(
      `UPDATE personal_licencias SET
         fecha_tramitacion = $1,
         fecha_inicio = $2,
         fecha_termino = $3,
         dias = $4,
         notas = COALESCE($5, notas),
         updated_by = $6,
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        fechaTram,
        fechaInicio,
        fechaTermino,
        dias,
        o.notas !== undefined ? String(o.notas || '').trim() || null : null,
        req.user.login,
        req.params.id,
      ]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'licencia_editar',
      entidad: 'personal_licencias',
      entidad_id: req.params.id,
      funcionario_id: before.funcionario_id,
    });

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar licencia' });
  }
});

/** DELETE /licencias/registros/:id */
router.delete('/licencias/registros/:id', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const prev = await db.query('SELECT * FROM personal_licencias WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Licencia no encontrada' });

    await db.query('DELETE FROM personal_licencias WHERE id = $1', [req.params.id]);

    await registrarAuditoriaPersonal(req, {
      accion: 'licencia_eliminar',
      entidad: 'personal_licencias',
      entidad_id: req.params.id,
      funcionario_id: prev.rows[0].funcionario_id,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al eliminar licencia' });
  }
});

module.exports = router;
