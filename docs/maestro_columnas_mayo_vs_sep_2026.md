# Maestro remuneraciones — cambio de columnas mayo → septiembre 2026

## Bug corregido (parser)

El import prefería columnas `__EMPTY` / `__EMPTY_1` para AFP y salud. En el layout del Excel esas columnas vacías (después de `horatraso`) contienen el **RUT numérico sin DV**, no la AFP/salud.

- Columnas correctas (posición estable mayo y sep):
  - **AFP:** `nombreafp` (columna índice 9)
  - **Salud:** `salud` (columna índice 12)
- Validación nueva: si AFP o salud no coinciden con el catálogo (o parecen un RUT), la fila se **rechaza** con error en la vista previa / respuesta del POST.

Archivo corregido: `src/lib/personalMaestroRemuneracionesParse.js`.

**Acción operativa:** volver a subir `matriz 92026.xlsx` (y junio si aplica) para reparar filas ya cargadas con RUT en `fondo`/`salud`.

## Qué cambió de posición / nombre (haberes)

Los campos demográficos (nombre, rut, ubicación, nombreafp, salud, cargo, tipo contrato) **mantienen el mismo índice**.

Cambió el bloque de haberes: en septiembre llevan prefijo `H0xx`.

| Concepto              | Mayo 2026              | Septiembre 2026 (`matriz 92026.xlsx`) |
|-----------------------|------------------------|----------------------------------------|
| Sueldos               | `SUELDOS` @82          | `H001 SUELDOS` @82                     |
| Seg. cesantía empleador | `SEG.CESANTIA EMP.` @112 | `H099 SEG.CESANTIA EMP.` @112        |
| R.B.M.N.              | `R.B.M.N.` @83         | `H002 R.B.M.N.` @83                    |
| Asig. experiencia     | `ASIG.EXPERIENC` @84   | `H003 ASIG.EXPERIENC` @84              |
| …                     | sin prefijo            | con prefijo `H0xx`                     |

Además en sep aparecen columnas nuevas (ej. `H100 AGUINALDO FIESTAS PATRIAS`, `H104 ADECO`, `H877 Rentabilidad Protegida`) y desaparecen algunas de mayo (`BONO ESCOLAR`, `LA CHIL.CONSOL`, etc.).

Encoding: `Ubicación` en mayo vs `Ubicaci?n` en algunos exports de sep (mismo índice 6).

## Ejemplo RUT 16.035.886-6 (archivo sep, parser corregido)

- fondo: AFP PROVIDA  
- salud: FONASA  
- planta: AUXILIAR  
- ubicación: F-487 SIMONS  
- sueldos: 557700 (`H001 SUELDOS`)  
- seg. cesantía emp.: 15390 (`H099`)  
