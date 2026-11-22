# Catálogo sintético de solo lectura

Carril C autorizado expresamente el21/11/2026. Estado: implementación local, sin activación de comercio productivo ni multiempresa. Reutiliza `SourceConnector`, `ExecutorAdapter`, `createMissionLedger`, `PersistentMissionOrchestrator`, la cola `agent_tasks`, su auditoría y los RPC de claim/checkpoint/completado existentes. No registra conectores globales ni modifica el SQL/runtime protegido P2.

## Demostración con comando único

Desde la raíz de un checkout revisado, con dependencias del lockfile y PostgreSQL18 instalado:

```powershell
node scripts/demo-synthetic-catalog.mjs
```

El script crea una base PostgreSQL nueva en loopback29553, aplica únicamente a esa base el bootstrap y contratos staged existentes, ejecuta el test integral, conserva un `receipt.json` y detiene exclusivamente su clúster propio. Imprime ubicación del recibo y SHA del checkout ejecutado. `POSTGRES_BIN` permite fijar la carpeta de binarios; `CATALOG_DEMO_PORT` otro puerto local, excluyendo28447/29447. No usa credenciales alojadas ni tablas de Victoriosas reales. Un argumento posicional copia el recibo a una ruta elegida por el operador.

| Caso desde entrada normal | Resultado exigido |
|---|---|
| Permiso forjado en tarea, host sin `catalog_synthetic_read` | blocked, intento1, auditoría denegada, cero lecturas |
| Host concede solo `catalog_synthetic_read` | completed, intento1, checkpoint2; hash y evidencia SIMULADO |
| Reinvocar misión terminal | Ningún claim/evento/lectura adicional |
| Agotar cuota host1 | blocked, `catalog_budget_exhausted`, consumo total1 |
| Proveedor fixture indisponible | blocked, `catalog_unavailable`, consumo no crece |
| Host desactiva integración | blocked, `catalog_disabled`, consumo no crece |

La auditoría se persiste por un sink del host en `agent_audit_events`; el executor no recibe el cliente SQL. Cada lectura espera el registro `catalog_read_requested` antes de consultar el fixture y el registro de resultado antes de devolver evidencia. La cuota se reserva sincrónicamente, antes de ceder control. Un proceso psql separado lee filas y auditoría durables; otra instancia del fixture obtiene el hash esperado. Esto no certifica identidad remota ni una revisión humana: es observación independiente del resultado retornado por el executor dentro del laboratorio.

Pruebas focalizadas sin base:

```powershell
node --import tsx --test src/autopilot/catalogMissionExecutor.test.ts
```

También cubren métodos de compra/verificación/tracking/URL rechazados, objetivo/plan/ejecutor alterados, consulta fuera de límite, concurrencia que no excede cuota y fallo del sink de auditoría antes de leer. El test SQL integral está en `tests/catalog-integration-postgres.test.ts`; el comando demo exige ejecutarlo sin omisiones.

## Alcance y límites

Los dos productos son fixtures etiquetados SIMULADO, URLs `.invalid`, sin proveedor comercial, stock vendible ni publicación. Hay cero llamadas externas y ningún envío. `SourceConnector` conserva su forma existente pero solo anuncia `search`; todos los demás métodos fallan con `catalog_read_only`. No se habilita el registro global de conectores ni hay fallback a proveedores reales.

La autorización es una capacidad del host en proceso, no una sandbox frente a un propietario adversarial de la máquina. La cuota es por instancia del conector del host; el ledger SQL conserva claims/leases/checkpoints y evita readmisión terminal, sin tabla nueva. La metadata `worktree` requerida por el contrato apunta al checkout de código del host; la integración no crea ni modifica un worktree de productos.

Multiempresa no se implementa: `docs/PROJECT_DIRECTION.md`, secciones Identidad/evolución y F8, requiere decisión estratégica explícita y aislamiento en un proyecto separado. El alcance vigente solicita exclusivamente este catálogo sintético read-only. P2 y sus recursos originales permanecen fuera de este ensayo.
