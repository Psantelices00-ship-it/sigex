/**
 * Extrae campos de un decreto/resolución de nombramiento desde texto (pdf-parse u OCR).
 * Prioridad del N°: nombre de archivo → RESOLUCIÓN FINAL / DECRETO DAEM → nunca el VISTOS.
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

/** Versión de parser: si sube, se invalida extraccion_json antigua. */
const PARSER_VERSION = 2

function ymd(v) {
  if (!v) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

function fechaLarga(dia, mesNombre, anio) {
  const mm = MESES[String(mesNombre || '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')]
  if (!mm || !anio) return null
  return `${anio}-${mm}-${String(dia).padStart(2, '0')}`
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

function nDesdeNombreArchivo(archivo) {
  const name = String(archivo || '').trim()
  let m = name.match(/^(\d{7,8})(?:-[0-9Kk])?_.+_(\d+)\.pdf$/i)
  if (m) return String(parseInt(m[2], 10))
  m = name.match(/^(\d{7,8})(?:-[0-9Kk])?_(\d+)\.pdf$/i)
  if (m) return String(parseInt(m[2], 10))
  return null
}

function parseFechaLargaEnTexto(text) {
  const m = String(text || '').match(
    /(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (!m) return null
  return fechaLarga(m[1], m[2], m[3])
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
    parser_version: PARSER_VERSION,
  }

  const nArchivo = nDesdeNombreArchivo(archivo)

  // 1) RESOLUCIÓN FINAL N° 01361 (encabezado del acto — NO el VISTOS)
  const resFinal =
    u.match(/\bRESOLUC(?:I[OÓ]N)?\s+FINAL\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/) ||
    u.match(/\bRESOLUC(?:I[OÓ]N)?\s+EXENTA\s+FINAL\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/)

  // 2) DECRETO DAEM (OCR puede meter basura: "DECRETO DAEM No a OL 341")
  const decretoDaem =
    u.match(/\bDECRETO\s+DAEM\b[^0-9]{0,30}?0*([0-9]{3,6})\b/) ||
    u.match(/\bDECRETO(?:\s+EXENTO)?\s*(?:N[°ºO.]?\s*)?[:.]?\s*0*([0-9]{1,6})\b/)

  if (resFinal) {
    out.n_decreto = String(parseInt(resFinal[1], 10))
    out.tipo_acto = 'Resolución'
  } else if (decretoDaem) {
    out.n_decreto = String(parseInt(decretoDaem[1], 10))
    out.tipo_acto = 'Decreto'
  } else if (nArchivo) {
    out.n_decreto = nArchivo
    out.tipo_acto = /RESOLUC|REX/i.test(String(archivo || ''))
      ? 'Resolución'
      : /\bDECRETO\b/i.test(String(archivo || ''))
        ? 'Decreto'
        : 'Resolución/Decreto'
  } else {
    // Último recurso: resolución/decreto que NO sea "Exenta … con fecha" del VISTOS
    const candidatos = [...u.matchAll(/\b(?:RESOLUC(?:I[OÓ]N)?|DECRETO|REX)\s*(?:EXENTA\s+)?(?:FINAL\s+)?N[°ºO.]?\s*0*([0-9]{1,6})\b/g)]
    for (const c of candidatos) {
      const ctx = u.slice(Math.max(0, c.index - 30), c.index + 50)
      if (/VISTOS|EXENTA\s+N[°º].{0,20}CON\s+FECHA|SUPERINTENDENCIA/i.test(ctx) && !/FINAL/i.test(ctx)) {
        continue
      }
      if (/\/\s*\d{1,2}/.test(ctx)) continue // N° 6/29-03-2019
      out.n_decreto = String(parseInt(c[1], 10))
      out.tipo_acto = /DECRETO/i.test(c[0]) ? 'Decreto' : 'Resolución'
      break
    }
  }

  // Si el archivo trae N° y el texto sacó otro (p.ej. 168 del VISTOS), preferir archivo
  if (nArchivo && out.n_decreto && nArchivo !== out.n_decreto) {
    // Solo override si el parseado parece del VISTOS (número chico o distinto al del nombre)
    if (!resFinal && !decretoDaem) {
      out.n_decreto = nArchivo
    }
  }
  if (nArchivo && !out.n_decreto) out.n_decreto = nArchivo

  // Fecha del acto: TALCAHUANO, 17 DE JUNIO DE 2026
  const ciudadFecha = u.match(
    /TALCAHUANO[,\s]+(?:A\s+)?(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (ciudadFecha) {
    out.fecha_decreto = fechaLarga(ciudadFecha[1], ciudadFecha[2], ciudadFecha[3])
  } else {
    out.fecha_decreto = parseFechaLargaEnTexto(u)
  }
  if (!out.fecha_decreto) {
    const fechaCtx = t.match(/(?:DE\s+FECHA|FECHA[:\s])\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i)
    if (fechaCtx) out.fecha_decreto = ymd(`${fechaCtx[1]}/${fechaCtx[2]}/${fechaCtx[3]}`)
  }

  // Periodo de vigencia: 01 de marzo del 2026 al 28 de febrero del 2027
  const vigencia = u.match(
    /PER[IÍ]ODO\s+DE\s+VIGENCIA\s*[:.]?\s*(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})\s+AL\s+(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (vigencia) {
    out.fecha_inicio = fechaLarga(vigencia[1], vigencia[2], vigencia[3])
    out.fecha_termino = fechaLarga(vigencia[4], vigencia[5], vigencia[6])
  }

  // FECHA DE INICIO / TÉRMINO etiquetadas (decretos DAEM)
  if (!out.fecha_inicio) {
    const ini =
      t.match(/FECHA\s+DE\s+INICIO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
      t.match(/(?:DESDE|A\s+CONTAR(?:\s+DEL)?)\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
    if (ini) out.fecha_inicio = ymd(ini[1])
  }

  if (!out.fecha_termino) {
    const terFecha = t.match(/FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
    if (terFecha) {
      out.fecha_termino = ymd(terFecha[1])
    } else {
      const terTxt = t.match(
        /FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9\s./-]{3,60})/i
      )
      if (terTxt) {
        out.fecha_termino_texto = terTxt[1]
          .replace(/\s+/g, ' ')
          .split(/\s+FIANZA|\s+AN[OÓ]TESE|\s+COMUNIQUESE/i)[0]
          .trim()
          .slice(0, 80)
      }
    }
  }

  // Período genérico dd/mm/yyyy al dd/mm/yyyy
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

  // Horas: "26 HRS" / "JORNADA : 18 HORAS" / "Nº De Horas Cronológicas Semanales: 26"
  const h =
    t.match(
      /(?:N[°º]?\s*DE\s*)?HORAS?\s*CRONOL[OÓ]GICAS?\s*SEMANALES?\s*[:.]?\s*(\d{1,2})\s*(?:HRS?\.?|HORAS?)?/i
    ) ||
    t.match(/JORNADA\s*[:.]?\s*(\d{1,2})\s*HORAS?/i) ||
    t.match(/(\d{1,2})\s*(?:HRS?\.?|HORAS?)(?:\s*CRONOL|\s*SEMANALES|\s*$|\s*[,.])/i) ||
    t.match(/(?:CARGA\s*HORARIA)[^\d]{0,20}(\d{1,2})/i)
  if (h) {
    const n = Number(h[1])
    if (n > 0 && n <= 44) out.horas = n
  }

  // Preferir código de colegio (F-509 …) / Liceo; evitar "establecimiento educacional" del VISTOS
  const est =
    t.match(/\b(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40}?)(?=\s+[A-Za-z]\)|\s+RAZ[OÓ]N|\s+FECHA\s+DE|\s+JORNADA|\s+NIVEL|\s+CALIDAD|\s+FIANZA|$)/i) ||
    t.match(
      /(?:^|\n|[A-Za-z]\))\s*ESTABLECIMIENTO\s*[:.]?\s*((?:F-?\d{2,4}|LICEO|COLEGIO|ESCUELA)[^.\n]{2,60}?)(?=\s+[A-Za-z]\)|\s+JORNADA|\s+NIVEL|\s+CALIDAD|\s+PER[IÍ]ODO|$)/i
    ) ||
    t.match(
      /ESTAB(?:\.|LECIMIENTO)?\s*(?:EDUCACIONAL)?\s*[:.]?\s*((?:F-?\d{2,4}|LICEO|COLEGIO)[A-Z0-9ÁÉÍÓÚÑ\s.\-]{2,50}?)(?=\s+RAZ[OÓ]N|\s+FECHA\s+DE|\s+FIANZA|\s+JORNADA|$)/i
    ) ||
    t.match(/\b(LICEO\s+[A-Z0-9ÁÉÍÓÚÑ][A-Z0-9ÁÉÍÓÚÑ\s.\-]{2,50}?)(?=\s+RAZ[OÓ]N|\s+FECHA\s+DE|$)/i)
  if (est) {
    out.establecimiento = est[1].replace(/\s+/g, ' ').trim().slice(0, 100)
  }

  if (!out.tipo_acto) {
    if (/RESOLUC|REX/i.test(u) || /RESOLUC|REX/i.test(String(archivo || ''))) out.tipo_acto = 'Resolución'
    else if (/DECRETO/i.test(u) || /DECRETO/i.test(String(archivo || ''))) out.tipo_acto = 'Decreto'
  }

  return out
}

module.exports = {
  parseActoFromText,
  normalizarOcr,
  ymd,
  nDesdeNombreArchivo,
  PARSER_VERSION,
}
