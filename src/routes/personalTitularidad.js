/**
 * Titularidad docente (Ley 21.803) — solo lectura.
 * GET /api/personal/titularidad/datos?rut=19.123.357-3
 *
 * Devuelve funcionario, decretos/resoluciones con campos extraídos del PDF (OCR si hace falta),
 * liquidaciones y licencias para armar la ficha en el frontend.
 */
const router = require('express').Router()
const db = require('../db')
const auth = require('../middleware/auth')
const { normalizeRutParts, formatearRut } = require('../lib/rutChileno')
const { requireAccesoPersonal } = require('../lib/personalPermisos')
const { etiquetaPeriodo } = require('../lib/personalLiquidacionParse')
const { tipoDocumentalLabel } = require('../lib/personalDocTypes')
const { extraerCamposDocumento, mapPool, PARSER_VERSION } = require('../lib/personalDecretoExtract')

const TIPOS_ACTO = new Set(['resolucion_nombramiento', 'consolidado_antiguo', 'contrato'])

function resolveRut(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const parts = normalizeRutParts(raw)
  return parts?.rut_normalizado || null
}

function esDocActo(doc) {
  if (TIPOS_ACTO.has(doc.tipo_documental)) return true
  const u = String(doc.nombre_archivo || '').toUpperCase()
  return /\bDECRETO\b/.test(u) || /RESOLUC|NOMBRAMIENTO|REX/.test(u)
}

function labelTipo(tipo, nombre, parsedTipo) {
  if (parsedTipo) return parsedTipo
  const t = String(tipo || '')
  const u = String(nombre || '').toUpperCase()
  if (t === 'resolucion_nombramiento' || /RESOLUC|REX/.test(u)) return 'Resolución'
  if (t === 'consolidado_antiguo' || /\bDECRETO\b/.test(u)) return 'Decreto'
  if (t === 'contrato') return 'Contrato'
  return 'Documento'
}

