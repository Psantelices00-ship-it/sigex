/**
 * Paquete LME (Portal FONASA / PIEE) — SOLO LECTURA.
 *
 * GET /api/personal/lme/datos?rut=16.035.886-6&fecha_inicio=2026-10-23
 *
 * Devuelve los datos crudos que necesita la ficha LME de un funcionario:
 *  - funcionario
 *  - maestro de remuneraciones de los 3 meses anteriores al inicio de la licencia
 *    (+ el último maestro disponible, para los pasos 1 y 2)
 *  - liquidaciones PDF de esos 3 meses
 *  - historial de licencias del funcionario y estado de la última carga del historial
 *
 * Los catálogos, reglas y el armado de los 4 pasos del portal se hacen en la maqueta
 * (sigex-frontend/lib/lmeMaqueta/fichaReal.js). Esta ruta no escribe nada.
 */
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno');
const { requireAccesoPersonal } = require('../lib/personalPermisos');
const { etiquetaPeriodo } = require('../lib/personalLiquidacionParse');

function fechaIso(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** Los 3 meses calendario anteriores al mes de inicio (orden cronológico). */
function mesesAnteriores(fechaInicio, n = 3) {
  const [y, m] = fechaInicio.split('-').map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ mes: d.getUTCMonth() + 1, anio: d.getUTCFullYear() });
  }
  return out;
}

/**
 * Licencias maternales (tipo 3, 4 y 7): además se informan los 3 meses anteriores al 7° mes previo
 * al inicio (instructivo FONASA: inicio octubre → diciembre, enero y febrero).
 */
function mesesMaternidad(fechaInicio) {
  const [y, m] = fechaInicio.split('-').map(Number);
  const out = [];
  for (const i of [10, 9, 8]) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ mes: d.getUTCMonth() + 1, anio: d.getUTCFullYear() });
  }
  return out;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function filaMaestro(r) {
  if (!r) return null;
  return {
    mes: r.mes,
    anio: r.anio,
    etiqueta: etiquetaPeriodo(r.mes, r.anio),
    nombre_archivo: r.nombre_archivo || null,
    fondo: r.fondo,
    salud: r.salud,
    tipo_contrato: r.tipo_contrato,
    seg_cesantia_emp: num(r.seg_cesantia_emp),
    sueldos: num(r.sueldos),
    imposiciones: num(r.imposiciones),
    nombre: r.nombre || null,
    planta: r.planta || null,
    cargo_especifico: r.cargo_especifico || null,
    ubicacion: r.ubicacion || null,
    fecha_ingreso: r.fecha_ingreso || null,
    fecha_documento: r.fecha_documento || null,
    fecha_fin: r.fecha_fin || null,
    jubilado: r.jubilado,
    cotiza_desahucio: r.cotiza_desahucio,
    dias_trabajados: r.dias_trabajados,
    monto_imponible: num(r.monto_imponible),
    monto_imp_desahucio: num(r.monto_imp_desahucio),
    total_haberes: num(r.total_haberes),
    haberes: r.haberes || null,
    maestro_completo: r.monto_imponible != null || r.haberes != null,
  };
}

const SELECT_MAESTRO = `
  SELECT mr.*, p.mes, p.anio, p.nombre_archivo,
         to_char(mr.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
         -- migración 029 (si no está aplicada, quedan en null sin error)
         to_jsonb(mr) ->> 'fecha_documento' AS fecha_documento,
         to_jsonb(mr) ->> 'fecha_fin' AS fecha_fin
  FROM personal_maestro_remuneraciones mr
  JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id`;

