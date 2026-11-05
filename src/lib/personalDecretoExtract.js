/**
 * Descarga PDF de personal_documentos, extrae texto (pdf-parse) o OCR (gs+tesseract)
 * y parsea campos de decreto/resolución. Cachea en extraccion_json.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const axios = require('axios')
const pdfParse = require('pdf-parse')
const db = require('../db')
const { parseActoFromText, PARSER_VERSION } = require('./personalDecretoParse')

const execFileAsync = promisify(execFile)
const MIN_TEXT_CHARS = 80
const OCR_DPI = 180
const MAX_OCR_PAGES = 2

function run(cmd, args, opts = {}) {
  return execFileAsync(cmd, args, {
    timeout: opts.timeout || 90000,
    maxBuffer: 12 * 1024 * 1024,
    encoding: 'utf8',
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
    return String(parsed.text || '').trim()
  } catch {
    return ''
  }
}

async function ocrPdfBuffer(buf, stamp) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigex-dec-'))
  const pdfPath = path.join(dir, `${stamp}.pdf`)
  const pngPattern = path.join(dir, 'p-%d.png')
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
          '-sDEVICE=png16m',
          `-r${OCR_DPI}`,
          '-dFirstPage=1',
          `-dLastPage=${MAX_OCR_PAGES}`,
          `-sOutputFile=${pngPattern}`,
          pdfPath,
        ],
        { timeout: 120000 }
      )
    } catch (e) {
      return { text: '', error: `gs: ${e.message}` }
    }

    let text = ''
    for (let i = 1; i <= MAX_OCR_PAGES; i++) {
      const png = path.join(dir, `p-${i}.png`)
      if (!fs.existsSync(png)) continue
      // Preferir spa; fallback eng (Railway puede no tener spa.traineddata)
      let pageText = ''
      for (const lang of ['spa', 'eng']) {
        try {
          const { stdout } = await run('tesseract', [png, 'stdout', '-l', lang, '--psm', '6'], {
            timeout: 120000,
          })
          pageText = String(stdout || '')
          if (pageText.replace(/\s+/g, '').length > 40) break
        } catch {
          /* try next lang */
        }
      }
      text += `\n${pageText}`
    }
    return { text: text.trim(), error: null }
  } finally {
    try {
      for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
      fs.rmdirSync(dir)
    } catch {
      /* ignore */
    }
  }
}

async function extractTextFromPdfBuffer(buf, stamp) {
  let text = await textFromPdfParse(buf)
  let metodo = 'pdf-parse'
  if (text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
    const ocr = await ocrPdfBuffer(buf, stamp)
    if (ocr.text && ocr.text.replace(/\s+/g, '').length >= MIN_TEXT_CHARS) {
      text = ocr.text
      metodo = 'ocr-tesseract'
    } else if (!text) {
      text = ocr.text || ''
      metodo = ocr.error ? `ocr-fail:${ocr.error}` : 'ocr-vacio'
    }
  }
  return { text, metodo }
}

/**
 * Extrae campos de un documento; usa cache en personal_documentos.extraccion_json.
 * @param {{ id: string, nombre_archivo?: string, file_path?: string, extraccion_json?: object }} doc
 */
async function extraerCamposDocumento(doc, { force = false } = {}) {
  const cached = doc.extraccion_json
  const cacheOk =
    cached &&
    typeof cached === 'object' &&
    Number(cached.parser_version) >= PARSER_VERSION &&
    (cached.n_decreto || cached.fecha_inicio || cached.fecha_decreto || cached.metodo)
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
      metodo: 'sin-archivo',
      error: 'Sin file_path',
    }
  }

  try {
    const buf = await fetchPdfBuffer(doc.file_path)
    const { text, metodo } = await extractTextFromPdfBuffer(buf, String(doc.id).slice(0, 8))
    const parsed = parseActoFromText(text, doc.nombre_archivo)
    const result = {
      ...parsed,
      metodo,
      chars: (text || '').length,
      extracted_at: new Date().toISOString(),
    }

    try {
      await db.query(
        `UPDATE personal_documentos
         SET extraccion_json = $2::jsonb, extraccion_at = NOW()
         WHERE id = $1`,
        [doc.id, JSON.stringify(result)]
      )
    } catch (e) {
      // Columna puede no existir aún en algún entorno
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
      metodo: 'error',
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
  MIN_TEXT_CHARS,
}
