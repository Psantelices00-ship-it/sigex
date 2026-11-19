/**
 * Línea de tiempo mensual y métricas de continuidad.
 * Puro: no toca la base de datos.
 */

function parseIso(d) {
  if (!d) return null
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  const s = String(d).trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = String(d).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
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

  for (const p of periodos || []) {
    if (p.mismoSostenedor === false && !incluirPeriodosSostenedorAnterior) continue
    const ini = parseIso(p.inicio)
    let fin = parseIso(p.termino)
    if (!ini) continue
    if (!fin) fin = ini
    if (fin < ini) continue

    const calidad = clasificarCalidad(p.calidad)
    if (calidad === 'reemplazo' && !contarReemplazos) continue
    if (calidad === 'extension' && !contarHorasExtension) continue

    const a0 = toDate(ini)
    const a1 = toDate(fin)
    let y = a0.getFullYear()
    let m = a0.getMonth() + 1
    const endY = a1.getFullYear()
    const endM = a1.getMonth() + 1
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

  const keys = []
  let cur = desdeYm
  while (cur <= hastaYm) {
    keys.push(cur)
    cur = shiftYm(cur, 1)
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

function horasVigentesEnCorte(periodos, fechaCorte, filtroCalidadFn) {
  const corte = parseIso(fechaCorte)
  if (!corte) return { horas: 0, establecimientos: [] }
  let horas = 0
  const est = new Set()
  for (const p of periodos || []) {
    const ini = parseIso(p.inicio)
    let fin = parseIso(p.termino) || corte
    if (!ini) continue
    if (ini > corte || fin < corte) continue
    const cal = clasificarCalidad(p.calidad)
    if (filtroCalidadFn && !filtroCalidadFn(cal, p)) continue
    if (Number.isFinite(Number(p.horas))) horas += Number(p.horas)
    if (p.establecimiento) est.add(p.establecimiento)
  }
  return { horas, establecimientos: [...est] }
}

module.exports = {
  parseIso,
  ymKey,
  shiftYm,
  ventanaHasta,
  clasificarCalidad,
  esDirectivoCargo,
  expandirMeses,
  metricasContinuidad,
  horasVigentesEnCorte,
  monthsBetweenInclusive,
}
