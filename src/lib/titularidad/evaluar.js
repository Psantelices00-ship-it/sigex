/**
 * Motor de evaluación Titularidad — Ley 21.803 y Ley 21.176.
 * Funciones puras (sin DB).
 */

const { resolveParams21803, resolveParams21176 } = require('./params')
const {
  ventanaHasta,
  clasificarCalidad,
  esDirectivoCargo,
  expandirMeses,
  metricasContinuidad,
  horasVigentesEnCorte,
  parseIso,
} = require('./timeline')

function req(id, label, ok, detalle) {
  return { id, label, ok: !!ok, detalle: detalle || (ok ? 'Cumple' : 'No cumple') }
}

/**
 * @param {object} data
 * @param {object[]} data.periodos
 * @param {string[]} data.liquidacionesYm  e.g. ['2024-03','2024-04']
 * @param {string|null} data.cargo
 * @param {string|null} data.nombre
 * @param {string|null} data.rut
 * @param {boolean} [data.horasYaTitularizadas] si true → REVISAR en 21.176
 */
function evaluar21803(data, modo = 'transitorio', fechaCorte, opts = {}) {
  const params = resolveParams21803(modo, fechaCorte, opts.anioPermanente, opts.paramsOverride)
  const liqSet = new Set(data.liquidacionesYm || [])
  const hayLiq = liqSet.size > 0

  const periodos = (data.periodos || []).filter((p) => {
    const cal = clasificarCalidad(p.calidad)
    if (cal === 'titular') return false // 21.803: universo a contrata
    if (cal === 'reemplazo' && !params.contarReemplazos) return false
    if (cal === 'extension' && !params.contarHorasExtension) return false
    return cal === 'contrata' || cal === 'reemplazo' || cal === 'extension' || cal === 'otro'
  })

  // Si calidad "otro", tratar como contrata si el tipo_contrato ficha lo sugiere
  const periodosNorm = periodos.map((p) => ({
    ...p,
    calidad:
      clasificarCalidad(p.calidad) === 'otro'
        ? p.calidad || 'CONTRATA'
        : p.calidad,
  }))

  const win = ventanaHasta(params.fechaCorte, params.ventanaAnios)
  const mesesMap = expandirMeses(periodosNorm, liqSet, {
    incluirPeriodosSostenedorAnterior: params.incluirPeriodosSostenedorAnterior,
    contarReemplazos: params.contarReemplazos,
    contarHorasExtension: params.contarHorasExtension,
  })

  const met = metricasContinuidad(mesesMap, win.desdeYm, win.hastaYm, {
    criterioMesParcial: 'solo_contrato',
    exigirLiquidacion: false,
  })

  const vigente = horasVigentesEnCorte(periodosNorm, params.fechaCorte, (cal) =>
    ['contrata', 'reemplazo', 'extension', 'otro'].includes(cal)
  )

  const esDirectivo = esDirectivoCargo(data.cargo, params.cargosDirectivos)

  // Decreto vigente a contrata al corte
  const tieneContrataCorte = (periodosNorm || []).some((p) => {
    const ini = parseIso(p.inicio)
    const fin = parseIso(p.termino) || params.fechaCorte
    if (!ini) return false
    if (ini > params.fechaCorte || fin < params.fechaCorte) return false
    const cal = clasificarCalidad(p.calidad)
    return cal === 'contrata' || cal === 'reemplazo' || cal === 'extension' || cal === 'otro'
  })

  const antigüedadOk =
    met.mesesContinuosMax >= params.mesesContinuosMin ||
    met.mesesTotalesVentana >= params.mesesDiscontinuosMin

  const continuidadOk = met.cubreUltimos24Meses
  const horasOk = (vigente.horas || 0) >= params.horasMinimas
  const directivoOk = params.excluirDirectivos ? !esDirectivo : true
  const concursoOk = !params.exigeConcurso

  const requisitos = [
    req('contrata_corte', 'Calidad contrata vigente a la fecha de corte', tieneContrataCorte,
      tieneContrataCorte ? `Vigente al ${params.fechaCorte}` : `Sin decreto a contrata vigente al ${params.fechaCorte}`),
    req('antiguedad', `Antigüedad ≥ ${params.mesesContinuosMin} meses continuos o ${params.mesesDiscontinuosMin} discontinuos en ${params.ventanaAnios} años`,
      antigüedadOk,
      `Continuos máx: ${met.mesesContinuosMax}; totales ventana: ${met.mesesTotalesVentana}`),
    req('continuidad_24', 'Contrataciones sucesivas y continuas en los últimos 24 meses',
      continuidadOk,
      continuidadOk ? 'Cubre últimos 24 meses' : 'Hay interrupción en los últimos 24 meses'),
    req('horas', `Horas mínimas (${params.horasMinimas})`, horasOk,
      `Horas a contrata al corte: ${vigente.horas}`),
    req('directivo', 'No excluido por función directiva', directivoOk,
      esDirectivo ? 'Es directivo (no excluye con params actuales)' : 'No directivo'),
    req('concurso', 'Concurso / proceso transparente', concursoOk,
      params.exigeConcurso ? 'Exigible en este modo' : 'No exigible (parámetro)'),
  ]

  const motivos = []
  let estado = 'CUMPLE'
  for (const r of requisitos) {
    if (!r.ok && r.id !== 'directivo') {
      // directivo detalle informativo si excluirDirectivos=false
      if (r.id === 'directivo' && !params.excluirDirectivos) continue
      motivos.push(r.detalle)
    }
  }
  if (!tieneContrataCorte) motivos.push(`Sin decreto vigente al ${params.fechaCorte}`)
  if (!antigüedadOk) {
    motivos.push(
      `Solo ${met.mesesTotalesVentana} meses a contrata en la ventana (requiere ${params.mesesDiscontinuosMin})` +
        ` / racha ${met.mesesContinuosMax} (requiere ${params.mesesContinuosMin})`
    )
  }
  if (!continuidadOk) motivos.push('Corte en los últimos 24 meses previos a la fecha de corte')

  const mesesContratoSinLiq = met.timeline.filter(
    (t) => t.raw?.conContrato && !t.raw?.conLiquidacion
  ).length
  const decretosSinLiq = (periodosNorm || []).length > 0 && (mesesContratoSinLiq > 0 || !hayLiq)

  if (!tieneContrataCorte || !antigüedadOk || !continuidadOk || !horasOk || (params.excluirDirectivos && esDirectivo) || !concursoOk) {
    estado = 'NO CUMPLE'
  } else if (decretosSinLiq) {
    estado = 'REVISAR'
    motivos.unshift(
      hayLiq
        ? 'Hay meses con decreto/contrato sin liquidación de respaldo'
        : 'Sin liquidaciones cargadas para contrastar meses servidos'
    )
  }

  // dedupe motivos
  const motivosUniq = [...new Set(motivos)]

  return {
    ley: '21803',
    modo: params.modo,
    fechaCorte: params.fechaCorte,
    vigenciaTitularidad: params.vigenciaTitularidad,
    nombre: data.nombre || null,
    rut: data.rut || null,
    estado,
    motivos: estado === 'CUMPLE' ? [] : motivosUniq,
    requisitos,
    metricas: {
      mesesContinuosMax: met.mesesContinuosMax,
      mesesTotalesVentana: met.mesesTotalesVentana,
      cubreUltimos24Meses: met.cubreUltimos24Meses,
      horasVigentesCorte: vigente.horas,
      establecimientos: vigente.establecimientos,
    },
    esDirectivo,
    horas: vigente.horas,
    establecimiento: vigente.establecimientos.join(' / ') || data.establecimiento || null,
    timeline: met.timeline,
    params,
    inconsistenciaLiq: !!decretosSinLiq,
  }
}

