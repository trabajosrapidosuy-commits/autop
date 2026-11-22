# P2 parcial — recuperación protegida del efecto sin checkpoint

Fecha17/11/2026, America/Montevideo. Orden única `ORD-P2-RECOVERY-VERIFICATION-20261117`, producto F0. El propietario continúa el [contrato preparado](P2_RECOVERY_PREPARATION_RUNTIME_AUDIT_20261117.md) después de integrar #249. La autorización previa de integraciones continúa vigente; no concede producción, SQL alojado ni cambios de automatización.

Base contrastada: `aad1bb97bfa4a7bd60cbb7667db09214e223b805`; P1_CLOSED_WITH_BOUNDARIES integrada por #248/#249. Worktree propio `codex/p2-protected-effect-recovery-20261117`, sin PR equivalente ni escritor rival identificado en ese ámbito al comenzar. No se infiere exclusión global de la ausencia de un argumento de proceso. La raíz antigua y todos los recursos previos se conservan.

## Cambio mínimo y autoridad

La ruta protegida no podía admitir un efecto ya escrito con checkpoint2/plan1: solo admitía queued fresco o recuperación terminal. Las pruebas legacy de ese caso no son autoridad para saltarse las guardas. Dos regresiones RED reprodujeron el rechazo; el incremento agrega el scope explícito `reconcile_effect`, únicamente para el plan canónico inicial de tres pasos y esa frontera exacta.

| Capa existente | Comprobación nueva / conservada |
|---|---|
| Grant host | F0, identidad, binding, objetivo, revisión y vigencia ya existentes; nuevo scope requiere checkpoint2/plan1 y adaptador de reconciliación explícito |
| Política durable SQL | Mismo input de agent_tasks, CAS y row lock; running/in_progress, lease vencida, token presente, intentos disponibles, checkpoint/plan exactos, prepare-v1 completado y modify-v1 pendiente |
| Supervisor / fábrica | Observación sigue inspect/mission_state_unverified, sin permiso de resume. Solo un grant explícito permite construir la recuperación; no se cambia el supervisor a despachador |
| Claim | Mismo claim/lease/fencing y precondición transaccional; ningún takeover de lease activa o uso del token anterior |
| Oráculo | Host independiente, distinto del ejecutor; valida artefactos y fuente canónica después del claim y antes de cualquier paso. Repite comprobación después de decisiones asíncronas; política releída después del await del oráculo |
| Efecto | Método reconcile del mismo SyntheticMissionExecutor: solo lee archivos ya existentes, no crea directorio, hooks, worktree o artefactos. Ausencia/conflicto falla; no llama a modify con escritura |
| Continuación | Solo reconciliar modify-v1 en CP2 y ejecutar verify-v1 en CP3, con escrituras de checkpoint autorizadas. No prepare, observe, replan, fail/block ni cambio del plan |
| Finalización | Nueva atestación independiente de contexto completo y un solo uso; se conserva la revisión de política y el fencing SQL |

`ready_to_complete` mantiene sus permisos terminales anteriores: solo atestar/finalizar. No se convierte en permiso de ejecución. No hay un segundo ejecutor, ledger, tabla de cola o scheduler. SQL staged se probó únicamente al inicializar la base desechable; no se aplicó a infraestructura alojada.

**El primer oráculo es post-claim.** Una denegación puede consumir el segundo intento y su lease, dejando CP2 intacto y auditando el claim. No se afirma verificación preclaim, inmutabilidad global de archivos, atomicidad filesystem/SQL ni exactly-once general. Un efecto de filesystem admitido puede terminar aunque posteriormente se revoque; sus escrituras SQL protegidas posteriores se deniegan.

## Prueba nativa y negativos

`tests/fixtures/protectedEffectRecoveryProof.ts` contiene la misma prueba que invoca `tests/mission-operator-postgres.test.ts`. También permite un diagnóstico nativo focal sin repetir/copiar las expectativas de la suite legacy. Reutiliza el fixture de procesos P1/P2, el ejecutor, runtime, política y ledger actuales.

El padre recibe un acuse IPC después de escribir el efecto pero antes del checkpoint; registra CP2 y archivos, mata ese Node mediante SIGKILL, revoca la política anterior y comprueba rechazo de una nueva autorización con lease aún activa. Tras su vencimiento se lanza otro Node, con grant nuevo. No se transportan objetos/WeakMaps de un controlador al siguiente. Los IDs de misión sintética incluyen un sufijo propio por prueba para no readmitir casos terminales de ejecuciones anteriores.

Resultado en PostgreSQL18 desechable / Windows Node: **4/4 PASS,28443ms**, cada escenario dentro de su presupuesto90s; servidor propio detenido con exit0.

| Escenario | Resultado observado |
|---|---|
| Válido | Proceso reemplazo distinto; completed, intento2, CP5. Una reconciliación de lectura y un paso verify; prepare y modify con escritura no se repiten. Hashes, inode/identidad, birthtime, mtime, tamaños y contenido de ambos archivos permanecen iguales |
| Artefacto adulterado | Oráculo rechaza; in_progress/CP2/intento2, cero pasos. Checkpoint íntegro y contenido conflictivo sin sobrescribir |
| Archivo eliminado justo después del último oráculo, antes del adaptador | Reconcile falla sin recrearlo; in_progress/CP2/intento2, cero pasos verify. No observe/replan de rescate ni checkpoint nuevo |
| Revocación durante el await del oráculo, que devuelve true | Relectura durable rechaza; autorización inactiva/revisión4, in_progress/CP2, cero pasos. Archivos y checkpoint conservados |

