/**
 * Parser para cartolas Banco de Chile extraídas con pdf-parse (sin espacios entre columnas).
 * Formato típico (una línea larga por página):
 *   DD/MM/AAAA Cheque Pagado|Cobrado ... sucursal N°cheque cargo saldo
 */

/** Montos CLP: 81.320 o 3.242.668.182 (pdf-parse los pega al N° cheque sin espacios). */
const RE_MONTO_CLP = String.raw`\d{1,3}(?:\.\d{3})+|\d+`

const RE_CHEQUE_BANCO_CHILE = new RegExp(
  String.raw`(\d{2}/\d{2}/\d{4})\s*Cheque[^2]*?(21\d{5})\s*(${RE_MONTO_CLP})\s*(${RE_MONTO_CLP})`,
  'gi'
)

function normalizarTextoCartola(texto) {
  return String(texto || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function descripcionDesdeBloque(bloque, fecha, nro) {
  const i = bloque.indexOf(fecha)
  const j = bloque.indexOf(nro, i >= 0 ? i + fecha.length : 0)
  if (i < 0 || j < 0) return 'Cheque'
  return bloque.slice(i + fecha.length, j).replace(/\s+/g, ' ').trim() || 'Cheque'
}

function montoAEntero(fmt) {
  if (!fmt) return null
  const n = parseInt(String(fmt).replace(/\./g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {string} textoPlanoPdf
 */
function parsearMovimientosCartolaPdfTexto(textoPlanoPdf) {
  const texto = normalizarTextoCartola(textoPlanoPdf)
  if (!texto) return []

  const out = []
  const seen = new Set()
  const re = new RegExp(RE_CHEQUE_BANCO_CHILE.source, 'gi')
  let m

  while ((m = re.exec(texto)) !== null) {
    const fecha = m[1]
    const nro_documento = m[2]
    const montoCol = m[3]
    const saldo_fmt = m[4]
    const bloque = m[0]
    const key = `${fecha}|${nro_documento}|${montoCol}|${saldo_fmt}`
    if (seen.has(key)) continue
    seen.add(key)

    const descripcion = descripcionDesdeBloque(bloque, fecha, nro_documento)
    const esCobrado = /cobrado/i.test(bloque)

    out.push({
      fecha,
      descripcion: descripcion.slice(0, 500),
      nro_documento,
      cargo_fmt: esCobrado ? null : montoCol,
      abono_fmt: esCobrado ? montoCol : null,
      saldo_fmt,
      cargo_aprox: esCobrado ? null : montoAEntero(montoCol),
      es_cheque: true,
    })
  }

  return out
}

function movimientosChequeDeCartola(movs) {
  return (movs || []).filter((m) => m.es_cheque && m.nro_documento)
}

/** Convierte fecha de cartola (DD/MM/YYYY) a YYYY-MM-DD para columnas DATE en PostgreSQL. */
function fechaCartolaAIsoDate(fecha) {
  if (fecha == null || fecha === '') return null
  const raw = String(fecha).trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const cl = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/)
  if (cl) return `${cl[3]}-${cl[2]}-${cl[1]}`
  return null
}

module.exports = {
  parsearMovimientosCartolaPdfTexto,
  movimientosChequeDeCartola,
  fechaCartolaAIsoDate,
}
