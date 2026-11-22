# P0D: Supervisor de objetivo permanente - candidato

Diagrama: objetivo permanente -> supervisor -> ejecutores -> verificador + checkpoint -> repetir.

El nuevo `permanentSupervisor.ts` decide la siguiente accion a partir de observaciones verificadas. Es una capa pura sin permisos de escritura ni ejecucion. Ordena prioridades habilitadas y produce decisiones `inspect`, `wait`, `verify`, `checkpoint`, `propose_resume` o `blocked`. Una propuesta de reanudacion no es una autorizacion. La cola, ledger, leases, fencing y ejecutores existentes conservan su autoridad.

Las ocho pruebas unitarias originales de P0D comprueban terminal idempotente, evidencia ausente, lease activo, fallo, cola no autorizada, observacion desconocida, prioridades y entradas invalidas. La suite del candidato P1 añade pruebas del adaptador y regresiones de las fronteras de entrada; el resultado actual se registra en la continuidad.

No se han creado schedulers, misiones, secretos, servicios ni envios. P0D no acredita todavia recuperacion interhost ni ejecucion autonoma desatendida; la proxima etapa requiere un adaptador de observacion y verificacion con contratos de seguridad, pruebas entre ejecutores y una revision antes de habilitar dispatch.

## P1 status adapter candidate (14/11/2026 UY)

Reuses PR234 code and tests. The new decidePermanentObjectiveForLocalStore reads at most one status through the existing LocalMissionStore.status() method and checks the expected host binding. It rejects unexpected state/queue combinations, nonboolean lease fields, invalid versions, wrong mission IDs and inconsistent checkpoint states. A completed row is sent to independent verification, not attested by status itself. A failed/retry row cannot trigger dispatch or resume. This is not an active scheduler, SQL authorization or cross-host recovery proof. It has no IO other than one read through the supplied store and does not write claims/checkpoints.

The adapter requires an explicit authorized product phase F0-F8 and refuses a goal in a different phase before reading status. Only an independently authorized caller can provide this context; phase strings are not themselves credentials.

## Corrección de revisión · 15/11/2026

`SupervisorGoal.enabled` exige un booleano primitivo antes de seleccionar objetivo. Una cadena como `"false"`, números, null, undefined, arrays, objetos o Boolean encapsulado se rechazan; `false` real deshabilita el objetivo sin leer el store. Solo `true` real permite continuar la decisión existente. No cambia permisos de claim, resume ni dispatch.

Las dos regresiones nuevas fallaron antes de la corrección y pasan después. La función pura y la frontera host-bound se prueban por separado, incluyendo cero lecturas para flags inválidos/deshabilitados. Esto corrige la entrada, no completa la integración operativa: supervisor→PersistentMissionOrchestrator→ledger/claim SQL y verificación independiente siguen pendientes de P1 en la misma secuencia.

## P1 runtime read-only entrypoint - 15/11/2026

The previously integrated supervisor now has a read-only consumer in the existing PersistentMissionOrchestrator API and in mission:local supervise --config FILE --id ID. This operation validates a synthetic mission id and reads the existing LocalMissionStore/CloudMissionStore SQL status through its host binding; the status-to-decision adapter rejects unknown, mismatched and forged states. The CLI emits a narrow decision event only (no audit payload or secrets). No SQL claim, executor, checkpoint, replay, outbound call or scheduler is created. Final state must be independently verified; the new command never asserts acceptance. An isolated PostgreSQL operator fixture checks no state, attempts, checkpoint or audit changes. Runtime dispatch/claim authorization remains a separate unfinished gate of P1.

## Contrato local durable y recuperación ready_to_complete · 17/11/2026

El controlador host revisado usa authorizeMission(grant,expectedRevision) y revokeAuthorization(id,expectedRevision); emisor exige admit+execute y revocador cancel, sobre LocalMissionStore exacto. Revisión en agent_tasks.input.local_authorization, con active/grant/expiry y auditoría en agent_audit_events; CAS evita sucesores competidores. SQL functions solo para service_role en el laboratorio local, sin ampliar roles remotos. Las credenciales del propietario SQL siguen siendo una frontera administrativa confiable, fuera del alcance del executor.

La comparación de política bajo row lock es el punto de serialización de las escrituras. Una escritura antigua que espera a una revocación es denegada cuando esta confirma. Una admisión filesystem ya concedida puede terminar; no se promete rollback atómico de filesystem y SQL. El trigger también rechaza la vía legacy sin grant sobre filas controladas; filas legacy sin política conservan su contrato anterior. El estado público de autorización es metadato: active no sustituye la comprobación de vencimiento ni autoriza ejecutar.

Un grant con recovery=ready_to_complete requiere estado/plan/checkpoint exactos, lease expirada e intento disponible. La fábrica obtiene nuevo claim con token de fencing y permite solo attest_completion/complete_write. El runtime revalida artefactos con un verificador host distinto antes de completar; ningún paso, observación o planificación se repite. Un checkpoint no terminal/incierto queda fuera de este scope. No se conectó a CLI, scheduler ni recursos alojados.

El grant se transporta como literal escapado en SET LOCAL, no interpolado dentro de cuerpos DO. executorId usa el mismo alfabeto y límite80 que la SQL de checkpoint; una identidad fuera de contrato se rechaza antes del claim, sin ampliar restricciones para pasar pruebas.