El fixture también rechaza grant anterior, checkpoint/plan incorrectos, scope terminal sobre in_progress y replay posterior al cierre; prueba el token anterior durante la lease del reemplazo. La cobertura terminal P1 se conserva dentro de la misma suite.

## Revisión y validación

- Dos pruebas RED para el scope y su oráculo; GREEN después de la implementación.
- Revisor auxiliar de solo lectura detectó que copiar el verificador con spread perdía métodos del prototipo. Regresión de clase con getter/receiver RED reproducida; wrapper explícito corregido y GREEN. Es revisión técnica auxiliar, no aprobación humana independiente ni recibo operativo.
- Otra regresión RED/GREEN conserva AbortError al cancelar reconcile, sin observe/replan ni escritura posterior. Es prueba de componente; no acredita todavía la cancelación nativa completa pendiente.
- Focales:49/49. `npm run verify`: **579/579**,0 fallos/omisiones, skills, tipos, builds Node/Vercel y comprobación de APIs aprobados. Solo comentarios/tipos explícitos añadidos después; CI final comprueba el commit contenedor exacto.
- Diff/secret scan y continuidad se validan antes de publicar; las referencias del mismo JSON se releen desde otro proceso. CI final validate/postgres/CodeQL y navegador aplicable deben aprobar para ese SHA; no heredar la de main ni crear un hijo de sondeo para anotar su propio hash.

Fallos conservados, sin convertirlos en pruebas aprobadas:

1. El primer lanzador local quedó drenando un pipe heredado de pg_ctl después de arrancar el servidor. Se detuvo solo el cluster propio y se reemplazó el lanzador por Start-Process oculto con espera acotada del proceso inicial. No modifica código operativo ni automatización.
2. La primera inicialización SQL rechazó la expresión CASE nueva por sintaxis. Se añadieron paréntesis, manteniendo todos los predicados; la transacción fallida se revirtió y la base propia se contrastó antes de reutilizarla.
3. La suite nativa completa avanzó después hasta el CLI normal legacy y terminó en run_timeout antes de llegar a P2. Registró los pasos sintéticos y retry_wait; causa temporal no acreditada. No se amplió ningún timeout ni se cambió una guarda. **La suite local completa no se declara verde.** El helper P2 idéntico ejecutado por separado sí pasó4/4. La regresión SQL completa del SHA final se exige en CI.

No se imprimen datos de clientes, grants, credenciales, argumentos de procesos o rutas privadas en este informe. Evidencias nativas y errores originales se conservan localmente con acceso del propietario; logs CI del candidato permiten comprobar la prueba reproducible.

## Veredicto, continuidad y siguiente paso

**P2_PARTIAL.** IMPLEMENTADO/PROBADO/EJECUTADO solo en candidata y laboratorio sintético, no FUSIONADO ni DESPLEGADO al escribir este registro. P1 conserva su cierre acotado. Falta verificar/integrar esta candidata y acreditar las fronteras restantes del contrato, especialmente cancelación durante reconciliación, cierre de descendientes, rechazo de escrituras tardías y evidencia preservada. No iniciar P3.

Siguiente misión exacta de la misma orden: después de contrastar/integrar este incremento, **medir cancelación nativa durante reconciliación con checkpoint/auditoría/artefacto preservados y todos los procesos propios cerrados**. No readmitir misiones canceladas/terminales, resetear intentos ni inventar un servicio o lock global. Presupuesto y condiciones de parada siguen el contrato original; no ampliar límites por rutina.

Rollback: retirar solo la capacidad de esta propuesta mediante PR revisada y dejar la recuperación terminal integrada; detener únicamente procesos propios identificados y conservar ledger, artefactos, intentos y refs. Ninguna migración alojada que revertir. La revocación/host SQL siguen siendo autoridad confiable; no se certifica aislamiento frente a un administrador SQL adversarial.

Complemento actual localizado0.4.1 y preflight ejecutado; versiones0.1.0/0.2.0 de los informes anteriores son históricas. Heartbeat existente ACTIVE/6h y configuración SHA256 `88e378634f053acfa3b85ec063fd346dc56c34b6153a300ce4d831406b75bcbc` intacta. Los turnos documentales previos no se presentan como una misión Codex gobernada por SQL. PLAN Cloud permanece cerrado; sin hosted SQL, producción, clientes, proveedores pagos o eliminación de recursos preexistentes. Coste total del host no comprobado.

Recuperar [checkpoint único](CODEX_CONTINUATION.json), [estado](AUTOPILOT_STATE.md), [plan](MASTER_LINEAR_DEVELOPMENT_PLAN.md) y [prompt](CODEX_LINEAR_CONTINUATION_PROMPT.md) del commit publicado; reconciliar integración/CI reales antes de cualquier repetición.
