# Paquete LME — maqueta y decisiones (Etapa B)

Rama: `feature/paquete-lme`  
**No desplegar a producción** sin aprobación explícita.

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

Ver instrucciones en el mensaje de entrega de Etapa B / README de la rama.

## Fuera de alcance de la maqueta

- Migraciones sobre BD de producción
- Tokens API reales
- Firmas S3/R2 de adjuntos
- Deploy a sigex.cl
