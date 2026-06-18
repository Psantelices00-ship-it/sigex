const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeRutParts, formatearRut, rutMatchesQuery } = require('../lib/rutChileno');
const { normalizeTipoFuncionario } = require('../lib/personalFuncionarioTipo');
const { PERSONAL_DOC_TIPOS } = require('../lib/personalDocTypes');
const { requireAccesoPersonal, requireGestionPersonal } = require('../lib/personalPermisos');
const { registrarAuditoriaPersonal } = require('../lib/personalAuditoria');

function parseDateInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

function publicFuncionario(row, docsResumen) {
  if (!row) return null;
  return {
    ...row,
    rut_formateado: formatearRut(row.rut_normalizado),
    documentos_resumen: docsResumen || null,
  };
}

async function docsResumenForFuncionario(funcionarioId) {
  const activos = await db.query(
    `SELECT tipo_documental, estado, fecha_vencimiento
     FROM personal_documentos
     WHERE funcionario_id = $1 AND es_activo = TRUE`,
    [funcionarioId]
  );
  const presentes = new Set(activos.rows.map((r) => r.tipo_documental));
  const obligatorios = PERSONAL_DOC_TIPOS.map((t) => t.key);
  const faltantes = obligatorios.filter((k) => !presentes.has(k));
  const vencidos = activos.rows.filter((r) => r.estado === 'vencido').length;
  const proximos = activos.rows.filter((r) => r.estado === 'proximo_vencer').length;
  return {
    total_obligatorios: obligatorios.length,
    cargados: presentes.size,
    faltantes,
    vencidos,
    proximos_vencer: proximos,
  };
}

