const fs = require('fs');
const path = require('path');
const db = require('../db');
const { normalizeRutParts, formatearRut } = require('./rutChileno');
const { guardarDocumentoPersonal, resolverTipoDocumentalImport } = require('./personalDocumentoService');

const DEFAULT_BASE =
  '/Volumes/TOSHIBA EXT/Digitalización de carpetas funcionarias - Noviembre 2025';

function carpetaImportHabilitado() {
  if (process.env.PERSONAL_IMPORT_CARPETAS_ENABLED === '1') return true;
  if (process.env.PERSONAL_IMPORT_CARPETAS_ENABLED === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function resolveBasePath(input) {
  const raw = String(input || process.env.PERSONAL_CARPETAS_BASE_PATH || DEFAULT_BASE).trim();
  return path.resolve(raw);
}

function validarRutaBase(basePath) {
  if (!carpetaImportHabilitado()) {
    throw new Error(
      'Importación de carpetas deshabilitada en este servidor. Definí PERSONAL_IMPORT_CARPETAS_ENABLED=1 o ejecutá el API en local.'
    );
  }
  if (!basePath || !fs.existsSync(basePath)) {
    throw new Error(`Ruta no encontrada: ${basePath}`);
  }
  const st = fs.statSync(basePath);
  if (!st.isDirectory()) throw new Error('La ruta no es una carpeta');

  const allowed = String(process.env.PERSONAL_CARPETAS_ALLOWED_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length) {
    const ok = allowed.some((root) => {
      const r = path.resolve(root);
      return basePath === r || basePath.startsWith(r + path.sep);
    });
    if (!ok) throw new Error('Ruta fuera de los directorios permitidos (PERSONAL_CARPETAS_ALLOWED_ROOTS)');
  }
  return basePath;
}

function listarCarpetasRut(basePath) {
  return fs
    .readdirSync(basePath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listarPdfs(carpetaPath) {
  return fs
    .readdirSync(carpetaPath, { withFileTypes: true })
    .filter((f) => f.isFile() && /\.pdf$/i.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, 'es'));
}

async function buscarFuncionarioPorRut(parts) {
  let r = await db.query('SELECT * FROM personal_funcionarios WHERE rut_normalizado = $1', [
    parts.rut_normalizado,
  ]);
  if (r.rows.length === 1) return { funcionario: r.rows[0], ambiguo: false };

  r = await db.query('SELECT * FROM personal_funcionarios WHERE rut_numero = $1', [parts.rut_numero]);
  if (r.rows.length === 1) return { funcionario: r.rows[0], ambiguo: false };
  if (r.rows.length > 1) return { funcionario: null, ambiguo: true, cantidad: r.rows.length };
  return { funcionario: null, ambiguo: false };
}

/**
 * @param {object} opts
 * @param {string} opts.basePath
 * @param {string} opts.usuarioLogin
 * @param {string} [opts.importacionId]
 * @param {number} [opts.limiteCarpetas] 0 = sin límite
 * @param {boolean} [opts.dryRun]
 * @param {(partial: object) => Promise<void>} [opts.onProgress]
 */
async function importarCarpetasDesdeDisco(opts) {
  const basePath = validarRutaBase(resolveBasePath(opts.basePath));
  const inicio = Date.now();
  const usuarioLogin = opts.usuarioLogin || 'sistema';
  const limite = Number(opts.limiteCarpetas) || 0;
  const dryRun = !!opts.dryRun;
  const onProgress = opts.onProgress || (async () => {});

  const resumen = {
    base_path: basePath,
    dry_run: dryRun,
    carpetas_procesadas: 0,
    carpetas_total: 0,
    funcionarios_identificados: 0,
    funcionarios_no_encontrados: 0,
    rut_invalidos: 0,
    rut_duplicados: 0,
    documentos_cargados: 0,
    documentos_rechazados: 0,
    documentos_sin_clasificar: 0,
    asignacion_automatica: 0,
    incidencias: [],
    tiempo_ms: 0,
  };

  const nombres = listarCarpetasRut(basePath);
  resumen.carpetas_total = nombres.length;
  const aProcesar = limite > 0 ? nombres.slice(0, limite) : nombres;

  for (let i = 0; i < aProcesar.length; i++) {
    const nombreCarpeta = aProcesar[i];
    resumen.carpetas_procesadas++;

    const parts = normalizeRutParts(nombreCarpeta);
    if (!parts) {
      resumen.rut_invalidos++;
      resumen.incidencias.push({
        carpeta: nombreCarpeta,
        tipo: 'rut_invalido',
        mensaje: 'Nombre de carpeta no es un RUT válido',
      });
      await onProgress({ ...resumen, carpeta_actual: nombreCarpeta, indice: i + 1 });
      continue;
    }

    const { funcionario, ambiguo, cantidad } = await buscarFuncionarioPorRut(parts);
    if (ambiguo) {
      resumen.rut_duplicados++;
      resumen.incidencias.push({
        carpeta: nombreCarpeta,
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'rut_duplicado',
        mensaje: `Hay ${cantidad} funcionarios con el mismo número base`,
      });
      await onProgress({ ...resumen, carpeta_actual: nombreCarpeta, indice: i + 1 });
      continue;
    }

    if (!funcionario) {
      resumen.funcionarios_no_encontrados++;
      resumen.incidencias.push({
        carpeta: nombreCarpeta,
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'funcionario_no_encontrado',
        mensaje: 'Importá primero el Excel de funcionarios o creá el registro manualmente',
      });
      await onProgress({ ...resumen, carpeta_actual: nombreCarpeta, indice: i + 1 });
      continue;
    }

    resumen.funcionarios_identificados++;
    const carpetaPath = path.join(basePath, nombreCarpeta);
    const pdfs = listarPdfs(carpetaPath);

    if (!pdfs.length) {
      resumen.incidencias.push({
        carpeta: nombreCarpeta,
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'carpeta_vacia',
        mensaje: 'Sin archivos PDF',
      });
      await onProgress({ ...resumen, carpeta_actual: nombreCarpeta, indice: i + 1 });
      continue;
    }

    for (const pdfName of pdfs) {
      const fullPath = path.join(carpetaPath, pdfName);
      try {
        const buffer = fs.readFileSync(fullPath);
        const { tipo, automatico } = await resolverTipoDocumentalImport(funcionario.id, pdfName);

        if (!tipo) {
          resumen.documentos_sin_clasificar++;
          resumen.documentos_rechazados++;
          resumen.incidencias.push({
            carpeta: nombreCarpeta,
            archivo: pdfName,
            rut: formatearRut(parts.rut_normalizado),
            tipo: 'sin_cupo_documental',
            mensaje: 'Todos los tipos documentales ya tienen archivo activo',
          });
          continue;
        }

        if (dryRun) {
          resumen.documentos_cargados++;
          if (automatico) resumen.asignacion_automatica++;
          continue;
        }

        await guardarDocumentoPersonal({
          funcionario,
          tipo_documental: tipo,
          buffer,
          originalname: pdfName,
          cargado_por: usuarioLogin,
          asignacion_automatica: automatico,
        });
        resumen.documentos_cargados++;
        if (automatico) resumen.asignacion_automatica++;
      } catch (e) {
        resumen.documentos_rechazados++;
        resumen.incidencias.push({
          carpeta: nombreCarpeta,
          archivo: pdfName,
          rut: formatearRut(parts.rut_normalizado),
          tipo: 'error_archivo',
          mensaje: e.message || String(e),
        });
      }
    }

    if (resumen.incidencias.length > 500) {
      resumen.incidencias = resumen.incidencias.slice(0, 500);
      resumen.incidencias_truncadas = true;
    }

    if ((i + 1) % 5 === 0 || i === aProcesar.length - 1) {
      await onProgress({ ...resumen, carpeta_actual: nombreCarpeta, indice: i + 1 });
    }
  }

  resumen.tiempo_ms = Date.now() - inicio;
  resumen.incidencias_muestra = resumen.incidencias.slice(0, 100);
  return resumen;
}

module.exports = {
  DEFAULT_BASE,
  carpetaImportHabilitado,
  resolveBasePath,
  validarRutaBase,
  importarCarpetasDesdeDisco,
};
