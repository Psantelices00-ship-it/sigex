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

function normalizarEstab(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9\- ]/g, '')
    .trim()
    .slice(0, 40)
}

function claveActo(p, ini, fin, h, cal) {
  // Mismo N° de decreto + establecimiento = mismo acto (max horas)
  if (p.n_decreto) {
    return `dec:${String(p.n_decreto)}|${normalizarEstab(p.establecimiento)}|${cal}`
  }
  if (p.doc_id) return `doc:${p.doc_id}`
  // Sin N°: un acto por inicio + establecimiento (max horas; evita 36h+50h OCR)
  return `act:${ini}|${normalizarEstab(p.establecimiento)}|${cal}`
}

/**
 * Horas vigentes al corte.
 * Suma actos a contrata/extensión concurrentes (dictámenes 34.838/2015 y E5664/2020),
 * sin duplicar el mismo acto. Reemplazo aparte. Sin tope 44.
 * Si hay actos SIGEX con horas, se ignoran filas sintéticas excel_* para no inflar.
 */
function horasVigentesEnCorte(periodos, fechaCorte, filtroCalidadFn, opts = {}) {
  const corte = parseIso(fechaCorte)
  const tope = opts.topeHoras === undefined ? null : opts.topeHoras
  if (!corte) {
    return { horas: 0, horasReemplazo: 0, establecimientos: [], actos: [], actosReemplazo: [] }
  }
  const raw = periodos || []
  // excel_marzo_2026 solo aporta vigencia de fechas, no horas al corte 2025.
  const sinExcelMarzo = raw.filter((p) => String(p.fuente || '') !== 'excel_marzo_2026')
  const tieneSigexHoras = sinExcelMarzo.some((p) => {
    if (String(p.fuente || '').startsWith('excel')) return false
    const ini = parseIso(p.inicio)
    const fin = terminoEfectivo(p, sinExcelMarzo, corte)
    if (!ini || !fin || ini > corte || fin < corte) return false
    return Number(p.horas) > 0
  })
  const lista = tieneSigexHoras
    ? sinExcelMarzo.filter((p) => !String(p.fuente || '').startsWith('excel'))
    : sinExcelMarzo

  const porClave = new Map()
  for (const p of lista) {
    const ini = parseIso(p.inicio)
    const fin = terminoEfectivo(p, lista, corte)
    if (!ini || !fin) continue
    if (ini > corte || fin < corte) continue
    const cal = clasificarCalidad(p.calidad)
    if (filtroCalidadFn && !filtroCalidadFn(cal, p)) continue
    const h = Number.isFinite(Number(p.horas)) ? Number(p.horas) : null
    if (h == null || h <= 0) continue
    const key = claveActo(p, ini, fin, h, cal)
    const prev = porClave.get(key)
    if (!prev || h > prev.horas || (h === prev.horas && ini > prev.inicio)) {
      porClave.set(key, {
        horas: h,
        establecimiento: p.establecimiento || null,
        inicio: ini,
        termino: fin,
        fuente: p.fuente || null,
        calidad: cal,
        n_decreto: p.n_decreto || null,
        fecha_decreto: parseIso(p.fecha_decreto) || null,
        doc_id: p.doc_id || null,
        etiqueta: [
          p.n_decreto ? `N° ${p.n_decreto}` : null,
          parseIso(p.fecha_decreto) || ini,
          p.establecimiento || null,
          `${h}h`,
        ]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }

  const actosRaw = []
  const actosReemplazo = []
  const est = new Set()
  for (const acto of porClave.values()) {
    if (acto.establecimiento) est.add(acto.establecimiento)
    if (acto.calidad === 'reemplazo') actosReemplazo.push(acto)
    else actosRaw.push(acto)
  }
  // Si hay acto con N° decreto y otro sin N° mismo inicio/est/horas, descartar el sin N°
  const actos = actosRaw.filter((a) => {
    if (a.n_decreto) return true
    const gemelo = actosRaw.find(
      (o) =>
        o !== a &&
        o.n_decreto &&
        o.inicio === a.inicio &&
        o.horas === a.horas &&
        normalizarEstab(o.establecimiento) === normalizarEstab(a.establecimiento)
    )
    return !gemelo
  })

  let horas = actos.reduce((a, x) => a + x.horas, 0)
  const horasReemplazo = actosReemplazo.reduce((a, x) => a + x.horas, 0)
  if (tope != null && Number.isFinite(Number(tope)) && horas > Number(tope)) {
    horas = Number(tope)
  }
  return {
    horas,
    horasReemplazo,
    establecimientos: [...est],
    actos,
    actosReemplazo,
  }
}

/**
 * Detecta inicios de marzo posteriores al 1.er día hábil, cuando ese día hábil
 * no está cubierto por ningún acto con término explícito.
 */
function iniciosTardiosMarzo(periodos, desdeIso, hastaIso, opts = {}) {
  const desde = parseIso(desdeIso)
  const hasta = parseIso(hastaIso)
  if (!desde || !hasta) return []
  const lista = (periodos || []).filter((p) => {
    if (!parseIso(p.termino)) return false
    const cal = clasificarCalidad(p.calidad)
    if (cal === 'titular') return false
    if (cal === 'reemplazo' && opts.contarReemplazos === false) return false
    return true
  })
  const y0 = Number(desde.slice(0, 4))
  const y1 = Number(hasta.slice(0, 4))
  const huecos = []
  for (let y = y0; y <= y1; y++) {
    const habil = primerDiaHabilMarzo(y)
    if (habil < desde || habil > hasta) continue
    const cubreHabil = lista.some((p) => {
      const ini = parseIso(p.inicio)
      const fin = parseIso(p.termino)
      return ini && fin && ini <= habil && fin >= habil
    })
    if (cubreHabil) continue
    const late = lista
      .filter((p) => {
        const ini = parseIso(p.inicio)
        return ini && ini.startsWith(`${y}-03`) && ini > habil
      })
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    if (!late.length) continue
    const iniLate = parseIso(late[0].inicio)
    const abiertosQueCubren = (periodos || [])
      .filter((p) => !parseIso(p.termino))
      .filter((p) => {
        const ini = parseIso(p.inicio)
        const fin = terminoEfectivo(p, periodos, hasta)
        return ini && fin && ini <= habil && fin >= habil
      })
      .map((p) =>
        [p.n_decreto ? `N° ${p.n_decreto}` : null, p.inicio, p.fuente].filter(Boolean).join(' ')
      )
    let msg =
      `Inicio tardío ${iniLate} (1.er hábil ${habil}); sin cobertura explícita ${habil} → ${addDaysIso(iniLate, -1)}`
    if (late[0].n_decreto) msg += ` — acto N° ${late[0].n_decreto}`
    if (abiertosQueCubren.length) {
      msg += ` — posible cobertura en actos abiertos: ${abiertosQueCubren.slice(0, 2).join('; ')}`
    }
    huecos.push(msg)
  }
  return huecos
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

/** Fin del año escolar (28/29-feb) que contiene `inicioIso`. */
function finAnoEscolar(inicioIso) {
  const d = toDate(inicioIso)
  if (!d) return null
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const endY = m >= 3 ? y + 1 : y
  const feb = new Date(endY, 2, 0) // último día de febrero
  const mm = String(feb.getMonth() + 1).padStart(2, '0')
  const dd = String(feb.getDate()).padStart(2, '0')
  return `${feb.getFullYear()}-${mm}-${dd}`
}

/**
 * Termino efectivo de un periodo.
 * Con término explícito: se respeta.
 * Abierto (null): se corta al menor entre (a) día anterior al siguiente inicio,
 * (b) fin de año escolar del inicio, (c) hastaIso.
 * Evita que filas abiertas del consolidado proyecten cobertura indefinida.
 */
function terminoEfectivo(p, periodos, hastaIso) {
  const explicit = parseIso(p?.termino)
  if (explicit) return explicit
  const ini = parseIso(p?.inicio)
  const hasta = parseIso(hastaIso)
  if (!ini) return null
  let cap = finAnoEscolar(ini)
  let nextStart = null
  for (const o of periodos || []) {
    if (o === p) continue
    const oi = parseIso(o.inicio)
    if (!oi || oi <= ini) continue
    if (!nextStart || oi < nextStart) nextStart = oi
  }
  if (nextStart) {
    const beforeNext = addDaysIso(nextStart, -1)
    if (beforeNext && (!cap || beforeNext < cap)) cap = beforeNext
  }
  if (hasta && (!cap || hasta < cap)) cap = hasta
  return cap
}

/**
 * Art. 41 bis Ley 19.070: el receso ene-feb solo mantiene continuidad si
 * (1) había contrato vigente al 1 de diciembre previo y
 * (2) más de 6 meses de servicio a esa fecha;
 * y la recontratación parte a más tardar el 1.er día hábil de marzo.
 */
function cumpleReceso41Bis(periodos, anioMarzo, nextInicio, opts = {}) {
  const habilMarzo = primerDiaHabilMarzo(anioMarzo)
  if (!nextInicio || nextInicio > habilMarzo) return false
  const dic1 = `${anioMarzo - 1}-12-01`
  if (!cubreFecha(periodos, dic1, opts)) return false
  // > 6 meses de servicio: cobertura continua (o casi) desde ~1 jun hasta 1 dic
  const desde6 = addDaysIso(dic1, -183) || `${anioMarzo - 1}-06-01`
  const serv = continuidadPorDias(periodos, desde6, dic1, {
    ...opts,
    // Evitar recursión infinita en puente de receso: aquí no aplicamos 41 bis anidado
    _skipReceso41Bis: true,
  })
  return !!(serv.ok || (serv.diasCubiertos != null && serv.diasCubiertos >= 180))
}

/**
 * Continuidad día a día entre desdeIso y hastaIso (inclusive).
 * Periodos sin término explícito NO aportan a la cadena (evitan tapar huecos de marzo).
 * Receso ene-feb: solo con art. 41 bis (vigente 1-dic + >6 meses) y recontratación
 * al primer día hábil de marzo (o antes).
 */
function continuidadPorDias(periodos, desdeIso, hastaIso, opts = {}) {
  const {
    toleranciaBrechaDias = 0,
    contarReemplazos = true,
    contarHorasExtension = true,
    incluirPeriodosSostenedorAnterior = false,
    _skipReceso41Bis = false,
    incluirAbiertos = false,
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
    // Solo términos explícitos en continuidad (salvo flag)
    if (!parseIso(p.termino) && !incluirAbiertos) continue
    const ini = parseIso(p.inicio)
    const fin = parseIso(p.termino) || terminoEfectivo(p, lista, hasta)
    if (!ini || !fin) continue
    if (fin < ini) continue
    const a = ini < desde ? desde : ini
    const b = fin > hasta ? hasta : fin
    if (b < a) continue
    segs.push({
      inicio: a,
      termino: b,
      origen_inicio: ini,
      n_decreto: p.n_decreto || null,
      establecimiento: p.establecimiento || null,
      fuente: p.fuente || null,
    })
  }
  segs.sort((x, y) => x.inicio.localeCompare(y.inicio) || x.termino.localeCompare(y.termino))

  const merged = []
  const puentes = []
  for (const s of segs) {
    if (!merged.length) {
      merged.push({ ...s })
      continue
    }
    const last = merged[merged.length - 1]
    const gap = daysBetween(last.termino, s.inicio)
    if (gap != null && gap <= 1 + Number(toleranciaBrechaDias || 0)) {
      if (s.termino > last.termino) last.termino = s.termino
      continue
    }
    // Receso ene-feb con art. 41 bis
    const iniNext = toDate(s.inicio)
    if (!_skipReceso41Bis && iniNext) {
      const anioMarzo = iniNext.getFullYear()
      const habilMarzo = primerDiaHabilMarzo(anioMarzo)
      const lastEnDicOEneFeb =
        last.termino >= `${anioMarzo - 1}-12-01` && last.termino <= `${anioMarzo}-02-29`
      if (
        lastEnDicOEneFeb &&
        s.inicio <= habilMarzo &&
        cumpleReceso41Bis(lista, anioMarzo, s.inicio, {
          contarReemplazos,
          contarHorasExtension,
          incluirPeriodosSostenedorAnterior,
          incluirAbiertos: false,
        })
      ) {
        puentes.push({
          anio: anioMarzo,
          dic1: `${anioMarzo - 1}-12-01`,
          recontrata: s.inicio,
          habilMarzo,
        })
        if (s.termino > last.termino) last.termino = s.termino
        continue
      }
    }
    merged.push({ ...s })
  }

  const huecos = []
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
      // ¿Hay alguna designación (incl. abierta) que cubra el hueco? Informar.
      const huecoIni = addDaysIso(prev.termino, 1)
      const huecoFin = addDaysIso(cur.inicio, -1)
      const cubiertasPor = []
      for (const p of lista) {
        const cal = clasificarCalidad(p.calidad)
        if (cal === 'titular') continue
        const ini = parseIso(p.inicio)
        const fin = terminoEfectivo(p, lista, hasta)
        if (!ini || !fin) continue
        if (ini <= huecoFin && fin >= huecoIni) {
          cubiertasPor.push(
            [p.n_decreto ? `N° ${p.n_decreto}` : null, ini, p.establecimiento, p.fuente]
              .filter(Boolean)
              .join(' ')
          )
        }
      }
      let msg = `Hueco ${huecoIni} → ${huecoFin} (${gap - 1} días)`
      if (cubiertasPor.length) {
        msg += ` — posible cobertura en actos abiertos/otros: ${cubiertasPor.slice(0, 3).join('; ')}`
      }
      huecos.push(msg)
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
    puentes41Bis: puentes,
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
    // Para vigencia puntual: término explícito, o efectivo con tope año escolar
    const fin = parseIso(p.termino) || terminoEfectivo(p, lista, f)
    if (!ini || !fin) continue
    if (ini <= f && fin >= f) return true
  }
  return false
}

/** Actos (con detalle) que cubren una fecha — para informar cobertura de huecos. */
function actosQueCubren(periodos, fechaIso, opts = {}) {
  const f = parseIso(fechaIso)
  if (!f) return []
  const lista = periodos || []
  const out = []
  for (const p of lista) {
    if (p.mismoSostenedor === false && !opts.incluirPeriodosSostenedorAnterior) continue
    const cal = clasificarCalidad(p.calidad)
    if (cal === 'titular' && opts.soloContrata) continue
    const ini = parseIso(p.inicio)
    const fin = parseIso(p.termino) || terminoEfectivo(p, lista, f)
    if (!ini || !fin) continue
    if (ini <= f && fin >= f) {
      out.push({
        inicio: ini,
        termino: fin,
        n_decreto: p.n_decreto || null,
        fecha_decreto: parseIso(p.fecha_decreto) || null,
        horas: p.horas ?? null,
        establecimiento: p.establecimiento || null,
        fuente: p.fuente || null,
        calidad: cal,
        termino_explicito: !!parseIso(p.termino),
      })
    }
  }
  return out
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
  actosQueCubren,
  addDaysIso,
  daysBetween,
  terminoEfectivo,
  finAnoEscolar,
  cumpleReceso41Bis,
  iniciosTardiosMarzo,
}