/** GET /titularidad/datos */
router.get('/titularidad/datos', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return

    const rutN = resolveRut(req.query?.rut)
    if (!rutN) return res.status(400).json({ error: 'Indicá un RUT válido' })

    const force = String(req.query?.force || '') === '1'

    const funcR = await db.query(
      `SELECT id, rut_normalizado, rut_numero, rut_dv, nombre_completo, tipo_funcionario,
              estado_laboral, activo, planta, ubicacion, tipo_contrato, fecha_ingreso, profesion
       FROM personal_funcionarios WHERE rut_normalizado = $1`,
      [rutN]
    )
    if (!funcR.rows.length) return res.status(404).json({ error: 'Funcionario no encontrado' })
    const f = funcR.rows[0]

    const [docsR, liqR, licR] = await Promise.all([
      db.query(
        `SELECT id, tipo_documental, nombre_archivo, file_path, estado, origen_carga, created_at,
                extraccion_json, extraccion_at
         FROM personal_documentos
         WHERE funcionario_id = $1 AND es_activo = TRUE
         ORDER BY created_at DESC`,
        [f.id]
      ).catch(async (err) => {
        if (!/extraccion_json/i.test(err.message || '')) throw err
        return db.query(
          `SELECT id, tipo_documental, nombre_archivo, file_path, estado, origen_carga, created_at
           FROM personal_documentos
           WHERE funcionario_id = $1 AND es_activo = TRUE
           ORDER BY created_at DESC`,
          [f.id]
        )
      }),
      db.query(
        `SELECT lr.id, lr.pagina, lr.cargo, lr.establecimiento, p.mes, p.anio, p.etiqueta
         FROM personal_liquidaciones_registros lr
         JOIN personal_liquidaciones_periodos p ON p.id = lr.periodo_id
         WHERE p.estado = 'completo'
           AND (lr.funcionario_id = $1 OR lr.rut_normalizado = $2)
           AND (p.anio > 2019 OR (p.anio = 2019 AND p.mes >= 1))
         ORDER BY p.anio ASC, p.mes ASC`,
        [f.id, f.rut_normalizado]
      ),
      db.query(
        `SELECT id, numero_licencia, fecha_tramitacion, fecha_inicio, fecha_termino, dias, notas
         FROM personal_licencias WHERE funcionario_id = $1
         ORDER BY fecha_inicio DESC NULLS LAST, created_at DESC`,
        [f.id]
      ),
    ])

    const docsActo = docsR.rows.filter(esDocActo)
    // Limitar OCR en caliente: priorizar resoluciones y decretos con DECRETO en nombre
    const docsOrden = [...docsActo].sort((a, b) => {
      const score = (d) =>
        (d.tipo_documental === 'resolucion_nombramiento' ? 0 : 2) +
        (/\bDECRETO\b/i.test(d.nombre_archivo || '') ? 0 : 1)
      return score(a) - score(b)
    })

    const MAX_EXTRACT = Math.min(docsOrden.length, Number(req.query?.max_docs) || 12)
    const aExtraer = docsOrden.slice(0, MAX_EXTRACT)

    const extracciones = await mapPool(aExtraer, 2, (doc) => extraerCamposDocumento(doc, { force }))

    const decretos = aExtraer
      .map((d, idx) => {
        const x = extracciones[idx] || {}
        const nFromName =
          (String(d.nombre_archivo || '').match(/_(\d{2,6})\.pdf$/i) || [])[1] || null
        const confianza = Number(x.confianza || 0)
        const tieneTermino = !!(x.fecha_termino || x.fecha_termino_texto)
        const fidedigno =
          !!x.manual ||
          (confianza >= 50 &&
            !!x.n_decreto &&
            !!x.fecha_decreto &&
            !!x.fecha_inicio &&
            tieneTermino &&
            x.horas != null) ||
          (confianza >= 50 && !!(x.fecha_inicio || (x.n_decreto && x.fecha_decreto && x.horas != null)))
        return {
          doc_id: d.id,
          tipo: labelTipo(d.tipo_documental, d.nombre_archivo, x.tipo_acto),
          tipo_documental: d.tipo_documental,
          tipo_label: tipoDocumentalLabel(d.tipo_documental),
          n_decreto: x.n_decreto || nFromName || null,
          fecha_decreto: x.fecha_decreto || null,
          fecha_inicio: x.fecha_inicio || null,
          fecha_termino: x.fecha_termino || null,
          fecha_termino_texto: x.fecha_termino_texto || null,
          duracion_dias: x.duracion_dias != null ? Number(x.duracion_dias) : null,
          duracion_meses: x.duracion_meses != null ? Number(x.duracion_meses) : null,
          horas: x.horas != null ? x.horas : null,
          // Solo lo leído del PDF / carga manual (no ubicacion del funcionario)
          establecimiento: x.establecimiento || null,
          fuente: d.nombre_archivo || 'PDF carpeta SIGEX',
          nombre_archivo: d.nombre_archivo,
          url_archivo: `/api/personal/funcionarios/${f.id}/documentos/${d.id}/archivo`,
          metodo_extraccion: x.metodo || null,
          plantilla: x.plantilla || null,
          confianza,
          fidedigno,
          manual: !!x.manual,
          pages: x.pages || null,
          desde_cache: !!x.desde_cache,
          error_extraccion: x.error || null,
          origen_carga: d.origen_carga || null,
          created_at: d.created_at || null,
        }
      })
      // Consolidados enormes sin lectura fidedigna: no contaminar la ficha
      .filter((d) => !(d.pages > 8 && !d.fidedigno))
      .sort((a, b) => {
        // Primero fidedignos; luego por fecha inicio/decreto
        if (a.fidedigno !== b.fidedigno) return a.fidedigno ? -1 : 1
        return String(b.fecha_inicio || b.fecha_decreto || '').localeCompare(
          String(a.fecha_inicio || a.fecha_decreto || '')
        )
      })

    const liquidaciones = liqR.rows.map((l) => ({
      id: l.id,
      mes: l.mes,
      anio: l.anio,
      etiqueta: l.etiqueta || etiquetaPeriodo(l.mes, l.anio),
      cargo: l.cargo || null,
      establecimiento: l.establecimiento || f.ubicacion || null,
    }))

    const licencias = licR.rows.map((l) => ({
      id: l.id,
      numero_licencia: l.numero_licencia,
      fecha_tramitacion: l.fecha_tramitacion,
      fecha_inicio: l.fecha_inicio,
      fecha_termino: l.fecha_termino,
      dias: l.dias,
      notas: l.notas,
    }))

    res.json({
      funcionario: {
        id: f.id,
        rut: formatearRut(f.rut_normalizado),
        rut_normalizado: f.rut_normalizado,
        nombre_completo: f.nombre_completo,
        tipo_funcionario: f.tipo_funcionario,
        estado_laboral: f.estado_laboral,
        activo: f.activo,
        planta: f.planta,
        ubicacion: f.ubicacion,
        tipo_contrato: f.tipo_contrato,
        fecha_ingreso: f.fecha_ingreso,
        profesion: f.profesion,
      },
      decretos,
      liquidaciones,
      licencias,
      meta: {
        docs_acto_total: docsActo.length,
        docs_extraidos: decretos.length,
        liquidaciones: liquidaciones.length,
        licencias: licencias.length,
      },
    })
  } catch (err) {
    console.error('[titularidad/datos]', err)
    res.status(500).json({ error: err.message || 'Error al consultar titularidad' })
  }
})

