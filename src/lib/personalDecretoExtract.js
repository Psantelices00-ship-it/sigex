/**
 * Descarga PDF → texto limpio (pdf-parse) o OCR (gs + tesseract spa/eng) → parse por plantilla.
 * Invalida texto basura embebido y cachea resultado con parser_version.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const axios = require('axios')
const pdfParse = require('pdf-parse')
const db = require('../db')
const {
  parseActoFromText,
  textoEsBasura,
  PARSER_VERSION,
} = require('./personalDecretoParse')

const execFileAsync = promisify(execFile)
const MIN_TEXT_CHARS = 60
const OCR_DPI = 280
const MAX_OCR_PAGES = 3

/** Carpeta tessdata del repo (spa + eng). */
function tessdataDir() {
  const candidates = [
    path.join(__dirname, '../../tessdata'),
    path.join(process.cwd(), 'tessdata'),
    process.env.TESSDATA_PREFIX,
  ].filter(Boolean)
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'eng.traineddata'))) return c
    if (c && fs.existsSync(path.join(c, 'spa.traineddata'))) return c
  }
  return null
}

function run(cmd, args, opts = {}) {
  return execFileAsync(cmd, args, {
    timeout: opts.timeout || 120000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    ...opts,
  })
}

async function fetchPdfBuffer(filePath) {
  const res = await axios.get(String(filePath).trim(), {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  })
  return Buffer.from(res.data)
}

async function textFromPdfParse(buf) {
  try {
    const parsed = await pdfParse(buf)
    return {
      text: String(parsed.text || '').trim(),
      pages: parsed.numpages || parsed.n || null,
    }
  } catch {
    return { text: '', pages: null }
  }
}

