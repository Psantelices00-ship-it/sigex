const fs = require('fs');
const path = require('path');
const db = require('../db');
const { normalizeRutParts, formatearRut } = require('./rutChileno');
const { guardarDocumentoPersonal } = require('./personalDocumentoService');
const { tipoPermitidoParaFuncionario } = require('./personalDocTypes');

const DEFAULT_BASE = '/Volumes/DISCO PABLO/resoluciones_27018c0d';
const TIPO_DOCUMENTAL = 'resolucion_nombramiento';

function resolveBasePath(input) {
  const raw = String(input || process.env.PERSONAL_RESOLUCIONES_BASE || DEFAULT_BASE).trim();
  return path.resolve(raw);
}

function validarRutaBase(basePath) {
  if (!basePath || !fs.existsSync(basePath)) {
    throw new Error(`Ruta no encontrada: ${basePath}`);
  }
  const st = fs.statSync(basePath);
  if (!st.isDirectory()) throw new Error('La ruta no es una carpeta');
  return basePath;
}

function parseNombreResolucion(filename) {
  const name = String(filename || '').trim();

  function fromMatch(numero, dvRaw, numeroResolucion, nombreEnArchivo) {
    const rutStr = dvRaw ? `${numero}-${dvRaw}` : numero;
    let parts = normalizeRutParts(rutStr);
    if (!parts) {
      // DV incorrecto en el nombre: igual buscamos por número base
      const dv = dvRaw ? String(dvRaw).toUpperCase() : '';
      parts = {
        rut_normalizado: dv ? `${numero}${dv}` : numero,
        rut_numero: numero,
        rut_dv: dv,
      };
    }
    return {
      archivo: name,
      rut_display: parts.rut_dv ? `${parts.rut_numero}-${parts.rut_dv}` : parts.rut_numero,
      rut_normalizado: parts.rut_normalizado,
      rut_numero: parts.rut_numero,
      numero_resolucion: parseInt(numeroResolucion, 10) || 0,
      nombre_en_archivo: nombreEnArchivo
        ? String(nombreEnArchivo).replace(/_/g, ' ').trim()
        : undefined,
    };
  }

  // Formato nuevo: RUT[-DV]_NOMBRE_APELLIDOS_numero.pdf
  let m = name.match(/^(\d{7,8})(?:-([0-9Kk]))?_(.+)_(\d+)\.pdf$/i);
  if (m) return fromMatch(m[1], m[2], m[4], m[3]);

  // Formato legacy: RUT[-DV]_numero.pdf
  m = name.match(/^(\d{7,8})(?:-([0-9Kk]))?_(\d+)\.pdf$/i);
  if (m) return fromMatch(m[1], m[2], m[3], null);

  return null;
}