/**
 * PATCH /titularidad/decretos/:docId
 * Corregí a mano N°, fechas, horas, establecimiento o término textual.
 */
router.patch('/titularidad/decretos/:docId', auth, async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return

    const docId = String(req.params.docId || '').trim()
    if (!docId) return res.status(400).json({ error: 'docId requerido' })

    const docR = await db.query(
      `SELECT id, funcionario_id, nombre_archivo, extraccion_json
       FROM personal_documentos WHERE id = $1 AND es_activo = TRUE`,
      [docId]
    )
    if (!docR.rows.length) return res.status(404).json({ error: 'Documento no encontrado' })
    const doc = docR.rows[0]

    const body = req.body || {}
    const iso = (v) => {
      if (v == null || v === '') return null
      const s = String(v).trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
      return null
    }

    const prev = doc.extraccion_json && typeof doc.extraccion_json === 'object' ? doc.extraccion_json : {}
    const n_decreto =
      body.n_decreto != null && String(body.n_decreto).trim() !== ''
        ? String(body.n_decreto).replace(/\D/g, '').replace(/^0+/, '') || String(body.n_decreto).trim()
        : prev.n_decreto || null
    const fecha_decreto = body.fecha_decreto !== undefined ? iso(body.fecha_decreto) : prev.fecha_decreto || null
    const fecha_inicio = body.fecha_inicio !== undefined ? iso(body.fecha_inicio) : prev.fecha_inicio || null
    let fecha_termino =
      body.fecha_termino !== undefined ? iso(body.fecha_termino) : prev.fecha_termino || null
    let fecha_termino_texto =
      body.fecha_termino_texto !== undefined
        ? body.fecha_termino_texto
          ? String(body.fecha_termino_texto).trim().slice(0, 120)
          : null
        : prev.fecha_termino_texto || null
    if (fecha_termino) fecha_termino_texto = null
    if (fecha_termino_texto) fecha_termino = null

    let horas = prev.horas != null ? Number(prev.horas) : null
    if (body.horas !== undefined && body.horas !== null && body.horas !== '') {
      const nH = Number(body.horas)
      if (!Number.isFinite(nH) || nH < 1 || nH > 44) {
        return res.status(400).json({ error: 'Horas debe ser un número entre 1 y 44' })
      }
      horas = nH
    }

    const establecimiento =
      body.establecimiento !== undefined
        ? body.establecimiento
          ? String(body.establecimiento).trim().slice(0, 120)
          : null
        : prev.establecimiento || null

    let duracion_dias = null
    let duracion_meses = null
    if (fecha_inicio && fecha_termino) {
      const a = new Date(fecha_inicio + 'T12:00:00Z')
      const b = new Date(fecha_termino + 'T12:00:00Z')
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b >= a) {
        duracion_dias = Math.round((b - a) / 86400000) + 1
        duracion_meses =
          (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1
      }
    }

    const completo =
      !!n_decreto &&
      !!fecha_decreto &&
      !!fecha_inicio &&
      !!(fecha_termino || fecha_termino_texto) &&
      horas != null

    const result = {
      ...prev,
      n_decreto,
      fecha_decreto,
      fecha_inicio,
      fecha_termino,
      fecha_termino_texto,
      horas,
      establecimiento,
      duracion_dias,
      duracion_meses,
      tipo_acto: prev.tipo_acto || 'Decreto',
      plantilla: prev.plantilla || 'manual',
      confianza: completo ? 100 : 80,
      metodo: 'manual',
      manual: true,
      manual_at: new Date().toISOString(),
      manual_by: req.user?.login || req.user?.id || null,
      parser_version: Math.max(Number(prev.parser_version) || 0, Number(PARSER_VERSION) || 1),
      extracted_at: new Date().toISOString(),
    }

    await db.query(
      `UPDATE personal_documentos
       SET extraccion_json = $2::jsonb, extraccion_at = NOW()
       WHERE id = $1`,
      [docId, JSON.stringify(result)]
    )

    res.json({
      ok: true,
      doc_id: docId,
      nombre_archivo: doc.nombre_archivo,
      extraccion: result,
      fidedigno: completo,
    })
  } catch (err) {
    console.error('[titularidad/decretos PATCH]', err)
    res.status(500).json({ error: err.message || 'Error al guardar' })
  }
})

module.exports = router
