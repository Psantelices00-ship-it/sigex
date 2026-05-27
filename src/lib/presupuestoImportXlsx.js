const XLSX = require('xlsx')
const {
  buildCodigoCuenta,
  esCuentaImputable,
  milesAPesos,
} = require('./presupuestoCuenta')

const SUBTITULO_DEFAULT = '22'

/**
 * Parsea balance de ejecución (formato DAEM: fila 5 = encabezados, col A–K).
 * @param {Buffer} buffer
 * @param {{ subtitulo?: string }} opts
 */
function parseEjecucionPresupuestoXlsx(buffer, opts = {}) {
  const subtituloFiltro = String(opts.subtitulo || SUBTITULO_DEFAULT).trim()
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes('hoja')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  let fechaCorte = null
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const cell = rows[i] && rows[i][0]
    if (cell && String(cell).toUpperCase().includes('ACUMULADO')) {
      const m = String(cell).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (m) fechaCorte = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
  }
  if (!fechaCorte) fechaCorte = new Date().toISOString().slice(0, 10)

  const lineas = []
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue
    const sub = row[0] != null ? String(row[0]).trim() : ''
    if (sub !== subtituloFiltro) continue

    const item = row[1]
    const asig = row[2]
    const sasig = row[3]
    const subasig = row[4]
    const denominacion = row[5] != null ? String(row[5]).trim() : ''
    if (!denominacion) continue

    const codigo = buildCodigoCuenta(sub, item, asig, sasig, subasig)
    if (!codigo) continue

    lineas.push({
      subtitulo: sub,
      item: item != null ? String(item).trim() : '',
      asig: asig != null ? String(asig).trim() : '',
      sasig: sasig != null ? String(sasig).trim() : '',
      subasig: subasig != null ? String(subasig).trim() : '',
      codigo_cuenta: codigo,
      denominacion,
      presup_inicial: milesAPesos(row[6]),
      presup_vigente: milesAPesos(row[7]),
      devengado: milesAPesos(row[8]),
      saldo_oficial: milesAPesos(row[9]),
      deuda_exigible: milesAPesos(row[10]),
      es_imputable: esCuentaImputable(item, asig),
    })
  }

  const anio = parseInt(String(fechaCorte).slice(0, 4), 10) || new Date().getFullYear()

  return {
    anio,
    fecha_corte: fechaCorte,
    subtitulo_filtro: subtituloFiltro,
    lineas,
    total_lineas: lineas.length,
    imputables: lineas.filter((l) => l.es_imputable).length,
  }
}

module.exports = { parseEjecucionPresupuestoXlsx, SUBTITULO_DEFAULT }
