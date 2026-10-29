/**
 * Robot LME — interruptor, latido y registro de licencias procesadas.
 *
 * Quién puede usarlo:
 *  - Administrador (rol "Super Admin" o "Administrador"): ve el panel y enciende/apaga el robot.
 *  - Robot (rol "Robot LME"): lee el interruptor, informa su latido y registra cada licencia.
 * Nadie más ve ni toca estas rutas.
 *
 * El robot corre en un PC aparte y CONSULTA a SIGEX (SIGEX nunca llama al robot):
 *  GET  /api/personal/lme/robot/estado      → interruptor + latido + resumen de hoy   (admin y robot)
 *  PUT  /api/personal/lme/robot/control     → cambia modo / horario / intervalo        (solo admin)
 *  POST /api/personal/lme/robot/latido      → "sigo vivo"                               (solo robot)
 *  POST /api/personal/lme/robot/eventos     → registra una licencia procesada           (solo robot)
 *  GET  /api/personal/lme/robot/eventos     → licencias de un día (?fecha=AAAA-MM-DD)  (admin y robot)
 */
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

const ROLES_ADMIN = ['Super Admin', 'Administrador'];
const ROL_ROBOT = 'Robot LME';
const MODOS = ['apagado', 'llenar', 'tramitar'];
const RESULTADOS = ['TRAMITADA', 'LISTA', 'DETENIDO', 'ERROR'];
const TZ = 'America/Santiago';

const rolDe = (req) => String(req.user?.rol || '').trim();
const esAdmin = (req) => ROLES_ADMIN.includes(rolDe(req));
const esRobot = (req) => rolDe(req) === ROL_ROBOT;

function permitir(req, res, { admin = false, robot = false }) {
  if ((admin && esAdmin(req)) || (robot && esRobot(req))) return true;
  res.status(403).json({ error: 'Sin permisos para el Robot LME' });
  return false;
}

const hhmm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : null);
const fechaOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

async function leerEventosDia(fecha) {
  const { rows } = await db.query(
    `SELECT id, creado_en, folio, operador, rut, nombre, tipo, fecha_inicio, fecha_fin, dias, resultado, motivo, detalle
       FROM robot_lme_eventos
      WHERE (creado_en AT TIME ZONE $2)::date = $1::date
      ORDER BY creado_en`,
    [fecha, TZ]
  );
  return rows;
}

router.get('/lme/robot/estado', auth, async (req, res) => {
  try {
    if (!permitir(req, res, { admin: true, robot: true })) return;
    const [{ rows: c }, { rows: l }, { rows: hoy }] = await Promise.all([
      db.query(`SELECT modo, to_char(hora_inicio,'HH24:MI') AS hora_inicio, to_char(hora_fin,'HH24:MI') AS hora_fin,
                       intervalo_min, correo_reporte, actualizado_por, actualizado_en
                  FROM robot_lme_control WHERE id = 1`),
      db.query('SELECT visto_en, estado, mensaje, equipo, version FROM robot_lme_latido WHERE id = 1'),
      db.query(
        `SELECT resultado, COUNT(*)::int AS n FROM robot_lme_eventos
          WHERE (creado_en AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date GROUP BY resultado`,
        [TZ]
      ),
    ]);
    const resumen = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
    hoy.forEach((r) => (resumen[r.resultado] = r.n));
    res.json({
      control: c[0] || { modo: 'apagado' },
      latido: l[0] || null,
      hoy: resumen,
      ahora: new Date().toISOString(),
      soy: esAdmin(req) ? 'admin' : 'robot',
    });
  } catch (e) {
    console.error('robot estado', e);
    res.status(500).json({ error: /robot_lme_/.test(e.message) ? 'Falta ejecutar la migración 030_robot_lme_control.sql' : e.message });
  }
});

router.put('/lme/robot/control', auth, async (req, res) => {
  try {
    if (!permitir(req, res, { admin: true })) return;
    const b = req.body || {};
    const modo = b.modo != null ? String(b.modo) : null;
    if (modo && !MODOS.includes(modo)) return res.status(400).json({ error: 'Modo inválido' });
    const ini = b.hora_inicio != null ? hhmm(b.hora_inicio) : null;
    const fin = b.hora_fin != null ? hhmm(b.hora_fin) : null;
    if ((b.hora_inicio != null && !ini) || (b.hora_fin != null && !fin)) return res.status(400).json({ error: 'Hora inválida (HH:MM)' });
    const intervalo = b.intervalo_min != null ? Number(b.intervalo_min) : null;
    if (intervalo != null && !(intervalo >= 5 && intervalo <= 120)) return res.status(400).json({ error: 'Intervalo entre 5 y 120 minutos' });
    const correo = b.correo_reporte != null ? String(b.correo_reporte).trim() || null : undefined;

    const { rows } = await db.query(
      `UPDATE robot_lme_control SET
          modo = COALESCE($1, modo),
          hora_inicio = COALESCE($2::time, hora_inicio),
          hora_fin = COALESCE($3::time, hora_fin),
          intervalo_min = COALESCE($4, intervalo_min),
          correo_reporte = CASE WHEN $5::boolean THEN $6 ELSE correo_reporte END,
          actualizado_por = $7,
          actualizado_en = NOW()
        WHERE id = 1
        RETURNING modo, to_char(hora_inicio,'HH24:MI') AS hora_inicio, to_char(hora_fin,'HH24:MI') AS hora_fin,
                  intervalo_min, correo_reporte, actualizado_por, actualizado_en`,
      [modo, ini, fin, intervalo, correo !== undefined, correo ?? null, req.user?.login || null]
    );
    res.json({ control: rows[0] });
  } catch (e) {
    console.error('robot control', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/lme/robot/latido', auth, async (req, res) => {
  try {
    if (!permitir(req, res, { robot: true })) return;
    const b = req.body || {};
    await db.query(
      `INSERT INTO robot_lme_latido (id, visto_en, estado, mensaje, equipo, version)
       VALUES (1, NOW(), $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET visto_en = NOW(), estado = $1, mensaje = $2, equipo = $3, version = $4`,
      [String(b.estado || '').slice(0, 40) || null, String(b.mensaje || '').slice(0, 500) || null,
       String(b.equipo || '').slice(0, 80) || null, String(b.version || '').slice(0, 20) || null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/lme/robot/eventos', auth, async (req, res) => {
  try {
    if (!permitir(req, res, { robot: true })) return;
    const b = req.body || {};
    if (!b.folio) return res.status(400).json({ error: 'Falta folio' });
    if (!RESULTADOS.includes(b.resultado)) return res.status(400).json({ error: 'Resultado inválido' });
    const { rows } = await db.query(
      `INSERT INTO robot_lme_eventos (folio, operador, rut, nombre, tipo, fecha_inicio, fecha_fin, dias, resultado, motivo, detalle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, creado_en`,
      [String(b.folio), b.operador != null ? String(b.operador) : null, b.rut || null, b.nombre || null, b.tipo || null,
       fechaOk(b.fecha_inicio), fechaOk(b.fecha_fin), Number.isFinite(Number(b.dias)) ? Number(b.dias) : null,
       b.resultado, b.motivo ? String(b.motivo).slice(0, 1000) : null, b.detalle ? JSON.stringify(b.detalle) : null]
    );
    res.json({ evento: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/lme/robot/eventos', auth, async (req, res) => {
  try {
    if (!permitir(req, res, { admin: true, robot: true })) return;
    const fecha =
      fechaOk(req.query?.fecha) ||
      new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    res.json({ fecha, eventos: await leerEventosDia(fecha) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
