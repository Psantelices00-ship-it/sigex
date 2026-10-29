# Paquete LME — maqueta y decisiones (Etapa B)

Rama: `feature/paquete-lme`  
**No desplegar a producción** sin aprobación explícita.

## Objetivo del producto

Automatizar (robot) la gestión de LME en el **Portal FONASA (PIEE)**: el robot lee la licencia en la bandeja del portal y **copia/pega** desde SIGEX los datos de los 4 pasos.

- **Bandeja PIEE:** folio, recepción, inicio, días, tipo, operador (I-MED/MEDIPASS).
- **Pasos SIGEX → portal:** 1 Entidad empleadora · 2 Previsión · 3 Renta y/o subsidios · 4 LME anteriores.
- Ver también `docs/maestro_columnas_mayo_vs_sep_2026.md` (bug AFP/salud = RUT).

## Decisiones cerradas (Etapa A)

1. **C.3 remuneraciones:** fuente principal = maestro del mes correspondiente. Si falta monto en maestro → fallback a `monto_imponible` de liquidación PDF de ese mes. El PDF se entrega siempre como adjunto cuando exista.
2. **Establecimientos / RBD:** ejemplos ficticios en maqueta; listado real con dirección/comuna/ciudad se entrega después.
3. **Endpoint:** `GET /api/personal/licencias/paquete?rut=XXXXXXXX-X&fecha_inicio=AAAA-MM-DD` (auth por token API, no sesión web).
4. **Catálogos y parámetros:** visibles/editables por **Recursos Humanos** y **Super Admin**.
5. **Maternal:** se agregará `tipo_licencia` al historial (tipo 3 → alerta de tabla adicional).

## Prioridad de datos

`manual / carga_masiva confirmada` > `maestro del mes` > `regla por estatuto` > vacío + alerta.

El import mensual del maestro **no** pisa overrides manuales/carga masiva.

## Maqueta (frontend)

Rutas bajo `/personal/lme-maqueta` con mocks en `sigex-frontend/lib/lmeMaqueta/`.

### Ronda 2–3 (ajustes UI)

- Ficha reorganizada en **4 pasos Portal FONASA (PIEE)** (misma lógica C.1–C.4).
- Copiar por celda; UF por mes; C.4/paso 4 con historial SIGEX visible; fechas `dd/mm/aaaa`.
- Catálogos: establecimientos (dirección) + mapeo cargo→ocupación (Auxiliar=17).
- Alerta roja si historial &gt; 7 días.
- Parser maestro: AFP=`nombreafp`, salud=`salud`; valida catálogo (ver `maestro_columnas_mayo_vs_sep_2026.md`).

Pantallazos: `tmp/lme-maqueta-screenshots-r2/`.

## Fuera de alcance de la maqueta

- Migraciones sobre BD de producción
- Tokens API reales
- Firmas S3/R2 de adjuntos
- Deploy a sigex.cl
