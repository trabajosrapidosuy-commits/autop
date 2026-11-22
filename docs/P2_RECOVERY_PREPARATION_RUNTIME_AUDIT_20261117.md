# Preparación P2 y auditoría de continuidad — 17/11/2026

> Actualización17/11: el propietario indicó continuar después de integrar249. Se activa solo el primer incremento local P2, orden ORD-P2-RECOVERY-VERIFICATION-20261117. [Implementación y evidencia](P2_PROTECTED_EFFECT_RECOVERY_20261117.md). El estado PREPARADO/NO ACTIVADO inferior es historia de la propuesta anterior; no limita la autorización posterior ni acredita cierre P2. Cloud/producción/automatización conservan sus barreras.

**Historia: PREPARADO, NO ACTIVADO al presentar249.** Este contrato completa la directiva de cierre P1 y preparación de continuidad. No ejecuta P2, no cambia el runtime ni constituye una nueva orden/cola/scheduler. Autoridad: [plan único](MASTER_LINEAR_DEVELOPMENT_PLAN.md), [dirección de producto](PROJECT_DIRECTION.md) y [checkpoint único](CODEX_CONTINUATION.json). La orden P1 `ORD-P1-SUPERVISOR-ADAPTER-20261114` queda cerrada técnicamente; ningún ID P2 activo se emite hasta su activación autorizada.

## P1 integrada y autorización

