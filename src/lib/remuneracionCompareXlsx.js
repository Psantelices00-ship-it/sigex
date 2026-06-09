const XLSX = require('xlsx')

const UMBRAL_GRANDE_DEFAULT = 50000

function normalizarRut(rut) {
  if (rut == null) return ''
  return String(rut)
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/\s/g, '')
}

function parseMonto(val) {
  if (val == null || val === '') return 0
  const n = Number(val)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function parseFecha(val) {
  if (!val) return null
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/**
 * Parsea planilla nomdepbancos (.xls/.xlsx): depósitos bancarios por funcionario.
 * @param {Buffer} buffer
 * @param {{ etiqueta?: string }} opts
 */
function parseNomdepbancosXlsx(buffer, opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  let fecha = null
  let banco = null
  const empleados = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row.length) continue

    const c0 = row[0]
    const c1 = row[1]
    const c4 = row[4]
    const c5 = row[5]
    const c7 = row[7]
    const c8 = row[8]
    const c9 = row[9]

    if (i === 0 && c9 != null) {
      fecha = parseFecha(c9)
    }

    if (typeof c1 === 'string' && c1.trim().toUpperCase().startsWith('BANCO:')) {
      banco = c1.replace(/^BANCO:\s*/i, '').trim()
      continue
    }

    if (typeof c7 === 'string' && c7.toUpperCase().includes('TOTAL BANCO')) {
      continue
    }

    const num = typeof c0 === 'number' ? c0 : parseInt(String(c0 || ''), 10)
    if (!Number.isFinite(num) || num <= 0) continue
    if (c1 == null || String(c1).trim() === '') continue

    const rut = normalizarRut(c4)
    if (!rut) continue

    empleados.push({
      rut,
      rut_display: String(c4).trim(),
      nombre: String(c1).trim(),
      banco: banco || '',
      tipo_cuenta: c5 != null ? String(c5).trim() : '',
      cuenta: c7 != null ? String(c7).trim() : '',
      monto: parseMonto(c8),
    })
  }

  const total = empleados.reduce((acc, e) => acc + e.monto, 0)

  return {
    etiqueta: opts.etiqueta || 'Período',
    archivo_hoja: sheetName,
    fecha,
    total_empleados: empleados.length,
    total_monto: total,
    empleados,
  }
}

function clasificarDiferencia(diff, umbralGrande) {
  const abs = Math.abs(diff)
  if (abs === 0) return 'igual'
  if (abs >= umbralGrande) return 'grande'
  return 'pequena'
}

/**
 * Compara dos planillas parseadas por RUT.
 * @param {ReturnType<typeof parseNomdepbancosXlsx>} periodoA
 * @param {ReturnType<typeof parseNomdepbancosXlsx>} periodoB
 * @param {{ umbral_grande?: number, nombre_a?: string, nombre_b?: string }} opts
 */
function compararPlanillas(periodoA, periodoB, opts = {}) {
  const umbralGrande = Number(opts.umbral_grande) > 0 ? Number(opts.umbral_grande) : UMBRAL_GRANDE_DEFAULT
  const nombreA = opts.nombre_a || periodoA.etiqueta || 'Período A'
  const nombreB = opts.nombre_b || periodoB.etiqueta || 'Período B'

  const mapA = new Map()
  for (const e of periodoA.empleados) {
    mapA.set(e.rut, e)
  }
  const mapB = new Map()
  for (const e of periodoB.empleados) {
    mapB.set(e.rut, e)
  }

  const rutsA = new Set(mapA.keys())
  const rutsB = new Set(mapB.keys())

  const soloA = []
  const soloB = []
  const iguales = []
  const pequenas = []
  const grandes = []

  for (const rut of rutsA) {
    if (rutsB.has(rut)) continue
    const e = mapA.get(rut)
    soloA.push({
      rut,
      rut_display: e.rut_display,
      nombre: e.nombre,
      banco: e.banco,
      cuenta: e.cuenta,
      monto_a: e.monto,
      monto_b: null,
      diferencia: -e.monto,
      categoria: 'solo_periodo_a',
    })
  }

  for (const rut of rutsB) {
    if (rutsA.has(rut)) continue
    const e = mapB.get(rut)
    soloB.push({
      rut,
      rut_display: e.rut_display,
      nombre: e.nombre,
      banco: e.banco,
      cuenta: e.cuenta,
      monto_a: null,
      monto_b: e.monto,
      diferencia: e.monto,
      categoria: 'solo_periodo_b',
    })
  }

  for (const rut of rutsA) {
    if (!rutsB.has(rut)) continue
    const ea = mapA.get(rut)
    const eb = mapB.get(rut)
    const diff = eb.monto - ea.monto
    const pct = ea.monto !== 0 ? (diff / ea.monto) * 100 : eb.monto !== 0 ? 100 : 0
    const base = {
      rut,
      rut_display: ea.rut_display || eb.rut_display,
      nombre: ea.nombre || eb.nombre,
      banco_a: ea.banco,
      banco_b: eb.banco,
      cuenta_a: ea.cuenta,
      cuenta_b: eb.cuenta,
      monto_a: ea.monto,
      monto_b: eb.monto,
      diferencia: diff,
      variacion_pct: Math.round(pct * 10) / 10,
      cambio_banco: ea.banco !== eb.banco,
    }

    const cat = clasificarDiferencia(diff, umbralGrande)
    if (cat === 'igual') {
      iguales.push({ ...base, categoria: 'igual' })
    } else if (cat === 'pequena') {
      pequenas.push({ ...base, categoria: 'pequena' })
    } else {
      grandes.push({ ...base, categoria: 'grande' })
    }
  }

  const byAbsDiff = (a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)
  soloA.sort((a, b) => b.monto_a - a.monto_a)
  soloB.sort((a, b) => b.monto_b - a.monto_b)
  pequenas.sort(byAbsDiff)
  grandes.sort(byAbsDiff)

  return {
    periodo_a: {
      etiqueta: nombreA,
      fecha: periodoA.fecha,
      total_empleados: periodoA.total_empleados,
      total_monto: periodoA.total_monto,
    },
    periodo_b: {
      etiqueta: nombreB,
      fecha: periodoB.fecha,
      total_empleados: periodoB.total_empleados,
      total_monto: periodoB.total_monto,
    },
    umbral_grande: umbralGrande,
    resumen: {
      en_ambos: iguales.length + pequenas.length + grandes.length,
      iguales: iguales.length,
      pequenas_diferencias: pequenas.length,
      grandes_diferencias: grandes.length,
      solo_periodo_a: soloA.length,
      solo_periodo_b: soloB.length,
      diferencia_total: periodoB.total_monto - periodoA.total_monto,
      diferencia_empleados: periodoB.total_empleados - periodoA.total_empleados,
    },
    solo_periodo_a: soloA,
    solo_periodo_b: soloB,
    grandes_diferencias: grandes,
    pequenas_diferencias: pequenas,
    iguales,
  }
}

module.exports = {
  parseNomdepbancosXlsx,
  compararPlanillas,
  normalizarRut,
  UMBRAL_GRANDE_DEFAULT,
}
