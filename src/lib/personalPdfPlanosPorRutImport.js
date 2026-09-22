const fs = require('fs');
const path = require('path');
const db = require('../db');
const { normalizeRutParts, formatearRut } = require('./rutChileno');
const { guardarDocumentoPersonal, TIPO_CONSOLIDADO_IMPORT } = require('./personalDocumentoService');
const { tipoPermitidoParaFuncionario } = require('./personalDocTypes');

/**
 * Detecta tipo documental por palabras clave en el nombre del archivo.
 * - RESOLUCION / NOMBRAMIENTO → resolucion_nombramiento (se agrega, no reemplaza)
 * - Sin coincidencia → consolidado antiguo
 * La carga masiva nunca sustituye un documento existente.
 */
function detectarTipoDocumental(filename) {
  const u = String(filename || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/RESOLUC|NOMBRAMIENTO/.test(u)) return 'resolucion_nombramiento';
  if (/CONTRATO/.test(u) && !/TERMINO/.test(u)) return 'contrato';
  if (/TERMINO.?CONTRATO|FINIQUITO/.test(u)) return 'termino_contrato';
  if (/\bCV\b|CURRICUL/.test(u)) return 'curriculum';
  if (/CEDULA|IDENTIDAD/.test(u)) return 'cedula_identidad';
  if (/ANTECEDENTE/.test(u)) return 'certificado_antecedentes';
  if (/NACIMIENTO/.test(u)) return 'certificado_nacimiento';
  if (/INHABILIDAD|MENORES/.test(u)) return 'certificado_inhabilidad_menores';
  if (/SALUD|MEDICO/.test(u)) return 'certificado_salud';
  if (/\bAFP\b/.test(u)) return 'certificado_afp';
  if (/ISAPRE|FONASA|PREVISION/.test(u)) return 'certificado_prevision';
  if (/MILITAR/.test(u)) return 'certificado_situacion_militar';
  if (/ESTUDIO|TITULO|TÍTULO/.test(u)) return 'certificado_estudios';
  if (/ANEXO/.test(u)) return 'anexo';
  return TIPO_CONSOLIDADO_IMPORT;
}

/**
 * Extrae RUT del inicio del nombre: 14059036-3.pdf, 14059036-3 RESOLUCION.pdf, 14059036-3 (2).pdf
 */
