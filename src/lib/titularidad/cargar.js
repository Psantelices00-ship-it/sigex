/**
 * Carga datos SIGEX para evaluación de titularidad (decretos, liquidaciones, maestro).
 */

const db = require('../../db')
const { formatearRut } = require('../rutChileno')
const { clasificarCalidad } = require('./timeline')

function periodoDesdeExtraccion(doc, ficha) {
  const x = doc.extraccion_json && typeof doc.extraccion_json === 'object' ? doc.extraccion_json : null
  if (!x) return null
  const inicio = x.fecha_inicio || x.fecha_decreto || null
  let termino = x.fecha_termino || null
  if (!termino && x.fecha_termino_texto && /indefin|sin t[eé]rmino|vigente/i.test(String(x.fecha_termino_texto))) {
    termino = null // abierto
  }
  if (!inicio && !termino) return null

  const blob = `${doc.tipo_documental || ''} ${doc.nombre_archivo || ''} ${x.tipo_acto || ''}`.toUpperCase()
  let calidad = 'CONTRATA'
  if (doc.tipo_documental === 'regularizacion_titularidad' || /TITULAR|REGULARIZ/.test(blob)) {
    calidad = 'TITULAR'
  } else if (/EXTENSION|EXTENSI/.test(blob)) {
    calidad = 'EXTENSION HRS. C.T.'
  } else if (/REEMPLAZ/.test(blob)) {
    calidad = 'REEMPLAZANTE DOC.'
  }

  // Preferir tipificación del maestro si el acto no es claro
  if (calidad === 'CONTRATA' && ficha?.tipo_contrato) {
    const fc = clasificarCalidad(ficha.tipo_contrato)
    if (fc === 'titular' && /TITULAR|REGULARIZ/.test(blob)) calidad = ficha.tipo_contrato
  }

  return {
    inicio,
    termino,
    calidad,
    horas: x.horas != null && x.horas !== '' ? Number(x.horas) : null,
    establecimiento: x.establecimiento || ficha?.ubicacion || null,
    mismoSostenedor: true,
    fuente: doc.tipo_documental || 'decreto',
    doc_id: doc.id,
    n_decreto: x.n_decreto != null && x.n_decreto !== '' ? String(x.n_decreto) : null,
    fecha_decreto: x.fecha_decreto || null,
  }
}

/**
 * Agrega periodos sintéticos desde maestro (fecha_documento / fecha_fin / tipo_contrato)
 * cuando hay tipificación útil.
 */
function periodosDesdeMaestro(rows, ficha) {
  const out = []
  for (const r of rows || []) {
    if (!r.tipo_contrato) continue
    const inicio = r.fecha_documento || r.fecha_ingreso || null
    const termino = r.fecha_fin || null
    if (!inicio && !termino) continue
    out.push({
      inicio: inicio ? String(inicio).slice(0, 10) : null,
      termino: termino ? String(termino).slice(0, 10) : null,
      calidad: r.tipo_contrato,
      horas: null,
      establecimiento: r.ubicacion || ficha?.ubicacion || null,
      mismoSostenedor: true,
      fuente: 'maestro',
    })
  }
  return out.filter((p) => p.inicio)
}

async function cargarUniversoDocentes() {
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
  return funcs.rows
}

async function cargarDatosFuncionario(f) {
  const [docsR, liqR, maestroR, cargoLiq] = await Promise.all([
    db.query(
      `SELECT id, tipo_documental, nombre_archivo, extraccion_json
       FROM personal_documentos
       WHERE funcionario_id = $1 AND es_activo = TRUE
         AND (
           tipo_documental IN ('resolucion_nombramiento','consolidado_antiguo','contrato','regularizacion_titularidad')
           OR nombre_archivo ~* 'DECRETO|RESOLUC|NOMBRAMIENTO|REGULARIZ'
         )`,
      [f.id]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT p.mes, p.anio, lr.cargo, lr.establecimiento
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE p.estado = 'completo'
         AND (lr.funcionario_id = $1 OR lr.rut_normalizado = $2)`,
      [f.id, f.rut_normalizado]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT mr.tipo_contrato, mr.ubicacion, mr.planta, mr.cargo_especifico,
              mr.fecha_documento::text, mr.fecha_fin::text, mr.fecha_ingreso::text
       FROM personal_maestro_remuneraciones mr
       JOIN personal_maestro_remuneraciones_periodos p ON p.id = mr.periodo_id
       WHERE mr.rut_normalizado = $1 OR mr.funcionario_id = $2
       ORDER BY p.anio DESC, p.mes DESC
       LIMIT 24`,
      [f.rut_normalizado, f.id]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT lr.cargo, COUNT(*)::int n
       FROM personal_liquidaciones_registros lr
       JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
       WHERE p.estado = 'completo'
         AND (lr.funcionario_id = $1 OR lr.rut_normalizado = $2)
         AND NULLIF(TRIM(lr.cargo),'') IS NOT NULL
       GROUP BY lr.cargo
       ORDER BY n DESC
       LIMIT 1`,
      [f.id, f.rut_normalizado]
    ).catch(() => ({ rows: [] })),
  ])

  const ficha = {
    nombre: f.nombre_completo,
    rut: formatearRut(f.rut_normalizado),
    rut_normalizado: f.rut_normalizado,
    tipo_contrato: f.tipo_contrato,
    planta: f.planta,
    ubicacion: f.ubicacion,
    profesion: f.profesion,
  }

  const periodosDocs = docsR.rows
    .map((d) => periodoDesdeExtraccion(d, ficha))
    .filter(Boolean)

  const periodosMaestro = periodosDesdeMaestro(maestroR.rows, ficha)
  const periodos = [...periodosDocs, ...periodosMaestro]

  const liquidacionesYm = [
    ...new Set(
      liqR.rows.map(
        (r) => `${r.anio}-${String(r.mes).padStart(2, '0')}`
      )
    ),
  ]

  const maestroReciente = maestroR.rows[0] || null
  const tipoContrato =
    maestroReciente?.tipo_contrato || f.tipo_contrato || null

  // Horas titulares estimadas: si hay decretos titular con horas; si no, null
  let horasTitularesFicha = null
  for (const p of periodos) {
    if (clasificarCalidad(p.calidad) === 'titular' && Number.isFinite(p.horas)) {
      horasTitularesFicha = (horasTitularesFicha || 0) + p.horas
    }
  }

  // Doble imputación desconocida salvo regularización presente
  const tieneRegularizacion = docsR.rows.some(
    (d) => d.tipo_documental === 'regularizacion_titularidad'
  )

  return {
    nombre: ficha.nombre,
    rut: ficha.rut,
    periodos,
    liquidacionesYm,
    cargo: cargoLiq.rows[0]?.cargo || maestroReciente?.cargo_especifico || f.profesion || null,
    establecimiento: maestroReciente?.ubicacion || f.ubicacion || null,
    tipoContratoFicha: tipoContrato,
    horasTitularesFicha,
    horasYaTitularizadas: tieneRegularizacion ? true : null,
  }
}

module.exports = {
  cargarUniversoDocentes,
  cargarDatosFuncionario,
  periodoDesdeExtraccion,
}