router.get('/lme/datos', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return;

    const parts = normalizeRutParts(String(req.query?.rut || ''));
    if (!parts) return res.status(400).json({ error: 'RUT inválido' });
    const rut = parts.rut_normalizado;

    const fechaInicio = fechaIso(req.query?.fecha_inicio) || new Date().toISOString().slice(0, 10);
    const [yI, mI] = fechaInicio.split('-').map(Number);
    const keyInicio = yI * 100 + mI;
    const meses = mesesAnteriores(fechaInicio, 3);
    const mesesMat = mesesMaternidad(fechaInicio);
    const todosKeys = [...meses, ...mesesMat].map((x) => x.anio * 100 + x.mes);

    const fr = await db.query(
      `SELECT id, rut_normalizado, nombre_completo, tipo_funcionario, estado_laboral,
              planta, ubicacion, tipo_contrato, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
       FROM personal_funcionarios WHERE rut_normalizado = $1`,
      [rut]
    );
    const func = fr.rows[0] || null;

    // Maestro de los 3 meses requeridos
    const mr = await db.query(
      `${SELECT_MAESTRO}
       WHERE mr.rut_normalizado = $1 AND (p.anio * 100 + p.mes) = ANY($2::int[])
       ORDER BY p.anio, p.mes`,
      [rut, todosKeys]
    );
    const porKey = new Map(mr.rows.map((r) => [r.anio * 100 + r.mes, r]));

    // Último maestro disponible antes del mes de inicio (pasos 1 y 2)
    const ult = await db.query(
      `${SELECT_MAESTRO}
       WHERE mr.rut_normalizado = $1 AND (p.anio * 100 + p.mes) < $2
       ORDER BY p.anio DESC, p.mes DESC LIMIT 1`,
      [rut, keyInicio]
    );

    // ¿Qué meses de maestro están cargados (para distinguir "no cargado" de "funcionario no aparece")?
    const per = await db.query(
      `SELECT mes, anio FROM personal_maestro_remuneraciones_periodos
       WHERE (anio * 100 + mes) = ANY($1::int[])`,
      [todosKeys]
    );
    const cargados = new Set(per.rows.map((r) => r.anio * 100 + r.mes));

    // Liquidaciones PDF de los 3 meses
    const lq = await db.query(
      `SELECT lr.id, lr.monto_imponible, lr.cargo, lr.establecimiento, p.mes, p.anio, p.estado
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE lr.rut_normalizado = $1 AND (p.anio * 100 + p.mes) = ANY($2::int[])
       ORDER BY p.anio, p.mes`,
      [rut, todosKeys]
    );
    const liqPorKey = new Map(lq.rows.map((r) => [r.anio * 100 + r.mes, r]));

    // Historial de licencias del funcionario
    const lic = func
      ? await db.query(
          `SELECT numero_licencia, to_char(fecha_tramitacion, 'YYYY-MM-DD') AS tramitacion,
                  to_char(fecha_inicio, 'YYYY-MM-DD') AS desde,
                  to_char(fecha_termino, 'YYYY-MM-DD') AS hasta, dias
           FROM personal_licencias WHERE funcionario_id = $1
           ORDER BY fecha_inicio DESC`,
          [func.id]
        )
      : { rows: [] };

    // Estado del historial (cobertura y última carga)
    const hs = await db.query(
      `SELECT to_char(MAX(fecha_termino), 'YYYY-MM-DD') AS actualizado_hasta FROM personal_licencias`
    );
    let ultimaCarga = null;
    try {
      const a = await db.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS fecha FROM personal_auditoria
         WHERE accion = 'licencias_historial_importar' ORDER BY created_at DESC LIMIT 1`
      );
      ultimaCarga = a.rows[0]?.fecha || null;
    } catch {
      /* auditoría opcional */
    }

    const filaMes = ({ mes, anio }) => {
      const key = anio * 100 + mes;
      const liq = liqPorKey.get(key);
      return {
        mes,
        anio,
        etiqueta: etiquetaPeriodo(mes, anio),
        maestro_cargado: cargados.has(key),
        maestro: filaMaestro(porKey.get(key) ? { ...porKey.get(key), mes, anio } : null),
        liquidacion: liq
          ? {
              registro_id: liq.id,
              monto_imponible: num(liq.monto_imponible),
              estado_periodo: liq.estado,
              url_pdf: `/api/personal/liquidaciones/registros/${liq.id}/archivo`,
            }
          : null,
      };
    };

    res.json({
      rut: formatearRut(rut),
      rut_normalizado: rut,
      fecha_inicio: fechaInicio,
      funcionario: func
        ? {
            nombre_completo: func.nombre_completo,
            tipo_funcionario: func.tipo_funcionario,
            estado_laboral: func.estado_laboral,
            planta: func.planta,
            ubicacion: func.ubicacion,
            tipo_contrato: func.tipo_contrato,
            fecha_ingreso: func.fecha_ingreso,
          }
        : null,
      maestro_ultimo: filaMaestro(ult.rows[0]),
      meses: meses.map(filaMes),
      meses_maternidad: mesesMat.map(filaMes),
      licencias: lic.rows.map((l) => ({ ...l, total_dias: l.dias })),
      historial: { actualizado_hasta: hs.rows[0]?.actualizado_hasta || null, ultima_carga: ultimaCarga },
    });
  } catch (err) {
    console.error('[lme/datos]', err);
    res.status(500).json({ error: err.message || 'Error al armar datos LME' });
  }
});

module.exports = router;
