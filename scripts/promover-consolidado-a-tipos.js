#!/usr/bin/env node
/**
 * Promueve consolidados tipables (por nombre de archivo) al ítem de carpeta vigente
 * cuando ese slot está vacío. Duplicados se dejan en consolidado.
 *
 *   node scripts/promover-consolidado-a-tipos.js
 *   node scripts/promover-consolidado-a-tipos.js --dry-run
 *   node scripts/promover-consolidado-a-tipos.js --funcionario-id <uuid>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { promoverConsolidadoATipos } = require('../src/lib/personalPromoverConsolidadoTipos');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || true;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const funcionarioId = arg('--funcionario-id');

  console.log('SIGEX — promover consolidado → tipos de carpeta vigente');
  console.log(`Dry run: ${dryRun}${funcionarioId ? ` | funcionario: ${funcionarioId}` : ''}`);
  console.log('');

  const resumen = await promoverConsolidadoATipos({
    dryRun,
    funcionarioId: funcionarioId || null,
    onProgress: (p) => {
      if (p.updates_aplicados) {
        process.stdout.write(`\rAplicando: ${p.updates_aplicados}/${p.updates_total}`);
      } else if (p.funcionarios_procesados) {
        process.stdout.write(
          `\rFuncionarios: ${p.funcionarios_procesados}/${p.funcionarios} · a promover ${p.promovidos}`
        );
      }
    },
  });

  console.log('\n\n--- Resumen ---');
  console.log(JSON.stringify(resumen, null, 2));
  process.exit(resumen.errores > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