function listarArchivosResolucion(basePath) {
  return fs
    .readdirSync(basePath, { withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.startsWith('._') && /\.pdf$/i.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
}

function agruparPorRut(archivos) {
  const grupos = new Map();
  for (const archivo of archivos) {
    const parsed = parseNombreResolucion(archivo);
    if (!parsed) continue;
    if (!grupos.has(parsed.rut_normalizado)) {
      grupos.set(parsed.rut_normalizado, {
        rut_normalizado: parsed.rut_normalizado,
        rut_display: parsed.rut_display,
        rut_numero: parsed.rut_numero,
        archivos: [],
      });
    }
    grupos.get(parsed.rut_normalizado).archivos.push({
      archivo,
      numero_resolucion: parsed.numero_resolucion,
    });
  }
  for (const g of grupos.values()) {
    g.archivos.sort((a, b) => a.numero_resolucion - b.numero_resolucion || a.archivo.localeCompare(b.archivo));
  }
  return [...grupos.values()].sort((a, b) => a.rut_normalizado.localeCompare(b.rut_normalizado, 'es', { numeric: true }));
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

async function yaExisteArchivo(funcionarioId, nombreArchivo) {
  const r = await db.query(
    `SELECT id FROM personal_documentos
     WHERE funcionario_id = $1 AND tipo_documental = $2
       AND lower(nombre_archivo) = lower($3)
     LIMIT 1`,
    [funcionarioId, TIPO_DOCUMENTAL, nombreArchivo]
  );
  return r.rows.length > 0;
}

/**
 * @param {object} opts
 * @param {string} opts.basePath
 * @param {string} opts.usuarioLogin
 * @param {number} [opts.limiteGrupos]
 * @param {number} [opts.offsetGrupos]
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.soloUltimaPorRut] si true, solo el PDF de mayor número por RUT
 * @param {(partial: object) => Promise<void>} [opts.onProgress]
 */
async function importarResolucionesNombramiento(opts) {
  const basePath = validarRutaBase(resolveBasePath(opts.basePath));
  const inicio = Date.now();
  const usuarioLogin = opts.usuarioLogin || 'script_resoluciones';
  const limite = Math.max(0, Number(opts.limiteGrupos) || 0);
  const offset = Math.max(0, Number(opts.offsetGrupos) || 0);
  const dryRun = !!opts.dryRun;
  const soloUltimaPorRut = opts.soloUltimaPorRut !== false;
  const onProgress = opts.onProgress || (async () => {});

  const resumen = {
    base_path: basePath,
    tipo_documental: TIPO_DOCUMENTAL,
    dry_run: dryRun,
    solo_ultima_por_rut: soloUltimaPorRut,
    offset_grupos: offset,
    limite_grupos: limite,
    grupos_procesados: 0,
    grupos_total: 0,
    grupos_en_tramo: 0,
    funcionarios_identificados: 0,
    funcionarios_no_encontrados: 0,
    rut_invalidos: 0,
    rut_duplicados: 0,
    documentos_cargados: 0,
    documentos_omitidos: 0,
    documentos_rechazados: 0,
    archivos_sin_parsear: 0,
    incidencias: [],
    tiempo_ms: 0,
  };

  const archivos = listarArchivosResolucion(basePath);
  const sinParsear = archivos.filter((a) => !parseNombreResolucion(a));
  resumen.archivos_sin_parsear = sinParsear.length;
  if (sinParsear.length) {
    for (const a of sinParsear.slice(0, 20)) {
      resumen.incidencias.push({ archivo: a, tipo: 'nombre_invalido', mensaje: 'No coincide con RUT_numero.pdf' });
    }
  }

  const grupos = agruparPorRut(archivos);
  resumen.grupos_total = grupos.length;
  const aProcesar = limite > 0 ? grupos.slice(offset, offset + limite) : grupos.slice(offset);
  resumen.grupos_en_tramo = aProcesar.length;

  for (let i = 0; i < aProcesar.length; i++) {
    const grupo = aProcesar[i];
    resumen.grupos_procesados++;
    const indiceGlobal = offset + i + 1;

    const parts = {
      rut_normalizado: grupo.rut_normalizado,
      rut_numero: grupo.rut_numero || String(grupo.rut_display || '').split('-')[0].replace(/\D/g, ''),
      rut_dv: String(grupo.rut_display || '').includes('-')
        ? String(grupo.rut_display).split('-').pop().toUpperCase()
        : String(grupo.rut_normalizado || '').slice(-1),
    };
    if (!parts.rut_numero) {
      resumen.rut_invalidos++;
      resumen.incidencias.push({
        rut: grupo.rut_display,
        tipo: 'rut_invalido',
        mensaje: 'RUT inválido en nombre de archivo',
      });
      continue;
    }

    const { funcionario, ambiguo, cantidad } = await buscarFuncionarioPorRut(parts);
    if (ambiguo) {
      resumen.rut_duplicados++;
      resumen.incidencias.push({
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'rut_duplicado',
        mensaje: `Hay ${cantidad} funcionarios con el mismo número base`,
      });
      continue;
    }

    if (!funcionario) {
      resumen.funcionarios_no_encontrados++;
      resumen.incidencias.push({
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'funcionario_no_encontrado',
        mensaje: 'Funcionario no está en la base SIGEX',
      });
      continue;
    }

    if (!tipoPermitidoParaFuncionario(TIPO_DOCUMENTAL, funcionario.tipo_funcionario)) {
      resumen.incidencias.push({
        rut: formatearRut(parts.rut_normalizado),
        tipo: 'tipo_no_aplica',
        mensaje: 'Resolución de nombramiento no aplica a este tipo de funcionario',
      });
      continue;
    }

    resumen.funcionarios_identificados++;
    const lista = soloUltimaPorRut ? [grupo.archivos[grupo.archivos.length - 1]] : grupo.archivos;

    for (const item of lista) {
      const fullPath = path.join(basePath, item.archivo);
      try {
        if (!dryRun && (await yaExisteArchivo(funcionario.id, item.archivo))) {
          resumen.documentos_omitidos++;
          continue;
        }

        if (dryRun) {
          resumen.documentos_cargados++;
          continue;
        }

        const buffer = fs.readFileSync(fullPath);
        await guardarDocumentoPersonal({
          funcionario,
          tipo_documental: TIPO_DOCUMENTAL,
          buffer,
          originalname: item.archivo,
          cargado_por: usuarioLogin,
          origen_carga: 'manual',
        });
        resumen.documentos_cargados++;
      } catch (e) {
        resumen.documentos_rechazados++;
        resumen.incidencias.push({
          rut: formatearRut(parts.rut_normalizado),
          archivo: item.archivo,
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
      await onProgress({
        ...resumen,
        rut_actual: formatearRut(parts.rut_normalizado),
        indice: indiceGlobal,
        indice_tramo: i +  1,
      });
    }
  }

  resumen.siguiente_offset = offset + aProcesar.length;
  resumen.tiempo_ms = Date.now() - inicio;
  resumen.incidencias_muestra = resumen.incidencias.slice(0, 100);
  return resumen;
}

module.exports = {
  DEFAULT_BASE,
  resolveBasePath,
  validarRutaBase,
  parseNombreResolucion,
  listarArchivosResolucion,
  agruparPorRut,
  importarResolucionesNombramiento,
  TIPO_DOCUMENTAL,
};