async function ocrPdfBuffer(buf, stamp) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigex-dec-'))
  const pdfPath = path.join(dir, `${stamp}.pdf`)
  const pngPattern = path.join(dir, 'p-%d.png')
  const tessDir = tessdataDir()
  const env = tessDir ? { ...process.env, TESSDATA_PREFIX: tessDir } : process.env

  try {
    fs.writeFileSync(pdfPath, buf)
    try {
      await run(
        'gs',
        [
          '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-dQUIET',
          '-sDEVICE=pnggray',
          `-r${OCR_DPI}`,
          '-dFirstPage=1',
          `-dLastPage=${MAX_OCR_PAGES}`,
          `-sOutputFile=${pngPattern}`,
          pdfPath,
        ],
        { timeout: 180000 }
      )
    } catch (e) {
      return { text: '', error: `gs: ${e.message}`, metodo: 'ocr-fail-gs' }
    }

    let text = ''
    const langs = []
    if (tessDir && fs.existsSync(path.join(tessDir, 'spa.traineddata'))) langs.push('spa')
    if (tessDir && fs.existsSync(path.join(tessDir, 'eng.traineddata'))) langs.push('eng')
    if (!langs.length) langs.push('eng')

    for (let i = 1; i <= MAX_OCR_PAGES; i++) {
      const png = path.join(dir, `p-${i}.png`)
      if (!fs.existsSync(png)) continue

      // Preprocesar contraste si ImageMagick está disponible
      let img = png
      const prep = path.join(dir, `p-${i}-prep.png`)
      try {
        await run(
          'convert',
          [png, '-colorspace', 'Gray', '-normalize', '-sharpen', '0x1', prep],
          { timeout: 30000 }
        )
        if (fs.existsSync(prep)) img = prep
      } catch {
        /* gs png ya es gray */
      }

      let pageText = ''
      for (const lang of langs) {
        try {
          const { stdout } = await run(
            'tesseract',
            [img, 'stdout', '-l', lang, '--psm', '6', '--oem', '1'],
            { timeout: 180000, env }
          )
          const t = String(stdout || '')
          if (t.replace(/\s+/g, '').length > pageText.replace(/\s+/g, '').length) pageText = t
          if (!textoEsBasura(t) && t.replace(/\s+/g, '').length > 80) break
        } catch {
          /* next lang */
        }
      }
      text += `\n${pageText}`
    }

    return {
      text: text.trim(),
      error: null,
      metodo: 'ocr-tesseract',
      tessdata: tessDir || 'system',
      langs,
    }
  } finally {
    try {
      for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
      fs.rmdirSync(dir)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Obtiene el mejor texto posible del PDF.
 */
async function extractTextFromPdfBuffer(buf, stamp) {
  const parsed = await textFromPdfParse(buf)
  let text = parsed.text
  let metodo = 'pdf-parse'
  let pages = parsed.pages

  const basura = textoEsBasura(text)
  const corto = text.replace(/\s+/g, '').length < MIN_TEXT_CHARS

  if (basura || corto) {
    const ocr = await ocrPdfBuffer(buf, stamp)
    const ocrOk = ocr.text && !textoEsBasura(ocr.text) && ocr.text.replace(/\s+/g, '').length >= MIN_TEXT_CHARS
    if (ocrOk) {
      text = ocr.text
      metodo = ocr.metodo
    } else if (corto && ocr.text) {
      text = ocr.text
      metodo = ocr.metodo || 'ocr-debil'
    } else if (basura && !ocrOk) {
      // Mantener pdf-parse solo si OCR falló peor; marcar basura
      metodo = ocr.error ? `pdf-basura+${ocr.error}` : 'pdf-basura'
    }
  }

  return { text, metodo, pages }
}

async function extraerCamposDocumento(doc, { force = false } = {}) {
  const cached = doc.extraccion_json
  const cacheOk =
    cached &&
    typeof cached === 'object' &&
    Number(cached.parser_version) >= PARSER_VERSION &&
    Number(cached.confianza || 0) >= 50 &&
    (cached.fecha_inicio || (cached.n_decreto && cached.fecha_decreto))

  if (!force && cacheOk) {
    return { ...cached, desde_cache: true }
  }

  if (!doc.file_path) {
    return {
      n_decreto: null,
      fecha_decreto: null,
      fecha_inicio: null,
      fecha_termino: null,
      horas: null,
      confianza: 0,
      metodo: 'sin-archivo',
      parser_version: PARSER_VERSION,
      error: 'Sin file_path',
    }
  }

  try {
    const buf = await fetchPdfBuffer(doc.file_path)
    const { text, metodo, pages } = await extractTextFromPdfBuffer(buf, String(doc.id).slice(0, 8))
    const parsed = parseActoFromText(text, doc.nombre_archivo)

    // Si confianza baja y aún no OCR-eamos, forzar OCR
    let final = parsed
    let metodoFinal = metodo
    if ((parsed.confianza || 0) < 50 && !String(metodo).startsWith('ocr')) {
      const ocr = await ocrPdfBuffer(buf, `${String(doc.id).slice(0, 8)}b`)
      if (ocr.text && ocr.text.replace(/\s+/g, '').length >= MIN_TEXT_CHARS) {
        const parsedOcr = parseActoFromText(ocr.text, doc.nombre_archivo)
        if ((parsedOcr.confianza || 0) >= (parsed.confianza || 0)) {
          final = parsedOcr
          metodoFinal = ocr.metodo
        }
      }
    }

    const result = {
      ...final,
      metodo: metodoFinal,
      pages,
      chars: (text || '').length,
      extracted_at: new Date().toISOString(),
      parser_version: PARSER_VERSION,
    }

    try {
      await db.query(
        `UPDATE personal_documentos
         SET extraccion_json = $2::jsonb, extraccion_at = NOW()
         WHERE id = $1`,
        [doc.id, JSON.stringify(result)]
      )
    } catch (e) {
      if (!/extraccion_json|column/i.test(e.message || '')) throw e
    }

    return { ...result, desde_cache: false }
  } catch (e) {
    return {
      n_decreto: null,
      fecha_decreto: null,
      fecha_inicio: null,
      fecha_termino: null,
      horas: null,
      confianza: 0,
      metodo: 'error',
      parser_version: PARSER_VERSION,
      error: e.message || String(e),
    }
  }
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

module.exports = {
  extraerCamposDocumento,
  extractTextFromPdfBuffer,
  parseActoFromText,
  mapPool,
  tessdataDir,
  PARSER_VERSION,
  MIN_TEXT_CHARS,
}
