/**
 * Parámetros versionados de evaluación de titularidad.
 * Ajustables sin tocar la lógica del motor.
 */

const CARGOS_DIRECTIVOS_DEFAULT = [
  'DIRECTOR ESTABLECIMI',
  'DIRECTOR(A) ENCARGAD',
  'DIRECTOR',
  'INSPECTOR GENERAL',
  'JEFE U.T.P.',
  'JEFE UTP',
  'SUBDIRECTOR',
]

const PARAMS_21803 = {
  ley: '21803',
  version: '2026-11-24',
  modos: {
    transitorio: {
      id: 'transitorio',
      label: 'Art. 41 transitorio (por única vez)',
      fechaCorte: '2025-07-31',
      vigenciaTitularidad: '2026-03-01',
      // Primer día hábil de marzo 2026 = 02-03-2026 (1 fue domingo)
      fechaVerificacionVigencia: '2026-03-02',
      exigeConcurso: false,
    },
    permanente: {
      id: 'permanente',
      label: 'Art. 28 bis (permanente)',
      // fechaCorte: 31-03 del año elegido; vigencia 01-04 mismo año
      fechaCorteDiaMes: '03-31',
      vigenciaDiaMes: '04-01',
      exigeConcurso: false, // editable; true recién ~2030
    },
  },
  ventanaAnios: 6,
  mesesContinuosMin: 48,
  mesesDiscontinuosMin: 48,
  mesesContinuidadReciente: 24,
  horasMinimas: 0,
  excluirDirectivos: false,
  contarReemplazos: true,
  contarHorasExtension: true,
  incluirPeriodosSostenedorAnterior: false,
  toleranciaBrechaDias: 0,
  criterioMesParcial: 'contrato_y_liquidacion', // o 'solo_contrato'
  cargosDirectivos: CARGOS_DIRECTIVOS_DEFAULT,
}

const PARAMS_21176 = {
  ley: '21176',
  version: '2026-11-19',
  modos: {
    inciso1: {
      id: 'inciso1',
      label: 'Inciso 1° (por única vez)',
      fechaCorte: '2019-10-11',
      mesesContinuosMin: 36,
      mesesDiscontinuosMin: 48,
      horasTitularesMinimas: 0,
    },
    inciso2: {
      id: 'inciso2',
      label: 'Inciso 2° (régimen permanente)',
      // fechaCorte por defecto = hoy
      mesesContinuosMin: 48,
      mesesDiscontinuosMin: 72,
      horasTitularesMinimas: 30,
    },
  },
  incluirPeriodosSostenedorAnterior: false,
  toleranciaBrechaDias: 0,
  criterioMesParcial: 'contrato_y_liquidacion',
  cargosDirectivos: CARGOS_DIRECTIVOS_DEFAULT,
}

function resolveParams21803(modo, fechaCorteOverride, anioPermanente, overrides = {}) {
  const base = { ...PARAMS_21803, ...overrides }
  const m = base.modos[modo] || base.modos.transitorio
  let fechaCorte = fechaCorteOverride || m.fechaCorte
  let vigenciaTitularidad = m.vigenciaTitularidad || null
  if (modo === 'permanente') {
    const anio = Number(anioPermanente) || new Date().getFullYear()
    fechaCorte = fechaCorteOverride || `${anio}-03-31`
    vigenciaTitularidad = `${anio}-04-01`
  }
  return {
    ...base,
    modo: m.id,
    modoLabel: m.label,
    fechaCorte,
    vigenciaTitularidad,
    exigeConcurso: m.exigeConcurso === true,
  }
}

function resolveParams21176(modo, fechaCorteOverride, overrides = {}) {
  const base = { ...PARAMS_21176, ...overrides }
  const m = base.modos[modo] || base.modos.inciso2
  const hoy = new Date().toISOString().slice(0, 10)
  const fechaCorte =
    fechaCorteOverride || m.fechaCorte || hoy
  return {
    ...base,
    modo: m.id,
    modoLabel: m.label,
    fechaCorte,
    mesesContinuosMin: m.mesesContinuosMin,
    mesesDiscontinuosMin: m.mesesDiscontinuosMin,
    horasTitularesMinimas: m.horasTitularesMinimas,
  }
}

module.exports = {
  CARGOS_DIRECTIVOS_DEFAULT,
  PARAMS_21803,
  PARAMS_21176,
  resolveParams21803,
  resolveParams21176,
}
