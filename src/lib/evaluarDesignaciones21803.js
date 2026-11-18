/**
 * Evaluador de titularidad docente — régimen excepcional art. 41 transitorio / art. 28 bis
 * (Ley N° 21.803 · instructivo CGR IN19N26), portado del libro
 * «Evaluador Titularidad Ley 21803.xlsx».
 *
 * Solo aplica a docentes. Reemplazo (contrata) sí es computable.
 */

const PARAMETROS_21803 = {
  fecha_corte: '2025-07-31',
  vigencia_titularidad: '2026-03-01',
  inicio_ventana_6: '2019-08-01',
  inicio_ultimos_2: '2023-08-01',
  tolerancia_interrupcion_dias: 7,
  dias_minimos_4_anios: 1461,
}

const FUNCIONES_COMPUTABLES = new Set([
  'Docencia de aula',
  'Técnico-pedagógica (incl. UTP / DAEM)',
  'Ayudantía, reforzamiento o apoyo de aula',
  'Directiva art. 34 C (subdirector, insp. general, jefe UTP)',
])

const CALIDADES_COMPUTABLES = new Set(['Contrata', 'Reemplazo (contrata)'])

function parseIso(d) {
  if (!d) return null
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  const s = String(d).trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = String(d).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function toDate(iso) {
  const s = parseIso(iso)
  if (!s) return null
  const dt = new Date(`${s}T12:00:00`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function daysBetweenInclusive(aIso, bIso) {
  const a = toDate(aIso)
  const b = toDate(bIso)
  if (!a || !b || b < a) return 0
  return Math.round((b - a) / 86400000) + 1
}

function addDays(iso, n) {
  const d = toDate(iso)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function maxIso(a, b) {
  if (!a) return b || null
  if (!b) return a
  return a >= b ? a : b
}

function minIso(a, b) {
  if (!a) return b || null
  if (!b) return a
  return a <= b ? a : b
}

/**
 * Infere calidad/función desde un decreto SIGEX.
 */
function decretoADesignacion(decreto, ficha = {}) {
  const blob = `${decreto?.tipo || ''} ${decreto?.fuente || ''} ${decreto?.nombre_archivo || ''} ${
    decreto?.tipo_documental || ''
  }`.toUpperCase()

  let calidad = 'Contrata'
  if (/HONORARIO/.test(blob)) calidad = 'Honorarios'
  else if (/REEMPLAZ/.test(blob)) calidad = 'Reemplazo (contrata)'
  else if (/TITULAR/.test(blob) && !/CONTRATA|EXTENSI/.test(blob)) calidad = 'Contrata'

  let funcion = 'Docencia de aula'
  if (/UTP|TECNICO.?PEDAG|TÉCNICO.?PEDAG|JEFE TECN/.test(blob)) {
    funcion = 'Técnico-pedagógica (incl. UTP / DAEM)'
  } else if (/INSPECTOR GENERAL|SUBDIRECTOR|JEFE U/.test(blob)) {
    funcion = 'Directiva art. 34 C (subdirector, insp. general, jefe UTP)'
  } else if (/DIRECTOR|DIRECTIV/.test(blob) && !/INSPECTOR GENERAL|SUBDIRECTOR|JEFE U/.test(blob)) {
    funcion = 'Otra función directiva'
  }

  const termino =
    parseIso(decreto?.fecha_termino) ||
    (decreto?.fecha_termino_texto && /indefin|sin t[eé]rmino|vigente/i.test(String(decreto.fecha_termino_texto))
      ? PARAMETROS_21803.fecha_corte
      : null)

  return {
    rut: ficha.rut || ficha.rut_normalizado || null,
    nombre: ficha.nombre || null,
    establecimiento: decreto?.establecimiento || ficha.establecimiento || null,
    fecha_inicio: parseIso(decreto?.fecha_inicio) || parseIso(decreto?.fecha_decreto),
    fecha_termino: termino,
    horas: decreto?.horas != null ? Number(decreto.horas) : null,
    calidad,
    funcion,
    mismo_sostenedor: ficha?.flags?.mismo_sostenedor === false ? 'No' : 'Sí',
    ya_usada: 'No',
    profesional_educacion: 'Sí',
    caso_especial: 'Ninguno',
    observaciones: decreto?.n_decreto ? `Decreto/Res. ${decreto.n_decreto}` : decreto?.fuente || null,
    doc_id: decreto?.doc_id || null,
    fuente: 'sigex_decreto',
  }
}

function normalizarDesignacion(raw) {
  const calidad = String(raw.calidad || raw.calidad_aplicada || '').trim() || 'Contrata'
  const funcion = String(raw.funcion || raw.funcion_aplicada || '').trim() || 'Docencia de aula'
  const mismo = String(raw.mismo_sostenedor || '').trim() || 'Sí'
  const yaUsada = String(raw.ya_usada || '').trim() || 'No'
  const profesional = String(raw.profesional_educacion || raw.profesional || '').trim() || 'Sí'
  const inicio = parseIso(raw.fecha_inicio)
  const termino = parseIso(raw.fecha_termino)
  return {
    ...raw,
    calidad_aplicada: calidad,
    funcion_aplicada: funcion,
    mismo_sostenedor: mismo,
    ya_usada: yaUsada,
    profesional_educacion: profesional,
    fecha_inicio: inicio,
    fecha_termino: termino,
    horas: raw.horas != null && raw.horas !== '' ? Number(raw.horas) : null,
    caso_especial: String(raw.caso_especial || 'Ninguno').trim() || 'Ninguno',
  }
}

function esComputable(d) {
  if (!d.fecha_inicio || !d.fecha_termino) return false
  if (d.fecha_termino < d.fecha_inicio) return false
  if (!CALIDADES_COMPUTABLES.has(d.calidad_aplicada)) return false
  if (!FUNCIONES_COMPUTABLES.has(d.funcion_aplicada)) return false
  if (d.mismo_sostenedor !== 'Sí') return false
  if (d.ya_usada === 'Sí') return false
  return true
}

/**
 * @param {object[]} designacionesRaw
 * @param {object} [params]
 */
function enriquecerDesignaciones(designacionesRaw, params = PARAMETROS_21803) {
  const corte = params.fecha_corte || PARAMETROS_21803.fecha_corte
  const ventana6 = params.inicio_ventana_6 || PARAMETROS_21803.inicio_ventana_6
  const tolerancia = Number(params.tolerancia_interrupcion_dias ?? PARAMETROS_21803.tolerancia_interrupcion_dias)

  const rows = (designacionesRaw || []).map((r, idx) => {
    const d = normalizarDesignacion(r)
    return {
      ...d,
      _idx: idx,
      computable: esComputable(d) ? 1 : 0,
    }
  })

  for (const d of rows) {
    if (!d.computable) {
      d.termino_max_anteriores = null
      d.dias_computables = 0
      d.fin_con_interrupcion = null
      continue
    }
    const anteriores = rows.filter(
      (o) =>
        o.computable &&
        o !== d &&
        o.fecha_inicio &&
        (o.fecha_inicio < d.fecha_inicio ||
          (o.fecha_inicio === d.fecha_inicio && o._idx < d._idx))
    )
    const terminoMax = anteriores.reduce((acc, o) => maxIso(acc, o.fecha_termino), null)
    d.termino_max_anteriores = terminoMax

    // Excel: IF(AND(Q6>0, D6-Q6-1<=tol), Q6+1, D6)
    let inicioEfectivo = d.fecha_inicio
    if (terminoMax && d.fecha_inicio > terminoMax) {
      const hueco = daysBetweenInclusive(addDays(terminoMax, 1), addDays(d.fecha_inicio, -1))
      if (hueco <= tolerancia) inicioEfectivo = addDays(terminoMax, 1)
    }

    const desde = maxIso(inicioEfectivo, ventana6)
    const hasta = minIso(d.fecha_termino, corte)
    d.dias_computables = desde && hasta ? Math.max(0, daysBetweenInclusive(desde, hasta)) : 0

    // Fin con interrupción: termina antes del corte y no hay siguiente que arranque <= fin+tol+1 y pase del fin
    if (d.fecha_termino < corte) {
      const limite = addDays(d.fecha_termino, tolerancia + 1)
      const haySiguiente = rows.some(
        (o) =>
          o.computable &&
          o !== d &&
          o.fecha_inicio &&
          o.fecha_inicio <= limite &&
          o.fecha_termino > d.fecha_termino
      )
      d.fin_con_interrupcion = haySiguiente ? null : d.fecha_termino
    } else {
      d.fin_con_interrupcion = null
    }
  }

  return rows
}

function esDocenteFicha(ficha) {
  const planta = String(ficha?.planta || '').toUpperCase()
  const tipo = String(ficha?.contrato_vigente?.tipo || ficha?.tipo_contrato || '').toUpperCase()
  const prof = String(ficha?.profesion || '').toUpperCase()
  const rol = `${planta} ${tipo} ${prof}`
  if (/ASISTENTE|PARADOCENTE|AUXILIAR|ADMINISTRAT|SECRETARIA|VIGILANTE/.test(planta) && !/DOCENTE/.test(planta)) {
    return false
  }
  return /DOCENTE|PROFESOR|EDUCADOR|PARVULO|UTP|DIRECTOR/.test(rol) || planta.includes('DOCENTE')
}

/**
 * Evalúa un docente a partir de sus designaciones (decretos).
 * @param {object} opts
 * @param {object[]} opts.designaciones
 * @param {object} [opts.ficha]
 * @param {object} [opts.params]
 */
function evaluarTitularidadPorDesignaciones({ designaciones = [], ficha = {}, params = PARAMETROS_21803 } = {}) {
  const p = { ...PARAMETROS_21803, ...params }
  const docente = esDocenteFicha(ficha)
  const enriquecidas = enriquecerDesignaciones(designaciones, p)
  const computables = enriquecidas.filter((d) => d.computable === 1)

  const profesionalOk =
    enriquecidas.length === 0
      ? true
      : !enriquecidas.some((d) => String(d.profesional_educacion).toLowerCase() === 'no')

  const casoEspecial =
    enriquecidas.find((d) => d.caso_especial && d.caso_especial !== 'Ninguno')?.caso_especial || 'Ninguno'

  if (!docente) {
    return {
      ley: '21.803',
      motor: 'designaciones_excel',
      resultado: 'NO CUMPLE',
      via: 'no_docente',
      motivo: 'La titularidad del art. 28 bis / 41 transitorio aplica solo a profesionales de la educación (docentes).',
      solo_docentes: true,
      es_docente: false,
      items: [
        {
          id: 'docente',
          label: 'Calidad docente (profesional de la educación)',
          estado: 'incumplido',
          detalle: 'El funcionario no figura como docente en la ficha.',
        },
      ],
      horas_a_titularizar: null,
      designaciones_computables: 0,
      designaciones_total: enriquecidas.length,
      parametros: p,
    }
  }

  if (computables.length === 0) {
    return {
      ley: '21.803',
      motor: 'designaciones_excel',
      resultado: 'SIN DESIGNACIÓN COMPUTABLE',
      via: 'sin_designacion',
      motivo:
        'Ninguna designación registrada es computable (calidad, función, sostenedor, uso previo o fechas). Completá decretos con inicio/término/horas o cargá el Excel de designaciones.',
      solo_docentes: true,
      es_docente: true,
      items: [
        {
          id: 'r0',
          label: 'R0 Profesional de la educación',
          estado: profesionalOk ? 'acreditado' : 'incumplido',
          detalle: profesionalOk ? 'Sí' : 'No',
        },
        {
          id: 'designaciones',
          label: 'Designaciones computables',
          estado: 'no_acreditado',
          detalle: `${enriquecidas.length} registradas · 0 computables`,
        },
      ],
      horas_a_titularizar: null,
      designaciones_computables: 0,
      designaciones_total: enriquecidas.length,
      designaciones: enriquecidas,
      parametros: p,
    }
  }

  const r0 = profesionalOk
  const r1 = computables.some(
    (d) => d.fecha_inicio <= p.fecha_corte && d.fecha_termino >= p.fecha_corte
  )

  const maxInterrupcion = computables.reduce((acc, d) => maxIso(acc, d.fin_con_interrupcion), null)
  const candidatosCadena = computables.filter(
    (d) => !maxInterrupcion || d.fecha_inicio > maxInterrupcion
  )
  const inicioCadena = candidatosCadena.reduce(
    (acc, d) => (acc == null || d.fecha_inicio < acc ? d.fecha_inicio : acc),
    null
  )

  const continuidad2 =
    r1 && inicioCadena && inicioCadena <= p.inicio_ultimos_2

  const dias6 = computables.reduce((acc, d) => acc + (d.dias_computables || 0), 0)
  const r3 = continuidad2 && dias6 >= p.dias_minimos_4_anios

  const horasAlCorte = computables
    .filter((d) => d.fecha_inicio <= p.fecha_corte && d.fecha_termino >= p.fecha_corte)
    .reduce((acc, d) => acc + (Number.isFinite(d.horas) ? d.horas : 0), 0)

  let resultado = 'NO CUMPLE'
  if (r0 && r1 && r3) {
    resultado = casoEspecial !== 'Ninguno' ? 'CUMPLE – REVISAR CASO ESPECIAL' : 'CUMPLE'
  }

  const motivos = []
  if (!r0) motivos.push('No acredita la calidad de profesional de la educación (art. 2° Ley 19.070).')
  if (!r1) motivos.push('Sin designación computable vigente al 31-07-2025 (art. 28 bis N° 1).')
  if (r1 && !continuidad2) {
    motivos.push(
      `Sin contrataciones sucesivas y continuas desde el 01-08-2023; la cadena vigente se inicia el ${inicioCadena || '—'}.`
    )
  }
  if (continuidad2 && dias6 < p.dias_minimos_4_anios) {
    motivos.push(
      `Antigüedad insuficiente: ${dias6} de ${p.dias_minimos_4_anios} días computables en los últimos 6 años.`
    )
  }
  if (resultado.startsWith('CUMPLE')) {
    motivos.unshift(
      `Cumple el art. 28 bis N° 1 y N° 3 al 31-07-2025, sin exigencia del N° 2 (art. 41 transitorio). Dictar resolución del sostenedor por ${horasAlCorte || '—'} horas, con efecto desde el 01-03-2026.`
    )
  }
  if (casoEspecial !== 'Ninguno') motivos.push(`Caso especial: ${casoEspecial}.`)

  const items = [
    {
      id: 'r0',
      label: 'R0 Profesional de la educación',
      estado: r0 ? 'acreditado' : 'incumplido',
      detalle: r0 ? 'Cumple' : 'No cumple',
    },
    {
      id: 'r1',
      label: 'R1 Contratado al 31-07-2025',
      estado: r1 ? 'acreditado' : 'incumplido',
      detalle: r1 ? 'Cumple (designación computable vigente al corte)' : 'No cumple',
    },
    {
      id: 'cadena',
      label: 'Inicio de la cadena continua vigente al corte',
      estado: inicioCadena ? 'acreditado' : 'no_acreditado',
      detalle: inicioCadena || '—',
    },
    {
      id: 'continuidad_2',
      label: 'Continuidad desde el 01-08-2023',
      estado: continuidad2 ? 'acreditado' : 'incumplido',
      detalle: continuidad2 ? 'Cumple' : `No cumple (inicio cadena: ${inicioCadena || '—'})`,
    },
    {
      id: 'dias_6',
      label: 'Días computables en los últimos 6 años',
      estado: dias6 >= p.dias_minimos_4_anios ? 'acreditado' : 'no_acreditado',
      detalle: `${dias6} días · ${(dias6 / 365.25).toFixed(2)} años (mín. ${p.dias_minimos_4_anios})`,
    },
    {
      id: 'r3',
      label: 'R3 Antigüedad (4 años)',
      estado: r3 ? 'acreditado' : 'incumplido',
      detalle: r3 ? 'Cumple' : 'No cumple',
    },
    {
      id: 'horas',
      label: 'Horas contratadas al 31-07-2025 (a titularizar)',
      estado: horasAlCorte > 0 ? 'acreditado' : 'pendiente',
      detalle: horasAlCorte > 0 ? `${horasAlCorte} h` : 'Sin horas en designaciones vigentes al corte',
    },
    {
      id: 'concurso',
      label: 'R2 Concurso / proceso transparente',
      estado: 'no_exigible',
      detalle: 'No se exige en régimen excepcional (art. 41 transitorio).',
    },
  ]

  return {
    ley: '21.803',
    motor: 'designaciones_excel',
    resultado,
    via: resultado.startsWith('CUMPLE')
      ? continuidad2 && dias6 >= p.dias_minimos_4_anios
        ? 'designaciones art. 28 bis / 41 transitorio'
        : null
      : 'requisitos',
    motivo: motivos.join(' '),
    solo_docentes: true,
    es_docente: true,
    r0: r0 ? 'Cumple' : 'No cumple',
    r1: r1 ? 'Cumple' : 'No cumple',
    r3: r3 ? 'Cumple' : 'No cumple',
    inicio_cadena: inicioCadena,
    continuidad_2: continuidad2,
    dias_computables_6: dias6,
    equivalente_anios: Number((dias6 / 365.25).toFixed(4)),
    horas_a_titularizar: horasAlCorte || null,
    horas_a_reconocer: horasAlCorte || null,
    vigencia_titularidad: resultado.startsWith('CUMPLE') ? p.vigencia_titularidad : null,
    caso_especial: casoEspecial,
    designaciones_computables: computables.length,
    designaciones_total: enriquecidas.length,
    designaciones: enriquecidas,
    items,
    parametros: p,
    comentario_equipo: {
      tipo: resultado.startsWith('CUMPLE') ? 'cumple' : 'no_cumple',
      resumen: motivos[0] || resultado,
      accion: resultado.startsWith('CUMPLE')
        ? `Preparar resolución de titularidad por ${horasAlCorte || '—'} h con efecto ${p.vigencia_titularidad}.`
        : 'Completar/corregir designaciones (fechas, horas, calidad) y volver a evaluar.',
    },
  }
}

/**
 * Arma designaciones desde la ficha SIGEX (decretos) y evalúa.
 */
function evaluarTitularidad28BisDesdeFicha(ficha, params) {
  const decretos = ficha?.decretos || []
  const designaciones = decretos
    .map((d) => decretoADesignacion(d, ficha))
    .filter((d) => d.fecha_inicio || d.fecha_termino)
  return evaluarTitularidadPorDesignaciones({ designaciones, ficha, params })
}

module.exports = {
  PARAMETROS_21803,
  decretoADesignacion,
  enriquecerDesignaciones,
  evaluarTitularidadPorDesignaciones,
  evaluarTitularidad28BisDesdeFicha,
};
