const router = require('express').Router()
const multer = require('multer')
const auth = require('../middleware/auth')
const {
  parseNomdepbancosXlsx,
  compararPlanillas,
  UMBRAL_GRANDE_DEFAULT,
} = require('../lib/remuneracionCompareXlsx')
const { requireAccesoPersonal } = require('../lib/personalPermisos')
const personalDocumentos = require('./personalDocumentos')
const personalImportaciones = require('./personalImportaciones')
const personalFuncionarios = require('./personalFuncionarios')

router.use(personalDocumentos)
router.use(personalImportaciones)
router.use(personalFuncionarios)

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

module.exports = router
