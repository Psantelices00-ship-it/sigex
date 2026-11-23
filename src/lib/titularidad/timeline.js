/**
 * Línea de tiempo mensual y métricas de continuidad.
 * Puro: no toca la base de datos.
 */

function parseIso(d) {
  if (!d) return null
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    // Usar componentes locales/UTC consistentes vía ISO
    return d.toISOString().slice(0, 10)
  }
  const raw = String(d).trim()
  // Postgres / JSON a veces manda "2025-07-31T03:00:00.000Z"
  const isoPref = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoPref) {
    const y = Number(isoPref[1])
    const m = Number(isoPref[2])
    const day = Number(isoPref[3])
    if (m < 1 || m > 12 || day < 1 || day > 31) return null
    const s = `${isoPref[1]}-${isoPref[2]}-${isoPref[3]}`
    const dt = new Date(`${s}T12:00:00`)
    if (Number.isNaN(dt.getTime())) return null
    // rechazar overflow (ej. 2025-02-31 → mar)
    if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== day) return null
    return s
  }
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const s = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return parseIso(s)
  }
  return null
}

function toDate(iso) {
  const s = parseIso(iso)
  if (!s) return null
  const dt = new Date(`${s}T12:00:00`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function ymKey(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`
}

function addMonths(anio, mes, n) {
  const d = new Date(anio, mes - 1 + n, 1)
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 }
}

function monthsBetweenInclusive(desdeYm, hastaYm) {
  const [ay, am] = desdeYm.split('-').map(Number)
  const [by, bm] = hastaYm.split('-').map(Number)
  return (by - ay) * 12 + (bm - am) + 1
}

function shiftYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const t = addMonths(y, m, delta)
  return ymKey(t.anio, t.mes)
}

function ventanaHasta(fechaCorte, anios) {
  const corte = toDate(fechaCorte)
  if (!corte) return null
  const fin = ymKey(corte.getFullYear(), corte.getMonth() + 1)
  const iniDate = new Date(corte)
  iniDate.setFullYear(iniDate.getFullYear() - anios)
  iniDate.setDate(iniDate.getDate() + 1) // ventana de N años que terminan en fechaCorte
  const ini = ymKey(iniDate.getFullYear(), iniDate.getMonth() + 1)
  return { desdeYm: ini, hastaYm: fin }
}

/**
 * Normaliza calidad de un periodo/acto.
 * @returns {'titular'|'contrata'|'extension'|'reemplazo'|'otro'}
 */
function clasificarCalidad(raw) {
  const u = String(raw || '').toUpperCase()
  if (/EXTENSION|EXTENSI[OÓ]N/.test(u)) return 'extension'
  if (/REEMPLAZ/.test(u)) return 'reemplazo'
  if (/TITULAR/.test(u)) return 'titular'
  if (/CONTRATA|PLAZO\s*FIJO/.test(u)) return 'contrata'
  return 'otro'
}

function esDirectivoCargo(cargo, cargosDirectivos = []) {
  const u = String(cargo || '').toUpperCase()
  if (!u) return false
  return (cargosDirectivos || []).some((c) => u.includes(String(c).toUpperCase().slice(0, 12)))
}

/**
 * @typedef {object} PeriodoInput
 * @property {string} inicio ISO
 * @property {string|null} termino ISO
 * @property {string} calidad raw
 * @property {number|null} horas
 * @property {string|null} establecimiento
 * @property {boolean} [mismoSostenedor]
 * @property {string} [fuente]
 */

/**
 * Expande periodos a mapa mensual ym -> { calidades, horas, fuentes, conContrato, conLiquidacion }
 */
function expandirMeses(periodos, liquidacionesYmSet, opts = {}) {
  const {
    incluirPeriodosSostenedorAnterior = false,
    contarReemplazos = true,
    contarHorasExtension = true,
  } = opts

  const meses = new Map()

  function touch(ym, patch) {
    const cur = meses.get(ym) || {
      ym,
      calidades: new Set(),
      horas: 0,
      horasPorCalidad: {},
      fuentes: new Set(),
      conContrato: false,
      conLiquidacion: liquidacionesYmSet.has(ym),
      establecimientos: new Set(),
    }
    Object.assign(cur, patch)
    if (patch.calidad) cur.calidades.add(patch.calidad)
    if (patch.fuente) cur.fuentes.add(patch.fuente)
    if (patch.establecimiento) cur.establecimientos.add(patch.establecimiento)
    if (patch.horasAdd && patch.calidad) {
      cur.horasPorCalidad[patch.calidad] = (cur.horasPorCalidad[patch.calidad] || 0) + patch.horasAdd
      cur.horas = Object.values(cur.horasPorCalidad).reduce((a, b) => a + b, 0)
    }
    meses.set(ym, cur)
  }

  const lista = periodos || []
  // Tope para periodos abiertos: no inventar cobertura indefinida en el mapa mensual.
  const hastaExpansión = opts.hastaIso || null
  for (const p of lista) {
    if (p.mismoSostenedor === false && !incluirPeriodosSostenedorAnterior) continue
    const ini = parseIso(p.inicio)
    let fin = parseIso(p.termino)
    if (!ini) continue
    if (!fin) {
      // Abierto: cortar ante el siguiente inicio (mismo criterio que continuidadPorDias)
      fin = terminoEfectivo(p, lista, hastaExpansión || ini)
    }
    if (!fin) fin = ini
    if (fin < ini) continue

    const calidad = clasificarCalidad(p.calidad)
    if (calidad === 'reemplazo' && !contarReemplazos) continue
    if (calidad === 'extension' && !contarHorasExtension) continue

    const a0 = toDate(ini)
    const a1 = toDate(fin)
    if (!a0 || !a1) continue
    let y = a0.getFullYear()
    let m = a0.getMonth() + 1
    const endY = a1.getFullYear()
    const endM = a1.getMonth() + 1
    // Guardrail: periodos absurdamente largos (datos corruptos)
    if ((endY - y) * 12 + (endM - m) > 1200) continue
    while (y < endY || (y === endY && m <= endM)) {
      const ym = ymKey(y, m)
      touch(ym, {
        conContrato: true,
        calidad,
        fuente: p.fuente || 'decreto',
        establecimiento: p.establecimiento || null,
        horasAdd: Number.isFinite(Number(p.horas)) ? Number(p.horas) : 0,
      })
      const n = addMonths(y, m, 1)
      y = n.anio
      m = n.mes
    }
  }

  // meses solo con liquidación
  for (const ym of liquidacionesYmSet) {
    if (!meses.has(ym)) {
      touch(ym, { conLiquidacion: true })
    } else {
      meses.get(ym).conLiquidacion = true
    }
  }

  return meses
}

function mesCuentaComoServido(mes, criterioMesParcial = 'contrato_y_liquidacion') {
  if (!mes?.conContrato) return false
  if (criterioMesParcial === 'solo_contrato') return true
  // Si no hay liquidaciones cargadas en absoluto para el funcionario, no bloqueamos
  // (se marca REVISAR a nivel superior). Aquí exigimos liq solo si el set no vacío
  // se pasa vía flag.
  if (mes._exigirLiq === false) return true
  return !!mes.conLiquidacion
}

/**
 * Une rachas contiguas considerando receso ene-feb y marzo hábil.
 * Un mes "servido" alimenta la cadena; huecos ene/feb entre años escolares se toleran
 * si hay servicio en dic del año anterior y mar del siguiente.
 */
function metricasContinuidad(mesesMap, desdeYm, hastaYm, opts = {}) {
  const { criterioMesParcial = 'contrato_y_liquidacion', exigirLiquidacion = true } = opts

  if (!desdeYm || !hastaYm || String(desdeYm) > String(hastaYm)) {
    return {
      mesesContinuosMax: 0,
      mesesTotalesVentana: 0,
      cubreUltimos24Meses: false,
      timeline: [],
    }
  }

  const keys = []
  let cur = desdeYm
  let guard = 0
  while (cur <= hastaYm && guard < 240) {
    keys.push(cur)
    cur = shiftYm(cur, 1)
    guard += 1
  }

  const servido = keys.map((ym) => {
    const mes = mesesMap.get(ym)
    if (!mes) return false
    const copy = { ...mes, _exigirLiq: exigirLiquidacion }
    return mesCuentaComoServido(copy, criterioMesParcial)
  })

  // Marcar ene-feb como puente si dic y mar adyacentes están servidos
  const bridged = servido.slice()
  for (let i = 0; i < keys.length; i++) {
    const [, mm] = keys[i].split('-').map(Number)
    if (mm === 1 || mm === 2) {
      // buscar dic anterior y mar siguiente en la ventana
      const dic = shiftYm(keys[i].slice(0, 4) + '-01', mm === 1 ? -1 : -2)
      const mar = keys[i].slice(0, 4) + '-03'
      const idxDic = keys.indexOf(dic)
      const idxMar = keys.indexOf(mar)
      if (idxDic >= 0 && idxMar >= 0 && servido[idxDic] && servido[idxMar]) {
        bridged[i] = true
      }
    }
  }

  let mesesTotales = 0
  let racha = 0
  let maxRacha = 0
  for (let i = 0; i < bridged.length; i++) {
    if (bridged[i]) {
      mesesTotales += 1
      racha += 1
      if (racha > maxRacha) maxRacha = racha
    } else {
      racha = 0
    }
  }

  // últimos N meses hasta hastaYm
  function cubreUltimos(n) {
    if (keys.length < n) return bridged.every(Boolean) && bridged.length > 0
    const slice = bridged.slice(-n)
    return slice.every(Boolean)
  }

  return {
    mesesContinuosMax: maxRacha,
    mesesTotalesVentana: mesesTotales,
    cubreUltimos24Meses: cubreUltimos(24),
    timeline: keys.map((ym, i) => ({
      ym,
      servido: bridged[i],
      raw: mesesMap.get(ym) || null,
    })),
  }
}

/**
 * Horas a contrata vigentes al corte.
 * No suma designaciones solapadas/duplicadas: por cada calidad toma el máximo
 * de un solo acto vigente; luego suma calidades distintas (p. ej. contrata + extensión).
 * Tope legal informativo: 44 h.
 */
function horasVigentesEnCorte(periodos, fechaCorte, filtroCalidadFn, opts = {}) {
  const corte = parseIso(fechaCorte)
  const tope = opts.topeHoras != null ? Number(opts.topeHoras) : 44
  if (!corte) return { horas: 0, establecimientos: [], actos: [] }
  const lista = periodos || []
  // Por calidad: un solo acto vigente (el de inicio más reciente al corte).
  const porCalidad = new Map()
  const est = new Set()
  for (const p of lista) {
    const ini = parseIso(p.inicio)
    const fin = terminoEfectivo(p, lista, corte)
    if (!ini || !fin) continue
    if (ini > corte || fin < corte) continue
    const cal = clasificarCalidad(p.calidad)
    if (filtroCalidadFn && !filtroCalidadFn(cal, p)) continue
    const h = Number.isFinite(Number(p.horas)) ? Number(p.horas) : null
    if (h == null || h <= 0) continue
    if (p.establecimiento) est.add(p.establecimiento)
    const prev = porCalidad.get(cal)
    if (!prev || ini > prev.inicio || (ini === prev.inicio && h > prev.horas)) {
      porCalidad.set(cal, {
        horas: h,
        establecimiento: p.establecimiento || null,
        inicio: ini,
        termino: fin,
        fuente: p.fuente || null,
        calidad: cal,
      })
    }
  }
  const actos = [...porCalidad.values()]
  let horas = actos.reduce((a, x) => a + x.horas, 0)
  if (Number.isFinite(tope) && horas > tope) horas = tope
  return { horas, establecimientos: [...est], actos }
}

/** Primer día hábil de marzo del año (si 1=sáb/dom → lunes). */
function primerDiaHabilMarzo(anio) {
  const d = new Date(`${anio}-03-01T12:00:00`)
  const dow = d.getDay() // 0=dom, 6=sáb
  if (dow === 6) d.setDate(d.getDate() + 2)
  else if (dow === 0) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function addDaysIso(iso, n) {
  const d = toDate(iso)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(aIso, bIso) {
  const a = toDate(aIso)
  const b = toDate(bIso)
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}

/**
 * Termino efectivo de un periodo.
 * Si no tiene fecha de término, no se proyecta hasta el corte a ciegas:
 * se corta el día anterior al siguiente periodo que empieza después
 * (evita que filas abiertas del consolidado tapen huecos reales de marzo).
 * Si no hay sucesor, se asume vigente hasta `hastaIso`.
 */
function terminoEfectivo(p, periodos, hastaIso) {
  const explicit = parseIso(p?.termino)
  if (explicit) return explicit
  const ini = parseIso(p?.inicio)
  const hasta = parseIso(hastaIso)
  if (!ini) return null
  let nextStart = null
  for (const o of periodos || []) {
    if (o === p) continue
    const oi = parseIso(o.inicio)
    if (!oi || oi <= ini) continue
    if (!nextStart || oi < nextStart) nextStart = oi
  }
  if (nextStart) {
    const cap = addDaysIso(nextStart, -1)
    if (!cap) return hasta
    if (hasta && cap > hasta) return hasta
    return cap
  }
  return hasta || null
}

/**
 * Continuidad día a día entre desdeIso y hastaIso (inclusive).
 * Receso ene-feb no rompe si hay cobertura hasta dic y recontratación
 * al primer día hábil de marzo del año siguiente (o antes).
 * toleranciaBrechaDias: huecos <= N días no rompen (fuera de ene-feb).
 */
function continuidadPorDias(periodos, desdeIso, hastaIso, opts = {}) {
  const {
    toleranciaBrechaDias = 0,
    contarReemplazos = true,
    contarHorasExtension = true,
    incluirPeriodosSostenedorAnterior = false,
  } = opts

  const desde = parseIso(desdeIso)
  const hasta = parseIso(hastaIso)
  if (!desde || !hasta || hasta < desde) {
    return { ok: false, huecos: ['ventana inválida'], inicioCadena: null, diasCubiertos: 0 }
  }

  const lista = periodos || []
  const segs = []
  for (const p of lista) {
    if (p.mismoSostenedor === false && !incluirPeriodosSostenedorAnterior) continue
    const cal = clasificarCalidad(p.calidad)
    if (cal === 'reemplazo' && !contarReemplazos) continue
    if (cal === 'extension' && !contarHorasExtension) continue
    if (cal === 'titular') continue
    const ini = parseIso(p.inicio)
    const fin = terminoEfectivo(p, lista, hasta)
    if (!ini || !fin) continue
    if (fin < ini) continue
    const a = ini < desde ? desde : ini
    const b = fin > hasta ? hasta : fin
    if (b < a) continue
    segs.push({ inicio: a, termino: b })
  }
  segs.sort((x, y) => x.inicio.localeCompare(y.inicio) || x.termino.localeCompare(y.termino))

  // Merge overlapping/adjacent within tolerancia
  const merged = []
  for (const s of segs) {
    if (!merged.length) {
      merged.push({ ...s })
      continue
    }
    const last = merged[merged.length - 1]
    const gap = daysBetween(last.termino, s.inicio)
    // gap=1 means next day (continuous); gap=0 overlap/same day
    if (gap != null && gap <= 1 + Number(toleranciaBrechaDias || 0)) {
      if (s.termino > last.termino) last.termino = s.termino
      continue
    }
    // Receso ene-feb: si el siguiente arranca a más tardar el primer día hábil de marzo.
    const iniNext = toDate(s.inicio)
    if (iniNext) {
      const anioMarzo = iniNext.getFullYear()
      const habilMarzo = primerDiaHabilMarzo(anioMarzo)
      const finDic = `${anioMarzo - 1}-12-31`
      const lastEnDic =
        last.termino >= `${anioMarzo - 1}-12-01` && last.termino <= finDic
      const lastEnEneFeb =
        last.termino >= `${anioMarzo}-01-01` && last.termino <= `${anioMarzo}-02-29`
      if ((lastEnDic || lastEnEneFeb) && s.inicio <= habilMarzo) {
        if (s.termino > last.termino) last.termino = s.termino
        continue
      }
    }
    merged.push({ ...s })
  }

  const huecos = []
  // Must start covering `desde` (or first business day of March if desde is that)
  if (!merged.length) {
    return { ok: false, huecos: [`Sin cobertura ${desde} → ${hasta}`], inicioCadena: null, diasCubiertos: 0 }
  }
  if (merged[0].inicio > desde) {
    const habil = desde.slice(5, 7) === '03' ? primerDiaHabilMarzo(Number(desde.slice(0, 4))) : null
    if (!(habil && merged[0].inicio <= habil && desde <= habil)) {
      huecos.push(`Inicio de cadena ${merged[0].inicio} posterior a ${desde}`)
    }
  }
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1]
    const cur = merged[i]
    const gap = daysBetween(prev.termino, cur.inicio)
    if (gap != null && gap > 1 + Number(toleranciaBrechaDias || 0)) {
      huecos.push(`Hueco ${addDaysIso(prev.termino, 1)} → ${addDaysIso(cur.inicio, -1)} (${gap - 1} días)`)
    }
  }
  if (merged[merged.length - 1].termino < hasta) {
    huecos.push(`Cobertura termina ${merged[merged.length - 1].termino} antes del corte ${hasta}`)
  }

  let diasCubiertos = 0
  for (const s of merged) {
    const d = daysBetween(s.inicio, s.termino)
    if (d != null) diasCubiertos += d + 1
  }

  return {
    ok: huecos.length === 0,
    huecos,
    inicioCadena: merged[0]?.inicio || null,
    diasCubiertos,
    segmentos: merged,
  }
}

/** ¿Algún periodo (contrata/reemplazo/extensión) cubre la fecha? */
function cubreFecha(periodos, fechaIso, opts = {}) {
  const f = parseIso(fechaIso)
  if (!f) return false
  const lista = periodos || []
  for (const p of lista) {
    if (p.mismoSostenedor === false && !opts.incluirPeriodosSostenedorAnterior) continue
    const cal = clasificarCalidad(p.calidad)
    if (cal === 'titular' && opts.soloContrata) continue
    const ini = parseIso(p.inicio)
    const fin = terminoEfectivo(p, lista, f)
    if (!ini || !fin) continue
    if (ini <= f && fin >= f) return true
  }
  return false
}

module.exports = {
  parseIso,
  toDate,
  ymKey,
  shiftYm,
  ventanaHasta,
  clasificarCalidad,
  esDirectivoCargo,
  expandirMeses,
  metricasContinuidad,
  horasVigentesEnCorte,
  monthsBetweenInclusive,
  primerDiaHabilMarzo,
  continuidadPorDias,
  cubreFecha,
  addDaysIso,
  daysBetween,
  terminoEfectivo,
}
