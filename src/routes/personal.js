const router = require('express').Router()
const multer = require('multer')
const auth = require('../middleware/auth')
const {
  parseNomdepbancosXlsx,
  compararPlanillas,
  UMBRAL_GRANDE_DEFAULT,
} = require('../lib/remuneracionCompareXlsx')
const { procesarMaestro, exportarArt13Xlsx } = require('../lib/personalArt13Excel')
const { PARAMETROS_2026 } = require('../lib/personalArt13Calc')
const { requireAccesoPersonal } = require('../lib/personalPermisos')
const personalDocumentos = require('./personalDocumentos')
const personalImportaciones = require('./personalImportaciones')
const personalFuncionarios = require('./personalFuncionarios')

const personalLiquidaciones = require('./personalLiquidaciones');
const personalLicencias = require('./personalLicencias');
const personalCarpetas = require('./personalCarpetas');

router.use(personalDocumentos)
router.use(personalImportaciones)
router.use(personalFuncionarios)
router.use(personalLiquidaciones)
router.use(personalLicencias)
router.use(personalCarpetas)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase()
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return cb(null, true)
    cb(new Error('Solo se aceptan archivos Excel (.xls o .xlsx)'))
  },
})

function esExcel(file) {
  const name = String(file?.originalname || '').toLowerCase()
  return name.endsWith('.xls') || name.endsWith('.xlsx')
}

router.post(
  '/comparar-planilla',
  auth,
  upload.fields([
    { name: 'periodo_a', maxCount: 1 },
    { name: 'periodo_b', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!requireAccesoPersonal(req, res)) return
      const fileA = req.files?.periodo_a?.[0]
      const fileB = req.files?.periodo_b?.[0]

      if (!fileA?.buffer) {
        return res.status(400).json({ error: 'Adjuntá la planilla Excel del primer período (periodo_a)' })
      }
      if (!fileB?.buffer) {
        return res.status(400).json({ error: 'Adjuntá la planilla Excel del segundo período (periodo_b)' })
      }
      if (!esExcel(fileA) || !esExcel(fileB)) {
        return res.status(400).json({ error: 'Solo se aceptan archivos Excel (.xls o .xlsx)' })
      }

      const umbralGrande = Number(req.body?.umbral_grande) || UMBRAL_GRANDE_DEFAULT
      const nombreA = String(req.body?.nombre_a || fileA.originalname || 'Período A').trim()
      const nombreB = String(req.body?.nombre_b || fileB.originalname || 'Período B').trim()

      const parsedA = parseNomdepbancosXlsx(fileA.buffer, { etiqueta: nombreA })
      const parsedB = parseNomdepbancosXlsx(fileB.buffer, { etiqueta: nombreB })

      if (!parsedA.empleados.length) {
        return res.status(400).json({ error: `No se encontraron empleados en ${nombreA}` })
      }
      if (!parsedB.empleados.length) {
        return res.status(400).json({ error: `No se encontraron empleados en ${nombreB}` })
      }

      const resultado = compararPlanillas(parsedA, parsedB, {
        umbral_grande: umbralGrande,
        nombre_a: nombreA,
        nombre_b: nombreB,
      })

      res.json({
        ...resultado,
        archivos: {
          periodo_a: fileA.originalname || 'periodo_a.xls',
          periodo_b: fileB.originalname || 'periodo_b.xls',
        },
      })
    } catch (err) {
      console.error('[personal/comparar-planilla]', err)
      res.status(500).json({ error: err.message || 'Error al comparar planillas' })
    }
  }
)

router.post('/art13/calcular', auth, upload.single('maestro'), async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Adjuntá el maestro de remuneraciones (Excel)' })
    }
    if (!esExcel(req.file)) {
      return res.status(400).json({ error: 'Solo se aceptan archivos Excel (.xls o .xlsx)' })
    }
    const resultado = procesarMaestro(req.file.buffer, req.body || {})
    res.json({
      ...resultado,
      archivo: req.file.originalname || 'maestro.xlsx',
      parametros_default: PARAMETROS_2026,
    })
  } catch (err) {
    console.error('[personal/art13/calcular]', err)
    res.status(500).json({ error: err.message || 'Error al calcular Artículo 13' })
  }
})

router.post('/art13/exportar', auth, upload.single('maestro'), async (req, res) => {
  try {
    if (!requireAccesoPersonal(req, res)) return
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Adjuntá el maestro de remuneraciones (Excel)' })
    }
    if (!esExcel(req.file)) {
      return res.status(400).json({ error: 'Solo se aceptan archivos Excel (.xls o .xlsx)' })
    }
    const resultado = procesarMaestro(req.file.buffer, req.body || {})
    let filas = resultado.filas
    let plantasFiltro = req.body?.plantas
    if (typeof plantasFiltro === 'string' && plantasFiltro.trim()) {
      try {
        plantasFiltro = JSON.parse(plantasFiltro)
      } catch {
        plantasFiltro = String(plantasFiltro)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }
    if (Array.isArray(plantasFiltro) && plantasFiltro.length) {
      const set = new Set(plantasFiltro)
      filas = filas.filter((r) => set.has(r.planta || '(sin planta)'))
    } else {
      filas = filas.filter((r) => !r.esDocente)
    }
    const buf = exportarArt13Xlsx(filas)
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="bono-articulo-13-${stamp}.xlsx"`)
    res.send(buf)
  } catch (err) {
    console.error('[personal/art13/exportar]', err)
    res.status(500).json({ error: err.message || 'Error al exportar Artículo 13' })
  }
})

module.exports = router
