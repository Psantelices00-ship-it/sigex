/**
 * Extrae campos de un decreto/resolución de nombramiento desde texto (pdf-parse u OCR).
 * Tolerante a ruido típico de Tesseract (":" → "+", "N°" → "NP", etc.).
 */

const MESES = {
  ENERO: '01',
  FEBRERO: '02',
  MARZO: '03',
  ABRIL: '04',
  MAYO: '05',
  JUNIO: '06',
  JULIO: '07',
  AGOSTO: '08',
  SEPTIEMBRE: '09',
  SETIEMBRE: '09',
  OCTUBRE: '10',
  NOVIEMBRE: '11',
  DICIEMBRE: '12',
}

function ymd(v) {
  if (!v) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

function normalizarOcr(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/\+/g, ':')
    .replace(/\bNP\b/gi, 'N°')
    .replace(/\bNF\b/gi, 'N°')
    .replace(/\bNº\b/gi, 'N°')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFechaLarga(text) {
  const m = String(text || '').match(
    /(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+DE\s+(\d{4})/i
  )
  if (!m) return null
  const mm = MESES[String(m[2]).toUpperCase()]
  if (!mm) return null
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`
}

/**
 * @param {string} text
 * @param {string} [archivo]
 */
function parseActoFromText(text, archivo) {
  const raw = String(text || '')
  const t = normalizarOcr(raw)
  const u = t.toUpperCase()

  const out = {
    n_decreto: null,
    tipo_acto: null,
    fecha_decreto: null,
    fecha_inicio: null,
    fecha_termino: null,
    fecha_termino_texto: null,
    horas: null,
    establecimiento: null,
    extracto: t.slice(0, 500),
  }

  // Número: priorizar DECRETO DAEM / DECRETO (evitar RESOLUCIÓN del VISTOS, p.ej. "Resolución N° 6/2019")
  // OCR a veces deja basura entre DAEM y el número: "DECRETO DAEM No a OL 341"
  const decretoNum =
    u.match(/\bDECRETO\s+DAEM\b[^0-9]{0,30}?0*([0-9]{3,6})\b/) ||
    u.match(/\bDECRETO(?:\s+EXENTO)?\s*(?:N[°ºO.]?\s*)?[:.]?\s*0*([0-9]{1,6})\b/) ||
    u.match(/\bDTO\.?\s*(?:N[°ºO.]?\s*)?[:.]?\s*0*([0-9]{1,6})\b/)

  if (decretoNum) {
    out.n_decreto = String(parseInt(decretoNum[1], 10))
    out.tipo_acto = 'Decreto'
  } else if (/\bDECRETO\b/.test(u) === false || /RESOLUC|REX/i.test(String(archivo || ''))) {
    // Resolución solo si no hay DECRETO en el texto o el archivo es resolución
    const resNum = u.match(
      /\b(?:RESOLUC(?:I[OÓ]N)?(?:\s+EXENTA)?|REX\.?|RES\.?\s*EX\.?)\s*(?:N[°ºO.]?\s*)?[:.]?\s*0*([0-9]{1,6})\b/
    )
    const ctx = resNum
      ? u.slice(Math.max(0, resNum.index || 0), (resNum.index || 0) + 30)
      : ''
    // Ignorar "RESOLUCIÓN N° 6/29-03-2019" del VISTOS
    if (resNum && !/\/\s*\d{1,2}/.test(ctx)) {
      out.n_decreto = String(parseInt(resNum[1], 10))
      out.tipo_acto = 'Resolución'
    }
  }

  if (!out.n_decreto && archivo) {
    const fm =
      String(archivo).match(/^(\d{7,8})(?:-[0-9Kk])?_.+_(\d+)\.pdf$/i) ||
      String(archivo).match(/^(\d{7,8})(?:-[0-9Kk])?_(\d+)\.pdf$/i)
    if (fm) {
      out.n_decreto = String(parseInt(fm[2], 10))
      out.tipo_acto = out.tipo_acto || 'Resolución/Decreto'
    }
  }

  // Fecha del acto: "TALCAHUANO 15 DE MARZO DE 2023" / DE FECHA
  out.fecha_decreto =
    parseFechaLarga(
      (u.match(/TALCAHUANO[,\s]+(?:A\s+)?(.{0,40}?DE\s+\d{4})/i) || [])[0] ||
        (u.match(/(?:DE\s+FECHA|FECHA)[:\s]+(.{0,40}?DE\s+\d{4})/i) || [])[0] ||
        u
    ) || null

  if (!out.fecha_decreto) {
    const fechaCtx = t.match(/(?:DE\s+FECHA|FECHA[:\s]|TALCAHUANO[,\s]+A?)\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i)
    if (fechaCtx) out.fecha_decreto = ymd(`${fechaCtx[1]}/${fechaCtx[2]}/${fechaCtx[3]}`)
  }

  // FECHA DE INICIO : 07/03/2023
  const ini =
    t.match(/FECHA\s+DE\s+INICIO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
    t.match(/(?:DESDE|A\s+CONTAR(?:\s+DEL)?)\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
  if (ini) out.fecha_inicio = ymd(ini[1])

  // FECHA DE TÉRMINO : 28/02/2024  ó  "TERMINO DE LICENCIA MEDICA"
  const terFecha = t.match(
    /FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i
  )
  if (terFecha) {
    out.fecha_termino = ymd(terFecha[1])
  } else {
    const terTxt = t.match(/FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9\s./-]{3,60})/i)
    if (terTxt) {
      const frase = terTxt[1].replace(/\s+/g, ' ').trim().slice(0, 80)
      // Evitar arrastrar la siguiente etiqueta
      out.fecha_termino_texto = frase.split(/\s+FIANZA|\s+AN[OÓ]TESE|\s+COMUNIQUESE/i)[0].trim()
    }
  }

  // Período genérico desde-hasta si faltan etiquetas
  if (!out.fecha_inicio || !out.fecha_termino) {
    const per =
      t.match(
        /(?:DESDE|A\s+CONTAR|VIGENCIA|PER[IÍ]ODO)[^\d]{0,40}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})[^\d]{0,40}(?:HASTA|AL|A)[^\d]{0,20}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i
      ) ||
      t.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s*(?:AL|A|HASTA)\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
    if (per) {
      if (!out.fecha_inicio) out.fecha_inicio = ymd(per[1])
      if (!out.fecha_termino) out.fecha_termino = ymd(per[2])
    }
  }

  // JORNADA : 18 HORAS
  const h =
    t.match(/JORNADA\s*[:.]?\s*(\d{1,2})\s*HORAS?/i) ||
    t.match(/(\d{1,2})\s*(?:HORAS?\s*(?:CRONOL[OÓ]GICAS|PEDAG[OÓ]GICAS|SEMANALES)?|HRS?\.?)/i) ||
    t.match(/(?:CARGA\s*HORARIA)[^\d]{0,20}(\d{1,2})/i)
  if (h) {
    const n = Number(h[1])
    if (n > 0 && n <= 44) out.horas = n
  }

  const est =
    t.match(
      /ESTAB(?:\.|LECIMIENTO)?\s*(?:EDUCACIONAL)?\s*[:.]?\s*([A-Z0-9ÁÉÍÓÚÑ][A-Z0-9ÁÉÍÓÚÑ\s.\-]{2,60}?)(?=\s+RAZ[OÓ]N|\s+FECHA\s+DE|\s+FIANZA|\s+JORNADA|$)/i
    ) ||
    t.match(/\b(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40}?)(?=\s+RAZ[OÓ]N|\s+FECHA\s+DE|\s+FIANZA|$)/i) ||
    t.match(/\b(LICEO\s+[A-Z0-9ÁÉÍÓÚÑ][A-Z0-9ÁÉÍÓÚÑ\s.\-]{2,50}?)(?=\s+RAZ[OÓ]N|\s+FECHA\s+DE|$)/i)
  if (est) {
    out.establecimiento = est[1].replace(/\s+/g, ' ').trim().slice(0, 100)
  }

  if (!out.tipo_acto) {
    if (/RESOLUC|REX/i.test(u)) out.tipo_acto = 'Resolución'
    else if (/DECRETO/i.test(u) || /DECRETO/i.test(String(archivo || ''))) out.tipo_acto = 'Decreto'
  }

  return out
}

module.exports = {
  parseActoFromText,
  normalizarOcr,
  ymd,
}