function parsePdfNombrePorRut(filename) {
  const name = String(filename || '').trim();
  if (!/\.pdf$/i.test(name) || name.startsWith('._')) return null;

  const m = name.match(/^(\d{7,8})-([0-9Kk])(?:[\s_(].*)?\.pdf$/i);
  if (!m) {
    // Sin DV en el nombre: 14059036.pdf / 14059036 algo.pdf
    const m2 = name.match(/^(\d{7,8})(?:[\s_(].*)?\.pdf$/i);
    if (!m2) return null;
    const parts = normalizeRutParts(m2[1]);
    if (!parts) {
      return {
        archivo: name,
        rut_display: m2[1],
        rut_normalizado: m2[1],
        rut_numero: m2[1],
        tipo_documental: detectarTipoDocumental(name),
        parts: null,
      };
    }
    return {
      archivo: name,
      rut_display: formatearRut(parts.rut_normalizado),
      rut_normalizado: parts.rut_normalizado,
      rut_numero: parts.rut_numero,
      tipo_documental: detectarTipoDocumental(name),
      parts,
    };
  }

  const rutStr = `${m[1]}-${m[2]}`;
  let parts = normalizeRutParts(rutStr);
  if (!parts) {
    parts = {
      rut_normalizado: `${m[1]}${String(m[2]).toUpperCase()}`,
      rut_numero: m[1],
      rut_dv: String(m[2]).toUpperCase(),
    };
  }

  return {
    archivo: name,
    rut_display: formatearRut(parts.rut_normalizado) || rutStr.toUpperCase(),
    rut_normalizado: parts.rut_normalizado,
    rut_numero: parts.rut_numero,
    tipo_documental: detectarTipoDocumental(name),
    parts,
  };
}

function listarPdfsPlanos(basePath) {
  return fs
    .readdirSync(basePath, { withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.startsWith('._') && /\.pdf$/i.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
}

async function buscarFuncionarioPorRut(parts) {
  if (!parts) return { funcionario: null, ambiguo: false };

  let r = await db.query('SELECT * FROM personal_funcionarios WHERE rut_normalizado = $1', [
    parts.rut_normalizado,
  ]);
  if (r.rows.length === 1) return { funcionario: r.rows[0], ambiguo: false };

  r = await db.query('SELECT * FROM personal_funcionarios WHERE rut_numero = $1', [parts.rut_numero]);
  if (r.rows.length === 1) return { funcionario: r.rows[0], ambiguo: false };
  if (r.rows.length > 1) return { funcionario: null, ambiguo: true, cantidad: r.rows.length };
  return { funcionario: null, ambiguo: false };
}

async function yaExisteArchivo(funcionarioId, tipoDocumental, nombreArchivo) {
  const r = await db.query(
    `SELECT id FROM personal_documentos
     WHERE funcionario_id = $1 AND tipo_documental = $2
       AND lower(nombre_archivo) = lower($3)
     LIMIT 1`,
    [funcionarioId, tipoDocumental, nombreArchivo]
  );
  return r.rows.length > 0;
}

/**
 * Importa PDFs planos nombrados por RUT a la carpeta/ficha del funcionario.
 * @param {object} opts
 * @param {string} opts.basePath
 * @param {string} opts.usuarioLogin
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.forzar]
 * @param {(p: object) => Promise<void>} [opts.onProgress]
 */
async function importarPdfPlanosPorRut(opts) {
  const basePath = path.resolve(String(opts.basePath || '').trim());
  if (!basePath || !fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    throw new Error(`Ruta no encontrada o no es carpeta: ${basePath}`);
  }

  const dryRun = !!opts.dryRun;
  const forzar = !!opts.forzar;
  const usuarioLogin = opts.usuarioLogin || 'script_pdf_planos';
  const onProgress = opts.onProgress || (async () => {});
  const inicio = Date.now();

  const resumen = {
    base_path: basePath,
    dry_run: dryRun,
    archivos_total: 0,
    archivos_sin_rut: 0,
    documentos_cargados: 0,
    documentos_omitidos: 0,
    documentos_rechazados: 0,
    funcionarios_identificados: 0,
    funcionarios_no_encontrados: 0,
    rut_duplicados: 0,
    por_tipo: {},
    incidencias: [],
    tiempo_ms: 0,
  };

  const archivos = listarPdfsPlanos(basePath);
  resumen.archivos_total = archivos.length;
  const rutsVistos = new Set();

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const parsed = parsePdfNombrePorRut(archivo);

    if (!parsed) {
      resumen.archivos_sin_rut++;
      resumen.incidencias.push({
        archivo,
        tipo: 'nombre_invalido',
        mensaje: 'No se pudo extraer RUT del nombre (esperado: 12345678-9….pdf)',
      });
      continue;
    }

    const { funcionario, ambiguo, cantidad } = await buscarFuncionarioPorRut(parsed.parts);
    if (ambiguo) {
      resumen.rut_duplicados++;
      resumen.incidencias.push({
        archivo,
        rut: parsed.rut_display,
        tipo: 'rut_duplicado',
        mensaje: `Hay ${cantidad} funcionarios con el mismo número base`,
      });
      continue;
    }
    if (!funcionario) {
      resumen.funcionarios_no_encontrados++;
      resumen.incidencias.push({
        archivo,
        rut: parsed.rut_display,
        tipo: 'funcionario_no_encontrado',
        mensaje: 'Funcionario no está en la base SIGEX',
      });
      continue;
    }

    if (!rutsVistos.has(funcionario.id)) {
      rutsVistos.add(funcionario.id);
      resumen.funcionarios_identificados++;
    }

    let tipo = parsed.tipo_documental;
    if (!tipoPermitidoParaFuncionario(tipo, funcionario.tipo_funcionario)) {
      // Fallback seguro: no bloquear la carga
      tipo = TIPO_CONSOLIDADO_IMPORT;
    }

    resumen.por_tipo[tipo] = (resumen.por_tipo[tipo] || 0) + 1;

    try {
      if (!forzar && !dryRun && (await yaExisteArchivo(funcionario.id, tipo, archivo))) {
        resumen.documentos_omitidos++;
        continue;
      }

      if (dryRun) {
        resumen.documentos_cargados++;
        continue;
      }

      const fullPath = path.join(basePath, archivo);
      const buffer = fs.readFileSync(fullPath);
      await guardarDocumentoPersonal({
        funcionario,
        tipo_documental: tipo,
        buffer,
        originalname: archivo,
        cargado_por: usuarioLogin,
        origen_carga: 'importacion_masiva',
      });
      resumen.documentos_cargados++;
    } catch (e) {
      resumen.documentos_rechazados++;
      resumen.incidencias.push({
        archivo,
        rut: parsed.rut_display,
        tipo: 'error_archivo',
        mensaje: e.message || String(e),
      });
    }

    if ((i + 1) % 5 === 0 || i === archivos.length - 1) {
      await onProgress({
        ...resumen,
        indice: i + 1,
        archivo_actual: archivo,
      });
    }
  }

  resumen.tiempo_ms = Date.now() - inicio;
  resumen.incidencias_muestra = resumen.incidencias.slice(0, 50);
  return resumen;
}

module.exports = {
  detectarTipoDocumental,
  parsePdfNombrePorRut,
  importarPdfPlanosPorRut,
};
