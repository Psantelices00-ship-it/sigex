/**
 * Carga en lote datos para evaluar el universo docente (evita N+1).
 */

const db = require('../../db')
const { formatearRut } = require('../rutChileno')
const { clasificarCalidad, parseIso } = require('./timeline')
const { periodoDesdeExtraccion } = require('./cargar')

async function cargarLoteEvaluacion() {
  const funcs = await db.query(
    `SELECT id, rut_normalizado, nombre_completo, tipo_contrato, planta, ubicacion, profesion
     FROM personal_funcionarios
     WHERE activo IS DISTINCT FROM FALSE
       AND (
         planta ILIKE '%DOCENTE%'
         OR profesion ILIKE '%PROFESOR%'
         OR profesion ILIKE '%DOCENTE%'
         OR profesion ILIKE '%EDUCADOR%'
         OR profesion ILIKE '%DIRECTOR%'
         OR profesion ILIKE '%UTP%'
         OR profesion ILIKE '%INSPECTOR%'
       )
       AND COALESCE(planta, '') NOT ILIKE '%ASISTENTE%'
       AND COALESCE(planta, '') NOT ILIKE '%PARADOCENTE%'
       AND COALESCE(planta, '') NOT ILIKE '%AUXILIAR%'
     ORDER BY nombre_completo`
  )

  const ids = funcs.rows.map((f) => f.id)
  const ruts = funcs.rows.map((f) => f.rut_normalizado)

  if (!ids.length) return []

  const [docsR, liqR, maestroR] = await Promise.all([
    db.query(
      `SELECT funcionario_id, id, tipo_documental, nombre_archivo, extraccion_json
       FROM personal_documentos
       WHERE funcionario_id = ANY($1::uuid[])
         AND es_activo = TRUE
         AND extraccion_json IS NOT NULL`,
      [ids]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT COALESCE(lr.funcionario_id::text, '') AS funcionario_id,
              lr.rut_normalizado, p.mes, p.anio, lr.cargo
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE p.estado = 'completo'
         AND (lr.funcionario_id = ANY($1::uuid[]) OR lr.rut_normalizado = ANY($2::text[]))`,
      [ids, ruts]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT DISTINCT ON (COALESCE(mr.funcionario_id::text, mr.rut_normalizado))
              mr.funcionario_id, mr.rut_normalizado, mr.tipo_contrato, mr.ubicacion,
              mr.planta, mr.cargo_especifico,
              mr.fecha_documento::text, mr.fecha_fin::text, mr.fecha_ingreso::text
       FROM personal_maestro_remuneraciones mr
       JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
       WHERE mr.funcionario_id = ANY($1::uuid[]) OR mr.rut_normalizado = ANY($2::text[])
       ORDER BY COALESCE(mr.funcionario_id::text, mr.rut_normalizado), p.anio DESC, p.mes DESC`,
      [ids, ruts]
    ).catch(() => ({ rows: [] })),
  ])

  const docsBy = new Map()
  for (const d of docsR.rows) {
    const k = String(d.funcionario_id)
    if (!docsBy.has(k)) docsBy.set(k, [])
    docsBy.get(k).push(d)
  }

  const liqByFunc = new Map()
  const liqByRut = new Map()
  const cargoByFunc = new Map()
  const cargoByRut = new Map()
  for (const r of liqR.rows) {
    const ym = `${r.anio}-${String(r.mes).padStart(2, '0')}`
    if (r.funcionario_id) {
      if (!liqByFunc.has(r.funcionario_id)) liqByFunc.set(r.funcionario_id, new Set())
      liqByFunc.get(r.funcionario_id).add(ym)
      if (r.cargo) {
        const c = cargoByFunc.get(r.funcionario_id) || new Map()
        c.set(r.cargo, (c.get(r.cargo) || 0) + 1)
        cargoByFunc.set(r.funcionario_id, c)
      }
    }
    if (r.rut_normalizado) {
      if (!liqByRut.has(r.rut_normalizado)) liqByRut.set(r.rut_normalizado, new Set())
      liqByRut.get(r.rut_normalizado).add(ym)
      if (r.cargo) {
        const c = cargoByRut.get(r.rut_normalizado) || new Map()
        c.set(r.cargo, (c.get(r.cargo) || 0) + 1)
        cargoByRut.set(r.rut_normalizado, c)
      }
    }
  }

  const maestroByFunc = new Map()
  const maestroByRut = new Map()
  for (const m of maestroR.rows) {
    if (m.funcionario_id) maestroByFunc.set(String(m.funcionario_id), m)
    if (m.rut_normalizado) maestroByRut.set(m.rut_normalizado, m)
  }

  function topCargo(map) {
    if (!map || !map.size) return null
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  return funcs.rows.map((f) => {
    const ficha = {
      nombre: f.nombre_completo,
      rut: formatearRut(f.rut_normalizado),
      ubicacion: f.ubicacion,
      tipo_contrato: f.tipo_contrato,
    }
    const docs = docsBy.get(String(f.id)) || []
    const periodosDocs = docs.map((d) => periodoDesdeExtraccion(d, ficha)).filter(Boolean)
    const maestro = maestroByFunc.get(String(f.id)) || maestroByRut.get(f.rut_normalizado) || null
    const periodosMaestro = []
    if (maestro && (maestro.fecha_documento || maestro.fecha_ingreso)) {
      const inicioM = parseIso(maestro.fecha_documento || maestro.fecha_ingreso)
      const terminoM = parseIso(maestro.fecha_fin)
      if (inicioM) {
        periodosMaestro.push({
          inicio: inicioM,
          termino: terminoM,
          calidad: maestro.tipo_contrato || 'CONTRATA',
          horas: null,
          establecimiento: maestro.ubicacion || f.ubicacion,
          mismoSostenedor: true,
          fuente: 'maestro',
        })
      }
    }
    const periodos = [...periodosDocs, ...periodosMaestro]
    const liqSet = new Set([
      ...(liqByFunc.get(String(f.id)) || []),
      ...(liqByRut.get(f.rut_normalizado) || []),
    ])
    let horasTitularesFicha = null
    for (const p of periodos) {
      if (clasificarCalidad(p.calidad) === 'titular' && Number.isFinite(p.horas)) {
        horasTitularesFicha = (horasTitularesFicha || 0) + p.horas
      }
    }
    const tieneRegularizacion = docs.some((d) => d.tipo_documental === 'regularizacion_titularidad')
    return {
      nombre: ficha.nombre,
      rut: ficha.rut,
      periodos,
      liquidacionesYm: [...liqSet],
      cargo:
        topCargo(cargoByFunc.get(String(f.id))) ||
        topCargo(cargoByRut.get(f.rut_normalizado)) ||
        maestro?.cargo_especifico ||
        f.profesion ||
        null,
      establecimiento: maestro?.ubicacion || f.ubicacion || null,
      tipoContratoFicha: maestro?.tipo_contrato || f.tipo_contrato || null,
      horasTitularesFicha,
      horasYaTitularizadas: tieneRegularizacion ? true : null,
      _planta: f.planta,
    }
  })
}

module.exports = { cargarLoteEvaluacion }
