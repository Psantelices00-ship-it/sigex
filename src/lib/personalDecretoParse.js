/**
 * Extracción fidedigna de decretos/resoluciones de nombramiento.
 *
 * Estrategia:
 * 1) Plantilla DECRETO DAEM (formulario municipal etiquetado)
 * 2) Plantilla RESOLUCIÓN FINAL (Administrador Provisional)
 * 3) Heurísticas de respaldo
 *
 * Nunca tomar N° del VISTOS (Resolución Exenta de la Superintendencia).
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

/** Subir para invalidar extraccion_json en caché. */
const PARSER_VERSION = 3

function normMes(m) {
  return String(m || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function fechaLarga(dia, mesNombre, anio) {
  const mm = MESES[normMes(mesNombre)]
  if (!mm || !anio) return null
  const d = String(dia).padStart(2, '0')
  return `${anio}-${mm}-${d}`
}

function ymdSlash(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function normalizarTexto(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/\+/g, ':')
    .replace(/\bNP\b/gi, 'N°')
    .replace(/\bNF\b/gi, 'N°')
    .replace(/\bNº\b/gi, 'N°')
    .replace(/\bFIIANZA\b/gi, 'FIANZA')
    .replace(/\bPRPOF\b/gi, 'PROF')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Texto en una sola línea (útil para formularios en 2 columnas). */
function unaLinea(text) {
  return normalizarTexto(text).replace(/\s*\n\s*/g, ' ')
}

function nDesdeNombreArchivo(archivo) {
  const name = String(archivo || '').trim()
  let m = name.match(/^(\d{7,8})(?:-[0-9Kk])?_.+_(\d+)\.pdf$/i)
  if (m) return String(parseInt(m[2], 10))
  m = name.match(/^(\d{7,8})(?:-[0-9Kk])?_(\d+)\.pdf$/i)
  if (m) return String(parseInt(m[2], 10))
  return null
}

function todasFechasLargas(text) {
  const re =
    /(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/gi
  const out = []
  let m
  while ((m = re.exec(text))) {
    out.push({
      iso: fechaLarga(m[1], m[2], m[3]),
      index: m.index,
      raw: m[0],
    })
  }
  return out.filter((x) => x.iso)
}

function vacio() {
  return {
    n_decreto: null,
    tipo_acto: null,
    fecha_decreto: null,
    fecha_inicio: null,
    fecha_termino: null,
    fecha_termino_texto: null,
    horas: null,
    establecimiento: null,
    plantilla: null,
    confianza: 0,
    extracto: '',
    parser_version: PARSER_VERSION,
  }
}

/**
 * Formulario DAEM: etiquetas a la izquierda, valores con ":" (a veces linealizados).
 * Ejemplo real: FECHA DE INICIO … : 01 DE MARZO DE 2025 : 28 DE FEBRERO DE 2026
 */
function parsePlantillaDaem(text, archivo) {
  const raw = normalizarTexto(text)
  const line = unaLinea(text)
  const U = line.toUpperCase()
  if (!/DECRETO\s+DAEM|DESIGNA\s+PERSONAL\s+DOCENTE|FECHA\s+DE\s+INICIO/i.test(U)) {
    return null
  }

  const out = vacio()
  out.plantilla = 'daem'
  out.tipo_acto = 'Decreto'
  out.extracto = line.slice(0, 500)

  // N°: DECRETO DAEM N° 522 (o OCR ruidoso)
  const n =
    U.match(/\bDECRETO\s+DAEM\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/) ||
    U.match(/\bDECRETO\s+DAEM\b[^0-9]{0,30}?0*([0-9]{3,6})\b/) ||
    U.match(/\bDECRETO\s+ALCALDICIO\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/)
  if (n) out.n_decreto = String(parseInt(n[1], 10))
  else if (nDesdeNombreArchivo(archivo)) out.n_decreto = nDesdeNombreArchivo(archivo)

  // Fecha decreto: TALCAHUANO, 03 DE MARZO DE 2025
  const fd = U.match(
    /TALCAHUANO[,\s]+(?:A\s+)?(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (fd) out.fecha_decreto = fechaLarga(fd[1], fd[2], fd[3])

  // Valores tras ":" en orden típico del formulario (después del bloque DECRETO:)
  const bloqueMatch = line.match(/DECRETO\s*:?\s*(?:DESIGNACI[OÓ]N|DESIGNASE|DES[IÍ]GNASE)?([\s\S]{20,1200}?)(?:ANOTESE|AN[OÓ]TESE|COMUNIQUESE|DISTRIBUC)/i)
  const bloque = bloqueMatch ? bloqueMatch[1] : line
  const valores = [...bloque.matchAll(/:\s*([^:]{2,120}?)(?=\s*:|$)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())

  // Buscar jornada / establecimiento / fechas en la lista de valores
  for (const v of valores) {
    const vu = v.toUpperCase()
    if (!out.horas) {
      const hm = vu.match(/^(\d{1,2})\s*HORAS?\b/)
      if (hm) {
        const nH = Number(hm[1])
        if (nH >= 1 && nH <= 44) out.horas = nH
      }
    }
    if (!out.establecimiento && /\bF-?\d{2,4}\b/i.test(v)) {
      out.establecimiento = v.replace(/\s+/g, ' ').trim().slice(0, 100)
    }
    if (!out.fecha_inicio) {
      const fm = v.match(
        /^(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})$/i
      )
      if (fm) out.fecha_inicio = fechaLarga(fm[1], fm[2], fm[3])
      else if (ymdSlash(v)) out.fecha_inicio = ymdSlash(v)
    } else if (!out.fecha_termino) {
      const fm = v.match(
        /^(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})$/i
      )
      if (fm) out.fecha_termino = fechaLarga(fm[1], fm[2], fm[3])
      else if (ymdSlash(v)) out.fecha_termino = ymdSlash(v)
      else if (/TERMINO\s+DE\s+LICENCIA|HASTA\s+EL\s+TERMINO|FIN\s+DE\s+LICENCIA/i.test(v)) {
        out.fecha_termino_texto = v.slice(0, 80)
      }
    }
  }

  // Etiquetas en la misma línea (OCR limpio): FECHA DE INICIO : 07/03/2023
  if (!out.fecha_inicio) {
    const iniSlash = line.match(/FECHA\s+DE\s+INICIO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
    if (iniSlash) out.fecha_inicio = ymdSlash(iniSlash[1])
  }
  if (!out.fecha_inicio) {
    const iniLarga = line.match(
      /FECHA\s+DE\s+INICIO\s*[:.]?\s*(\d{1,2}\s+DE\s+(?:ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+\d{4})/i
    )
    if (iniLarga) {
      const fm = iniLarga[1].match(
        /(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
      )
      if (fm) out.fecha_inicio = fechaLarga(fm[1], fm[2], fm[3])
    }
  }

  if (!out.fecha_termino) {
    const terSlash = line.match(/FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
    if (terSlash) out.fecha_termino = ymdSlash(terSlash[1])
  }
  if (!out.fecha_termino) {
    const terLarga = line.match(
      /FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*(\d{1,2}\s+DE\s+(?:ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+\d{4})/i
    )
    if (terLarga) {
      const fm = terLarga[1].match(
        /(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
      )
      if (fm) out.fecha_termino = fechaLarga(fm[1], fm[2], fm[3])
    }
  }

  // Respaldo: fechas largas después de la etiqueta
  if (!out.fecha_inicio || !out.fecha_termino) {
    const fechas = todasFechasLargas(U)
    const idxIni = U.search(/FECHA\s+DE\s+INICIO/i)
    const candidatas = idxIni >= 0 ? fechas.filter((f) => f.index > idxIni - 20) : fechas.slice(1)
    if (!out.fecha_inicio && candidatas[0]) out.fecha_inicio = candidatas[0].iso
    if (!out.fecha_termino && candidatas[1]) out.fecha_termino = candidatas[1].iso
  }

  // Término textual (licencia, etc.)
  if (!out.fecha_termino) {
    const ter = line.match(
      /FECHA\s+DE\s+T[EÉ]RMINO\s*[:.]?\s*(TERMINO\s+DE\s+LICENCIA(?:\s+MEDICA)?)/i
    )
    if (ter) out.fecha_termino_texto = ter[1].replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  // Sanidad de fechas (evitar basura OCR de consolidados)
  const añoOk = (iso) => {
    if (!iso) return true
    const y = Number(String(iso).slice(0, 4))
    return y >= 2015 && y <= 2035
  }
  if (!añoOk(out.fecha_inicio)) out.fecha_inicio = null
  if (!añoOk(out.fecha_termino)) out.fecha_termino = null
  if (!añoOk(out.fecha_decreto)) out.fecha_decreto = null

  if (!out.horas) {
    const hm = U.match(/JORNADA[^0-9]{0,20}(\d{1,2})\s*HORAS?/i) || U.match(/:\s*(\d{1,2})\s*HORAS?\b/i)
    if (hm) {
      const nH = Number(hm[1])
      if (nH >= 1 && nH <= 44) out.horas = nH
    }
  }

  if (!out.establecimiento) {
    const em = line.match(
      /ESTAB(?:\.|LECIMIENTO)?\s*(?:EDUCACIONAL)?\s*[:.]?\s*(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40})/i
    ) || U.match(/\b(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40})\b/i)
    if (em) {
      out.establecimiento = em[1]
        .replace(/\s+/g, ' ')
        .split(/\s+RAZ[OÓ]N|\s+NEC\.|\s+FECHA|\s+FIANZA|\s+JORNADA/i)[0]
        .trim()
        .slice(0, 100)
    }
  }
  if (out.establecimiento) {
    out.establecimiento = out.establecimiento
      .split(/\s+RAZ[OÓ]N|\s+NEC\.|\s+FECHA|\s+FIANZA/i)[0]
      .trim()
  }

  // Confianza
  let c = 0
  if (out.n_decreto) c += 25
  if (out.fecha_decreto) c += 15
  if (out.fecha_inicio) c += 30
  if (out.fecha_termino || out.fecha_termino_texto) c += 20
  if (out.horas) c += 10
  out.confianza = c

  return out.confianza >= 40 ? out : out // devolver igual; el score decide afuera
}

/**
 * RESOLUCIÓN FINAL N° … del Administrador Provisional.
 */
function parsePlantillaResolucionFinal(text, archivo) {
  const line = unaLinea(text)
  const U = line.toUpperCase()
  if (!/RESOLUC(?:I[OÓ]N)?\s+FINAL|RESUELVO\s*:|PER[IÍ]ODO\s+DE\s+VIGENCIA/i.test(U)) {
    return null
  }

  const out = vacio()
  out.plantilla = 'resolucion_final'
  out.tipo_acto = 'Resolución'
  out.extracto = line.slice(0, 500)

  const resFinal = U.match(/\bRESOLUC(?:I[OÓ]N)?\s+FINAL\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/)
  const nArchivo = nDesdeNombreArchivo(archivo)
  if (resFinal) out.n_decreto = String(parseInt(resFinal[1], 10))
  else if (nArchivo) out.n_decreto = nArchivo

  // Preferir archivo si FINAL no matcheó y hay N° en nombre
  if (nArchivo && !resFinal) out.n_decreto = nArchivo

  const fd = U.match(
    /TALCAHUANO[,\s]+(?:A\s+)?(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (fd) out.fecha_decreto = fechaLarga(fd[1], fd[2], fd[3])

  const vigencia = U.match(
    /PER[IÍ]ODO\s+DE\s+VIGENCIA\s*[:.]?\s*(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})\s+AL\s+(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (vigencia) {
    out.fecha_inicio = fechaLarga(vigencia[1], vigencia[2], vigencia[3])
    out.fecha_termino = fechaLarga(vigencia[4], vigencia[5], vigencia[6])
  }

  const hm =
    U.match(/HORAS?\s*CRONOL[OÓ]GICAS?\s*SEMANALES?\s*[:.]?\s*(\d{1,2})/i) ||
    U.match(/\b(\d{1,2})\s*HRS?\.?\b/)
  if (hm) {
    const nH = Number(hm[1])
    // Evitar "1." de "1.RATIFIQUESE"
    if (nH >= 2 && nH <= 44) out.horas = nH
    else if (nH === 1 && /HORAS?\s*CRONOL|HRS/i.test(U)) out.horas = 1
  }

  const em = U.match(/\b(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40}?)(?=\s+[A-Za-z]\)|\s+JORNADA|\s+NIVEL|\s+CALIDAD|\s+PER[IÍ]ODO|$)/i)
  if (em) out.establecimiento = em[1].replace(/\s+/g, ' ').trim().slice(0, 100)

  let c = 0
  if (out.n_decreto) c += 25
  if (out.fecha_decreto) c += 15
  if (out.fecha_inicio) c += 30
  if (out.fecha_termino) c += 20
  if (out.horas) c += 10
  out.confianza = c
  return out
}

function parseHeuristico(text, archivo) {
  const line = unaLinea(text)
  const U = line.toUpperCase()
  const out = vacio()
  out.plantilla = 'heuristica'
  out.extracto = line.slice(0, 500)

  const nArchivo = nDesdeNombreArchivo(archivo)
  const decretoDaem =
    U.match(/\bDECRETO\s+DAEM\b[^0-9]{0,30}?0*([0-9]{3,6})\b/) ||
    U.match(/\bDECRETO(?:\s+EXENTO)?\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/)
  const resFinal = U.match(/\bRESOLUC(?:I[OÓ]N)?\s+FINAL\s*N[°ºO.]?\s*0*([0-9]{1,6})\b/)

  if (resFinal) {
    out.n_decreto = String(parseInt(resFinal[1], 10))
    out.tipo_acto = 'Resolución'
  } else if (decretoDaem) {
    out.n_decreto = String(parseInt(decretoDaem[1], 10))
    out.tipo_acto = 'Decreto'
  } else if (nArchivo) {
    out.n_decreto = nArchivo
    out.tipo_acto = /\bDECRETO\b/i.test(String(archivo || '')) ? 'Decreto' : 'Resolución'
  }

  const fd = U.match(
    /TALCAHUANO[,\s]+(?:A\s+)?(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (fd) out.fecha_decreto = fechaLarga(fd[1], fd[2], fd[3])

  const vigencia = U.match(
    /PER[IÍ]ODO\s+DE\s+VIGENCIA\s*[:.]?\s*(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})\s+AL\s+(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(?:DE|DEL)\s+(\d{4})/i
  )
  if (vigencia) {
    out.fecha_inicio = fechaLarga(vigencia[1], vigencia[2], vigencia[3])
    out.fecha_termino = fechaLarga(vigencia[4], vigencia[5], vigencia[6])
  }

  const ini = line.match(/FECHA\s+DE\s+INICIO\s*[:.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i)
  if (ini) out.fecha_inicio = out.fecha_inicio || ymdSlash(ini[1])

  const fechas = todasFechasLargas(U)
  if (!out.fecha_inicio && fechas.length >= 2) out.fecha_inicio = fechas[1].iso
  if (!out.fecha_termino && fechas.length >= 3) out.fecha_termino = fechas[2].iso

  const hm = U.match(/JORNADA[^0-9]{0,20}(\d{1,2})\s*HORAS?/i) || U.match(/HORAS?\s*CRONOL[OÓ]GICAS?\s*SEMANALES?\s*[:.]?\s*(\d{1,2})/i)
  if (hm) {
    const nH = Number(hm[1])
    if (nH >= 1 && nH <= 44) out.horas = nH
  }

  const em = U.match(/\b(F-?\d{2,4}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\-]{2,40}?)\b/i)
  if (em) out.establecimiento = em[1].replace(/\s+/g, ' ').trim().slice(0, 100)

  let c = 0
  if (out.n_decreto) c += 20
  if (out.fecha_decreto) c += 10
  if (out.fecha_inicio) c += 30
  if (out.fecha_termino || out.fecha_termino_texto) c += 20
  if (out.horas) c += 10
  out.confianza = c
  return out
}

/**
 * Elige la mejor interpretación entre plantillas.
 */
function parseActoFromText(text, archivo) {
  const candidatos = []
  const daem = parsePlantillaDaem(text, archivo)
  if (daem) candidatos.push(daem)
  const res = parsePlantillaResolucionFinal(text, archivo)
  if (res) candidatos.push(res)
  candidatos.push(parseHeuristico(text, archivo))

  candidatos.sort((a, b) => (b.confianza || 0) - (a.confianza || 0))
  const best = candidatos[0] || vacio()
  best.parser_version = PARSER_VERSION
  if (!best.extracto) best.extracto = unaLinea(text).slice(0, 500)

  // Si el nombre de archivo trae N° y la plantilla no es FINAL/DAEM clara, alinear
  const nArchivo = nDesdeNombreArchivo(archivo)
  if (nArchivo && best.plantilla === 'heuristica' && !best.n_decreto) best.n_decreto = nArchivo

  return best
}

/** Ratio de caracteres “raros” → texto basura de OCR embebido. */
function textoEsBasura(text) {
  const s = String(text || '')
  if (s.replace(/\s+/g, '').length < 40) return true
  const raro = (s.match(/[^\w\sÁÉÍÓÚÑáéíóúñ°º.,;:()\-\/°#"']/g) || []).length
  const letters = (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length
  if (letters < 30) return true
  return raro / Math.max(s.length, 1) > 0.12
}

module.exports = {
  parseActoFromText,
  parsePlantillaDaem,
  parsePlantillaResolucionFinal,
  normalizarTexto,
  unaLinea,
  ymd: ymdSlash,
  nDesdeNombreArchivo,
  textoEsBasura,
  PARSER_VERSION,
}