El propietario autorizó expresamente las acciones de integración del repositorio en esta continuación. Tras revisar el head `8d335bf90a3acede62ee3a60989af44340ce2ffa`, CI exacta y ausencia de threads pendientes, se marcó [#248](https://github.com/Victoriosas/autopilot/pull/248) lista y se fusionó explícitamente con expected head SHA. Merge: `8633b3625b2109d21ef313adc168bd54c96ddeb4`. No se programó auto-merge, usó bypass, borró rama ni desplegó manualmente. Esta autorización permite integrar las propuestas revisadas de esta continuación con controles cumplidos; no activa P2, producción, SQL alojado, gastos o cambios de automatización.

**P1_CLOSED_WITH_BOUNDARIES** permanece sustentado por la [matriz P1](P1_EXIT_REVIEW_20261117.md). [CI del merge exacto44020226387](https://github.com/Victoriosas/autopilot/actions/runs/44020226387): validate/postgres SUCCESS, CodeQL tres análisis SUCCESS. Validate:575 tests,574 pass,0 fail,1 preparación PowerShell exclusiva de Windows omitida en Linux. [Postgres133827688246](https://github.com/Victoriosas/autopilot/actions/runs/44020226387/job/133827688246) registra de nuevo proceso Node nuevo, grant nuevo, fencing, intento2/checkpoint5 y rechazo de artefacto adulterado; operador1/1 sin omisiones. No se repitieron suites locales intactas. [PLAN Cloud44020570320](https://github.com/Victoriosas/autopilot/actions/runs/44020570320) falla cerrado con source CI success; su barrera se conserva.

## Contrato del primer incremento P2 propuesto

**Problema concreto:** la ruta protegida integrada admite recuperación únicamente `ready_to_complete`. Existen pruebas legacy de efecto aplicado sin checkpoint y relanzamiento, pero no prueban ese escenario bajo la política durable y autorización por efecto del runtime protegido. No es un defecto oculto de P1 ni permiso para saltarse su fábrica.

**Primer objetivo:** extender el fixture existente para medir interrupción tras escribir el efecto sintético y antes de su checkpoint, reconciliándolo en un proceso nuevo con permiso host nuevo y oráculo fuente independiente. Si requiere capacidad de recuperación protegida `in_progress`, diseñar y revisar esa extensión explícita dentro de P2 antes de usarla. No ampliar un grant terminal, precargar permisos legacy ni omitir las guardas para fabricar un positivo.

**Base propuesta:** main8633b36, que se volverá a contrastar al activar. Un solo escritor por superficie; branch/worktree exclusivamente propios y sin cambios ajenos. El preflight del complemento no acredita exclusión; comprobar identidad/cwd cuando estén disponibles y no afirmar un lock global por tener worktree. Si aparece otro escritor o no puede acreditarse titularidad del área, detener mutaciones y continuar solo lectura.

**Superficie propuesta, aún sin editar:** `tests/mission-operator-postgres.test.ts`, `tests/fixtures/p1ProtectedRestartProcess.ts` o una extensión del fixture de runner/planner existente; `missionRuntime`, `missionAuthorization` y `LocalMissionStore` solo si el contrato mínimo P2 revisado lo requiere. SQL staged únicamente si es imprescindible y probado en base desechable, nunca alojado. No añadir otro ejecutor genérico, controlador, supervisor, ledger, cola o scheduler. El oráculo permanece fuera del área modificable del candidato y fijado a una fuente revisada.

**Identidad y efectos:** ID de misión sintética nuevo y explícito, F0, base/binding/versiones/revisión/grant emitidos por host confiable; ningún secreto o token en documentación. Único efecto permitido: archivos sintéticos canónicos dentro del worktree de esa misión. Sin red, clientes, correo, comandos de issue/payload ni acceso administrativo del executor. Mismo `agent_tasks`, claims, leases, fencing y auditoría existentes. No readmitir misiones terminales/canceladas ni resetear intentos para reintentar.

**Presupuesto propuesto:** cero proveedores pagos o nuevos servicios; cuota Codex del host no es gratuita ni está medida por estas skills. Un escenario determinista por incremento. Reutilizar límites existentes compatibles (el fixture protegido actual usa lease10s/deadline8s); cada caso máximo90s, máximo dos controladores más el probe de lease si procede, sin bucle de reintentos. Si el caso excede su límite, conservar fallo/evidencia y diagnosticar, sin aumentar timeouts o rebajar guardas por rutina. `verify` y SQL completos dentro de los límites de CI actuales; medir duración real después de autorizar. No es un límite de coste/tokens técnicamente implementado.

| Frontera o negativo solicitado | Reutilización / evidencia existente | Aceptación que falta medir en P2 |
|---|---|---|
| Antes del claim | `missionRuntime.test.ts`: abort antes de claim | Proceso interrumpido sin claim, intento o efecto; snapshot/auditoría invariantes |
| Después de efecto confirmado / sin checkpoint definitivo | `mission-runner-postgres.test.ts`: SIGKILL después del efecto, resultado reconciliado; camino legacy | Mismo escenario protegido, efecto existente detectado por oráculo, grant nuevo y sin segunda escritura del efecto |
| Checkpoint antes de cierre | #247 prueba salida Node con ready_to_complete y relanzamiento protegido | Conservar esa cobertura; sumar muerte forzada en frontera explícita solo si añade evidencia distinta |
| Escritor antiguo / lease | SQL fencing y tests de token viejo ya integrados | Token/grant anterior no muta checkpoint/completa/falla durante reemplazo; no takeover de lease activa |
| Resultado incierto / artefacto ausente o conflictivo | `mission-planner-postgres.test.ts` deriva/reconcilia y bloquea conflictos | Resultado desconocido no provoca retry ciego; reconciliar por estado/artefacto y bloquear si no verificable |
| No duplicación | Legacy compara mtime y resumen; #247 prohíbe observe/plan/execute en terminal | Hash, identidad/mtime y contenido del efecto antes/después más auditoría y operaciones confirmadas; un contador solo no prueba unicidad |
| Verificador externo al candidato | Oráculo canónico independiente en fixture247 | Fuente/hash revisados fuera de la allowlist del candidato; resultado adulterado/autocertificado bloquea y conserva evidencia |
| Cancelación y descendientes | `managedProcesses.test.ts` abort/timeout/descendientes; revoke durable SQL | Cancelar escenario propio, confirmar cierre de todos sus procesos y denegación de escritura tardía; conservar checkpoint/auditoría/artefacto |
| Recuperación y rollback | Mismo ledger y gestores de procesos | Recuperar con proceso nuevo o dejar bloqueo explícito; rollback detiene solo procesos propios y no borra evidencia, reabre misión cancelada ni resetea intentos |

**Pruebas posteriores a activación:** primero negativo/RED que exponga la garantía no cubierta; corregir únicamente contrato necesario; focales, `npm run verify` para código y PostgreSQL18 desechable, más CI exacta validate/postgres/CodeQL. Conservar primer fallo y diagnóstico; skipped no es pass. Las pruebas Linux, Windows y cross-host se reportan separadamente. No reciclar la autorización temporal ORD-204G ni ejecutar ventanas vencidas.

**Condición de parada:** falta de autorización de ejecución P2, escritor/ownership incierto, lease activa, grant caducado, evidencia incompatible, cancelación, cuota/acceso agotados, presupuesto excedido o resultado externo no reconciliado. No avanzar efectos dependientes. Guardar checkpoint y referencias saneadas; no crear otro servicio para superar la barrera.

**Rollback:** cancelar solo la misión sintética propia bajo su permiso y esperar cierre de procesos/descendientes; conservar ledger, artefactos, intentos, refs y evidencia. Revertir únicamente el eventual incremento revisado mediante PR. La preparación documental puede revertirse sin tocar P1. Esta secuencia está definida, no medida todavía como ensayo P2.

## Auditoría del complemento y el ejecutor

Paquete local encontrado: **autopilot-autodesarrollo0.2.0**, frente a la ruta0.1.0 obsoleta del catálogo de esta sesión. Se leyeron `autopilot-recuperar`, `autopilot-ciclo`, `autopilot-runtime`, política/evidencia/plan/continuidad y el manifest; no se recreó ni reinstaló. El preflight real ejecutó Git en lectura con `GIT_OPTIONAL_LOCKS=0`, valida el remoto y minimiza el inventario. En la raíz histórica observó HEADa6cff5a,0 cambios rastreados,140 entradas sin seguimiento y checkpoint ausente; en el worktree248 limpio, checkpoint presente. La raíz se conserva íntegra.

El preflight deja remoteFreshness/concurrentWriters/runtime como NOT_CHECKED y mutationAuthorized=false: son límites de su inventario, no revocación de la autorización actual del usuario. No emite grants, no verifica una lease global ni inicia Codex. Lectura manual efectiva de0.2.0 y preflight PROBADOS; descubrimiento automático actualizado en un host Codex nuevo NO COMPROBADO. No hay evidencia suficiente para concluir que está deshabilitado por no aparecer en una entrada concreta del TOML.

## Heartbeat existente: configuración y runs reales

Se usó la herramienta oficial `automation_update` en modo view, sin modificación. ID `victoriosa-autopilot-6h`, heartbeat ACTIVE cada seis horas, destino existente conservado. Huella SHA256 de configuración completa: `88e378634f053acfa3b85ec063fd346dc56c34b6153a300ce4d831406b75bcbc`. Prompt referencia checkpoint/prompt canónicos, pero conserva ejemplos históricos de #238/P1 y no nombra las skills nuevas. La auditoría no lo sustituye ni cambia frecuencia, destino, permisos o configuración.

Lecturas SQLite dirigidas en modo read-only corroboran metadata de programación. Registro actual coincide con TOML; registro secundario de desarrollo tiene fechas/prompt antiguos, sin reconciliarlo ni modificarlo. `last_run_at` observado16/11 23:53:00.899Z y próximo disparo reportado17/11 05:52:31Z. Esa fecha es metadata observada, no garantía de recepción futura. Las tablas automation_runs están vacías para este heartbeat; **no significa que no hubo ejecuciones**, porque sus turnos están en el chat destino.

La herramienta oficial `read_thread` sobre ese destino existente confirmó:

| Evidencia | Resultado verificable | Lo que no demuestra |
|---|---|---|
| Turno16/11 17:49:24Z, completado, duración172178ms | Envelope heartbeat con este automation_id; recuperó orden/SHA/PR y terminó SIN_CAMBIOS | No nueva misión ni efecto SQL |
| Turno16/11 23:53:01.934Z, completado, duración363907ms | Envelope heartbeat, lectura del checkpoint aislado, commit/push documental `bebaf18dc83dcb4703b56b1768146b98a69e9be2`; Git verifica que es ancestro de main y cambia solo estado/JSON | No corrección general de código, misión SQL protegida, autorización P2 ni ejecución del paquete0.2.0 |

Por tanto **PROGRAMADO y RUN_INICIADO están observados; CICLO_VERIFICADO solo para conciliación documental**. El hallazgo supera la incertidumbre histórica sobre recepción. No acredita que cada futuro disparo tenga PC/cuota/herramientas, que reciba esta rama nueva ni RECUPERACION_VERIFICADA de un ciclo Codex gobernado por ledger. No se exportan IDs de chats, rutas de perfil, transcripciones completas o argumentos de procesos a Git.

## Dependencias reales para autodesarrollo gobernado

| Puerta | Evidencia actual | Estado / siguiente condición |
|---|---|---|
| Complemento y Codex | Skills0.2.0 legibles y preflight ejecutado; turnos locales con herramientas y commit/push reales | PROBADO manual/documental; falta acreditar nueva versión automáticamente en un run |
| Recuperación del checkpoint | Heartbeat leyó JSON en worktree aislado; este checkpoint publicado se valida en otro proceso antes de integrar | PROBADO documental; no extender a SQL recovery general |
| Un escritor | Propio worktree limpio, sin procesos cuya línea identifique ese ámbito al observar; SQL fencing probado en su dominio | Exclusión entre escritores Codex/hosts NO COMPROBADA; no equivale a claim SQL |
| Presupuesto | Duraciones de dos turnos observadas; no se iniciaron proveedores pagos | Coste/tokens por misión y apagado por cuota NO COMPROBADOS; no inventar tarifa cero |
| Revocación/parada | Pruebas de política durable y managed abort/descendientes integradas | Componente PROBADO; pausa/revocación end-to-end durante misión heartbeat→Codex→SQL NO MEDIDA; no se pausó el monitor para simularlo |
| Codex ↔ ledger | ExecutorAdapter define interfaz; executors de selfDevelopment/readiness son laboratorios acotados | No hay recibo mission_id/claim/efecto que vincule el turno Codex observado a una misión SQL protegida. Integración general pertenece a P4 tras P2/P3 |
| Cloud | TLS/transporte y fixtures locales históricos diferenciados | PLAN Cloud cerrado; continuidad real autorizada entre hosts y efecto durable pendiente P3 |

La próxima acción exacta es **autorizar y preflightar la ejecución del primer incremento P2 de recuperación protegida del efecto sin checkpoint**, con su identidad, fuente del oráculo, presupuesto y área confirmados. La autorización de integración vigente no sustituye esa activación. No solicitar de nuevo permiso para integrar propuestas que ya cumplan este alcance; conservar la barrera de ejecución P2 mientras no cambie.

Una alineación futura del prompt del mismo heartbeat debe invocar las skills actuales, eliminar referencias fijas a PR superadas, leer el checkpoint vigente y mantener los permisos que este indique. Necesita una necesidad confirmada y autorización de configuración; no se aplica en esta auditoría en lectura. No crear heartbeat/chat/scheduler alternativo ni alterar cadencia6h. La ausencia de un adaptador cloud no se resuelve desactivando su barrera.

## Validación y límites de esta entrega

Solo documentación: JSON/esquema compatible, orden única, coherencia de fase/prompt, enlaces locales, preservación histórica, diff y secret scan. CI propia del commit contenedor se consulta por rama/PR y se observa antes de integración autorizada; no se atribuye la de8633b36 ni se crea un hijo rutinario de CI. Ninguna prueba P2 se ejecutó y ninguna fuente/tests/SQL/configuración se modificó. Revisión crítica del mismo ejecutor; no presentada como aprobación independiente. Sin SQL alojado, clientes, gasto nuevo, despliegue manual o borrado de recursos. Coste total NO COMPROBADO.