router.get('/dashboard', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const [funcs, docs, resols, imports] = await Promise.all([
      db.query(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE activo = TRUE AND estado_laboral = 'activo')::int AS activos,
        COUNT(*) FILTER (WHERE tipo_funcionario = 'docente')::int AS docentes,
        COUNT(*) FILTER (WHERE tipo_funcionario = 'asistente')::int AS asistentes
       FROM personal_funcionarios`),
      db.query(`SELECT COUNT(*)::int AS total FROM personal_documentos WHERE es_activo = TRUE`),
      db.query(`SELECT COUNT(*)::int AS total FROM personal_resoluciones`),
      db.query(
        `SELECT id, estado, inicio, fin, resumen_json
         FROM personal_importaciones ORDER BY inicio DESC LIMIT 5`
      ),
    ]);
    res.json({
      funcionarios: funcs.rows[0],
      documentos_activos: docs.rows[0]?.total || 0,
      resoluciones: resols.rows[0]?.total || 0,
      importaciones_recientes: imports.rows,
      tipos_documentales: PERSONAL_DOC_TIPOS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/funcionarios', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const q = String(req.query.q || '').trim();
    const tipo = String(req.query.tipo || '').trim();
    const estado = String(req.query.estado || '').trim();

    let sql = `SELECT * FROM personal_funcionarios WHERE 1=1`;
    const params = [];

    if (tipo === 'docente' || tipo === 'asistente') {
      params.push(tipo);
      sql += ` AND tipo_funcionario = $${params.length}`;
    }
    if (estado === 'activo' || estado === 'inactivo') {
      params.push(estado);
      sql += ` AND estado_laboral = $${params.length}`;
    } else if (estado === 'todos') {
      /* sin filtro */
    } else {
      sql += ` AND activo = TRUE`;
    }

    sql += ` ORDER BY nombre_completo ASC LIMIT 500`;
    const result = await db.query(sql, params);
    let rows = result.rows;

    if (q) {
      const qLower = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.nombre_completo.toLowerCase().includes(qLower) ||
          rutMatchesQuery(r.rut_numero, r.rut_normalizado, q)
      );
    }

    res.json(rows.map((r) => publicFuncionario(r)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/funcionarios/:id', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;
    const result = await db.query('SELECT * FROM personal_funcionarios WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Funcionario no encontrado' });
    const docs = await db.query(
      `SELECT * FROM personal_documentos WHERE funcionario_id = $1 ORDER BY tipo_documental, version_num DESC`,
      [req.params.id]
    );
    const resumen = await docsResumenForFuncionario(req.params.id);
    res.json({
      funcionario: publicFuncionario(result.rows[0], resumen),
      documentos: docs.rows,
      tipos_documentales: PERSONAL_DOC_TIPOS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/funcionarios', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const o = req.body || {};
    const rutParts = normalizeRutParts(o.rut);
    if (!rutParts) return res.status(400).json({ error: 'RUT inválido' });

    const tipo = normalizeTipoFuncionario(o.tipo_funcionario) || o.tipo_funcionario;
    if (tipo !== 'docente' && tipo !== 'asistente') {
      return res.status(400).json({ error: 'Tipo de funcionario inválido (docente o asistente)' });
    }

    const nombre = String(o.nombre_completo || o.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Indicá el nombre completo' });

    const dup = await db.query('SELECT id FROM personal_funcionarios WHERE rut_normalizado = $1', [
      rutParts.rut_normalizado,
    ]);
    if (dup.rows.length) return res.status(409).json({ error: 'Ya existe un funcionario con ese RUT' });

    const result = await db.query(
      `INSERT INTO personal_funcionarios
        (rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario, estado_laboral,
         planta, ubicacion, fecha_ingreso, fecha_nacimiento, profesion, tipo_contrato, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING *`,
      [
        rutParts.rut_normalizado,
        rutParts.rut_numero,
        rutParts.rut_dv,
        nombre,
        tipo,
        o.estado_laboral === 'inactivo' ? 'inactivo' : 'activo',
        o.planta || null,
        o.ubicacion || null,
        parseDateInput(o.fecha_ingreso),
        parseDateInput(o.fecha_nacimiento),
        o.profesion || null,
        o.tipo_contrato || null,
        req.user.login,
      ]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'funcionario_crear',
      entidad: 'personal_funcionarios',
      entidad_id: result.rows[0].id,
      funcionario_id: result.rows[0].id,
      detalle_json: { rut: rutParts.rut_normalizado, nombre },
    });

    res.status(201).json(publicFuncionario(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/funcionarios/:id', auth, async (req, res) => {
  try {
    if (!requireGestionPersonal(req, res)) return;
    const prev = await db.query('SELECT * FROM personal_funcionarios WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Funcionario no encontrado' });
    const before = prev.rows[0];
    const o = req.body || {};

    let tipo = before.tipo_funcionario;
    if (o.tipo_funcionario !== undefined) {
      const t = normalizeTipoFuncionario(o.tipo_funcionario) || o.tipo_funcionario;
      if (t !== 'docente' && t !== 'asistente') {
        return res.status(400).json({ error: 'Tipo de funcionario inválido' });
      }
      tipo = t;
    }

    const nombre =
      o.nombre_completo !== undefined ? String(o.nombre_completo || '').trim() : before.nombre_completo;
    if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });

    let estadoLaboral = before.estado_laboral;
    if (o.estado_laboral === 'activo' || o.estado_laboral === 'inactivo') estadoLaboral = o.estado_laboral;

    let activo = before.activo;
    if (typeof o.activo === 'boolean') activo = o.activo;
    if (estadoLaboral === 'inactivo') activo = false;

    const result = await db.query(
      `UPDATE personal_funcionarios SET
        nombre_completo = $1,
        tipo_funcionario = $2,
        estado_laboral = $3,
        planta = COALESCE($4, planta),
        ubicacion = COALESCE($5, ubicacion),
        fecha_ingreso = COALESCE($6, fecha_ingreso),
        fecha_nacimiento = COALESCE($7, fecha_nacimiento),
        profesion = COALESCE($8, profesion),
        tipo_contrato = COALESCE($9, tipo_contrato),
        activo = $10,
        updated_at = NOW(),
        updated_by = $11
       WHERE id = $12 RETURNING *`,
      [
        nombre,
        tipo,
        estadoLaboral,
        o.planta !== undefined ? o.planta || null : null,
        o.ubicacion !== undefined ? o.ubicacion || null : null,
        o.fecha_ingreso !== undefined ? parseDateInput(o.fecha_ingreso) : null,
        o.fecha_nacimiento !== undefined ? parseDateInput(o.fecha_nacimiento) : null,
        o.profesion !== undefined ? o.profesion || null : null,
        o.tipo_contrato !== undefined ? o.tipo_contrato || null : null,
        activo,
        req.user.login,
        req.params.id,
      ]
    );

    await registrarAuditoriaPersonal(req, {
      accion: 'funcionario_editar',
      entidad: 'personal_funcionarios',
      entidad_id: req.params.id,
      funcionario_id: req.params.id,
      detalle_json: { antes: { nombre: before.nombre_completo }, despues: { nombre } },
    });

    res.json(publicFuncionario(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