function evaluar21176(data, modo = 'inciso2', fechaCorte, opts = {}) {
  const params = resolveParams21176(modo, fechaCorte, opts.paramsOverride)
  const liqSet = new Set(data.liquidacionesYm || [])
  const hayLiq = liqSet.size > 0

  const todos = data.periodos || []
  const titulares = todos.filter((p) => clasificarCalidad(p.calidad) === 'titular')
  const extensiones = todos.filter((p) => {
    const cal = clasificarCalidad(p.calidad)
    return cal === 'extension' || cal === 'contrata' || cal === 'reemplazo'
  })

  const titularCorte = titulares.some((p) => {
    const ini = parseIso(p.inicio)
    const fin = parseIso(p.termino) || params.fechaCorte
    return ini && ini <= params.fechaCorte && fin >= params.fechaCorte
  }) || clasificarCalidad(data.tipoContratoFicha) === 'titular'

  const horasTitulares = horasVigentesEnCorte(titulares, params.fechaCorte, () => true).horas
  // si no hay decretos titular con horas, usar data.horasTitularesFicha
  const horasTit = horasTitulares || Number(data.horasTitularesFicha) || 0

  const extVig = horasVigentesEnCorte(extensiones, params.fechaCorte, () => true)

  const winAnios = Math.ceil(params.mesesDiscontinuosMin / 12) + 2
  const win = ventanaHasta(params.fechaCorte, winAnios)
  const mesesMap = expandirMeses(extensiones, liqSet, {
    incluirPeriodosSostenedorAnterior: params.incluirPeriodosSostenedorAnterior,
    contarReemplazos: true,
    contarHorasExtension: true,
  })
  const met = metricasContinuidad(mesesMap, win.desdeYm, win.hastaYm, {
    criterioMesParcial: 'solo_contrato',
    exigirLiquidacion: false,
  })

  const antigüedadOk =
    met.mesesContinuosMax >= params.mesesContinuosMin ||
    met.mesesTotalesVentana >= params.mesesDiscontinuosMin

  const horasTitOk = horasTit >= (params.horasTitularesMinimas || 0)
  const tieneExtension = (extVig.horas || 0) > 0
  const esDirectivo = esDirectivoCargo(data.cargo, params.cargosDirectivos)
  const dobleImputacion = data.horasYaTitularizadas === true

  const requisitos = [
    req('titular_corte', 'Calidad titular vigente a la fecha de corte', titularCorte),
    req('extension', 'Horas de extensión a contrata vigentes al corte', tieneExtension,
      `Horas extensión al corte: ${extVig.horas}`),
    req('antiguedad_ext', `Antigüedad en extensión ≥ ${params.mesesContinuosMin} cont. o ${params.mesesDiscontinuosMin} disc.`,
      antigüedadOk,
      `Continuos máx: ${met.mesesContinuosMax}; totales: ${met.mesesTotalesVentana}`),
    req('horas_titulares', `Horas titulares mínimas (${params.horasTitularesMinimas})`, horasTitOk,
      `Horas titulares: ${horasTit}`),
    req('doble', 'Sin doble imputación de las mismas horas', !dobleImputacion,
      dobleImputacion ? 'Horas ya titularizadas por otra ley' : 'Sin marca de doble imputación'),
  ]

  const motivos = []
  let estado = 'CUMPLE'
  if (!titularCorte) motivos.push('Sin calidad titular vigente a la fecha de corte')
  if (!tieneExtension) motivos.push('Sin horas de extensión a contrata vigentes al corte')
  if (!antigüedadOk) {
    motivos.push(
      `Antigüedad en extensión insuficiente: ${met.mesesTotalesVentana} meses (req. ${params.mesesDiscontinuosMin} disc. / ${params.mesesContinuosMin} cont.)`
    )
  }
  if (!horasTitOk) {
    motivos.push(`Horas titulares ${horasTit} (se requieren ≥ ${params.horasTitularesMinimas})`)
  }

  if (motivos.length) estado = 'NO CUMPLE'

  if (dobleImputacion) {
    estado = 'REVISAR'
    motivos.unshift('Posible doble imputación: horas ya titularizadas por otra ley')
  } else if (data.horasYaTitularizadas == null && estado === 'CUMPLE') {
    estado = 'REVISAR'
    motivos.unshift('No hay dato de si esas horas ya se titularizaron por otra ley')
  } else if (
    estado === 'CUMPLE' &&
    extensiones.length &&
    (!hayLiq || met.timeline.some((t) => t.raw?.conContrato && !t.raw?.conLiquidacion))
  ) {
    estado = 'REVISAR'
    motivos.unshift('Meses con extensión/decreto sin liquidación de respaldo')
  }

  return {
    ley: '21176',
    modo: params.modo,
    fechaCorte: params.fechaCorte,
    nombre: data.nombre || null,
    rut: data.rut || null,
    estado,
    motivos: [...new Set(motivos)],
    requisitos,
    metricas: {
      mesesContinuosMax: met.mesesContinuosMax,
      mesesTotalesVentana: met.mesesTotalesVentana,
      horasExtensionCorte: extVig.horas,
      horasTitulares: horasTit,
      establecimientos: extVig.establecimientos,
    },
    esDirectivo,
    horas: extVig.horas,
    establecimiento: extVig.establecimientos.join(' / ') || data.establecimiento || null,
    timeline: met.timeline,
    params,
  }
}

/**
 * @param {'21803'|'21176'} ley
 * @param {string} modo
 * @param {string|null} fechaCorte
 * @param {object} data
 * @param {object} [opts]
 */
function evaluarTitularidad(ley, modo, fechaCorte, data, opts = {}) {
  if (String(ley) === '21176' || String(ley) === '21.176') {
    return evaluar21176(data, modo || 'inciso2', fechaCorte, opts)
  }
  return evaluar21803(data, modo || 'transitorio', fechaCorte, opts)
}

module.exports = {
  evaluarTitularidad,
  evaluar21803,
  evaluar21176,
}
