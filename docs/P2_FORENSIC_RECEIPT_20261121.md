# P2: recuperación forense del intento original

Orden `ORD-P2-RECOVERY-VERIFICATION-20261117`. Observación 21/11/2026, 00:15 UY. Base revisada `02450f1084077505d89ccb5d65f54a83c0001449`. **INDETERMINADO**, con cancelación durable ahora acreditada; P2 completa sigue parcial. No es cierre del proyecto.

## Procedencia y preservación

Host observado: micahael-PC. El transcript original del hilo `01a0e385-4c88-7b52-bdc1-4ccdb19311e8`, registros ordinales 9049–9069, confirma lanzamiento a las 06:22:59.901Z del 17/11 y sesión12801. Cuatro consultas devolvieron salida vacía; última a las06:23:48.021Z, sin exit_code. Una consulta posterior a las22:42:50.187Z devuelve Unknown process id12801. Esto no acredita salida del controlador ni descendientes. No se publica el transcript completo.

Origen sintético conservado: `%TEMP%/victoriosas-p2-cancel-lab-20261117-e/data`; configuración original en `%TEMP%/autopilot-operator-cli-IaWljH/host.json` fija modo local_synthetic_lab, puerto28447 y no_send. No hay listener28447 ni proceso del PID1388 registrado en postmaster.pid. Otros procesos PostgreSQL existen y no se atribuyen al ensayo.

Se creó copia forense separada en `%TEMP%/victoriosas-p2-forensic-20261121`, dentro de la autorización vigente para diagnóstico sintético aislado. Se verificaron **1300 archivos por SHA256 antes del arranque de la copia**. El origen carecía de directorios vacíos PostgreSQL: se crearon exclusivamente en la copia; también se retiró exclusivamente su postmaster.pid copiado. Primeros dos arranques de copia fallaron por pg_notify ausente; tercer arranque exitoso tras crear los directorios vacíos. No se reconstruyeron páginas ni registros SQL. PostgreSQL18.3 recuperó WAL desde0/1D18A98 hasta0/1D18BA0; no se presenta como snapshot consistente tomado durante la ejecución original.

Copia servida solo en127.0.0.1:29447, default_transaction_read_only=on y autovacuum=off. Un proceso psql separado del executor extrajo la fila y auditoría originales mediante SELECT; no se llamó ninguna función de autorización, claim, checkpoint, cancelación o completado. La copia fue detenida después. **Relectura de los1300 hashes del origen: cero cambios**. No se inició el clúster original, reemitió misión, aplicó SQL staged ni canceló proceso ajeno. Los cinco archivos del worktree preservado siguen sin stage ni modificación por esta sesión.

Exportación saneada: [recibo SQL](audits/evidence-20261121/p2-cancel-ledger.json), SHA256 original `448270468eaf3afc445fea8f30d854e062bf3ad6db4de7402f7c53cc0b3ca032`. El recibo versionado usa LF, SHA256 `85360bcebf354fdb7282aa6e0baf55bbc8add968109d1edaee50ebf2afdc1392`; la exportación original conserva CRLF y su hash anterior. El manifiesto completo y log de recuperación se conservan en la copia local; no contienen una nueva ejecución de la misión.

## Tabla de aserciones del caso cancel

Fuente de expectativas: `tests/fixtures/protectedEffectRecoveryProof.ts` y `p1ProtectedRestartProcess.ts` del worktree preservado `C:/autopilot-worktrees/p2-cancel-reconciliation-20261117`; su HEAD/diff no se integran. Hora SQL en UTC del17/11; restar3h para UY.

| Esperado | Observado | Fuente / hora |
|---|---|---|
| Interrupción tras efecto, antes de checkpoint modify | CP2 guarda solo prepare-v1; efecto conservado; SIGKILL y PID inicial no recuperados | SQL evento34,06:23:22.534353Z; transcript sin recibo IPC |
| Lease activa impide recuperar | recovery_policy_denied para scope/versiones inválidos; no demuestra cada aserción de lease | postgres.log06:23:39.207–39.439Z |
| Grant fresco y segundo intento | revisión3, executor local:34f57878-f364-4c32-9d29-b1f5145e61d7; claim segundo run15ca9afb-8eb7-47d5-8775-62a0ece810e4 | auditoría52–54,06:23:39.610194–40.289385Z |
| Reconcile solo lectura exactamente1; execute0 | Sin contadores/recibo del child | NO ACREDITADO |
| IPC process_started, operación reconcile_cancel_wait y PID distinto | Sin recibo IPC original | NO ACREDITADO |
| Antes de cancelar: in_progress/CP2/intento2/lease activa | CP2 y segundo claim correlacionados; falta observación completa en esa frontera | SQL34/53; NO ACREDITADO completo |
| Cancelación durable gana | mission_cancelled; estado cancelled, último error cancelled_by_operator | auditoría55,06:23:41.725164Z; fila actualizada06:23:41.731022Z |
| CP3/intento2, lease inactiva | version3, attempts2, lease null y token null | recibo SQL original recuperado21/11 |
| Preservar completed_steps y artifacts | completed_steps=[prepare-v1], artifacts=[]; no hay snapshot completo previo para deepEqual | CP3 y auditoría34; PARCIAL |
| AbortError llega al runtime | Sin salida del child | NO ACREDITADO |
| Node cierra code0/signalnull en15s | Terminal12801 sin exit_code | NO ACREDITADO |
| managed descendant emite process_ended para el mismo PID | Sin recibos/PID originales | NO ACREDITADO |
| Late checkpoint devuelve false | CP3 sin cambio posterior; no prueba que se ejecutó el intento negativo | NO ACREDITADO |
| Late completion devuelve false | completed_evidence null; no prueba invocación/rechazo | NO ACREDITADO |
| Checkpoint final intacto tras ambos negativos | Último evento55 y CP3; falta snapshot inmediatamente anterior y recibos negativos | PARCIAL |
| Bytes e identidad del efecto iguales antes/después | SHA256 actuales coinciden con referencias suministradas; inode/mtime/birthtime pre-cancel no recuperados | archivos17/11,03:23:23 UY; hash reobservado21/11 |
| Descendiente y replacement PID ausentes; presupuesto<90s | Sin identidades ni tiempos finales originales | NO ACREDITADO |

Misión única correlacionada: `synthetic-protected-node-effect-cancel-cead08`. Hash result.txt `8672c47a3472e0d4396a67369765cb378e0d870feb8d9846d486b647f1a14d6a`; result.test.cjs `ac07c529bf446aabc48efe58987d36a117ae8cbd5677151d487c0fe05a58c3f0`. Coincidencia actual no demuestra identidad temporal ni ausencia de reescritura intermedia. Los recovery_policy_denied pertenecen a pruebas negativas anteriores al claim permitido; no se clasifican como fallo de recuperación.

**Veredicto:** ninguna observación recuperada contradice una aserción, pero faltan pruebas decisivas del mismo intento. INDETERMINADO, sin certificación de descendientes ni late writes. No reabrir ni repetir esta misión. Reabrir la investigación solo ante stdout/IPC/recibo original con PIDs, salida, negativos y metadatos pre/post; conservar copia y originales mientras tanto.

## Medición actual y puertas posteriores

- GitHub main02450f1; #260 integrada por a090afd y #261 integrada por02450f1, sin PR abiertas al inicio. Se comparó el alcance documental de260 con main antes de tocar checkpoint. Fetch inicial falló DNS; resolución DNS del sistema y curloptResolve temporal permitieron fetch normal, sin cambiar configuración persistente.
- Main exacto: validate/postgres y tres CodeQL SUCCESS; PLAN Cloud run44858707202 falla con cloud_ledger_adapter_not_configured, executed=false. Supabase Preview SUCCESS no sustituye consulta de estado remoto ni prueba de recuperación.
- Vercel get_deployment(victoriosas.online): alias servido por dpl_BZtJAZCoziWzH3fTiDtQUxy7TQ9a, READY, SHA9d6bbdb5f7c7200fe62463cd904314edbb9f86f0. No es prueba HTTP del runtime.
- Heartbeat existente victoriosa-autopilot-6h: TOML ACTIVE, RRULE:FREQ=MINUTELY;INTERVAL=30. Recibo del hilo a02:46:16Z21/11 terminó SIN CAMBIOS. No se cambió cadencia/ID/destino; ACTIVE no acredita salud ni vínculo a un claim SQL.
- Procesos y worktrees inventariados; no proceso observado identifica el worktree forense nuevo. No hay prueba de lock global entre hosts. No se sobrescribe el checkout raíz atrasado ni otros worktrees.
- Cola principal medida por Supabase MCP mediante agregados SELECT a03:21:12Z21/11:64 tareas y130 eventos, todas infrastructure;45 completadas,13 queued,6 blocked,0 running/leases activas. Último completado20/11,20:31:48.9449Z. Siete tareas tienen attempt_count>1; no acredita recuperación correcta. Director/software/consultations/followup/reports tienen cero tareas en esta cola: no prueba ausencia de actividad en otras entradas. Las19 abiertas son read_only_public_health: las6 bloqueadas tienen máximo3 intentos y antigüedad desde28/10; las13 queued tienen0 intentos desde14/11. Ningún retry, claim o mutación remota. [Agregados saneados](audits/evidence-20261121/six-role-metrics.json). Run observability44858597904 SUCCESS no se usa como sustituto de estas métricas ni de demostración end-to-end; descarga de logs falló por DNS del receptor.

| Capacidad | Etapas acreditadas / reproducción | Versión y limitación |
|---|---|---|
| Victoriosas profesional | DEFINIDA; componentes históricos implementados/fusionados. Recorrido solicitado staging→cierre, negativos de fuente/precio/consentimiento/permisos y acuse simulado: NO PROBADOS como circuito integral en esta sesión | P5/P6 dependen de P2–P4; sin comando integral certificado; no_send conservado |
| Autopilot operativo | Runtime IMPLEMENTADO/FUSIONADO; CI exacta PROBADA; cancelación durable del intento original EJECUTADA y ahora observada. Seis roles/continuidad cloud/autodesarrollo integral: NO DEMOSTRADOS | base02450f1; recibo original17/11, sin SHA ejecutado atribuible al árbol sucio; matriz P2 incompleta |
| Autopilot extensible | DEFINIDA; contrato comercial sintético aún sin demostración autorizada por puerta del plan | No activar integración o multiempresa antes de puertas dependientes; no comando end-to-end certificado |

Reproducción segura de la observación recuperada, sin arrancar recursos ni ejecutar misiones:

```powershell
$e = Get-Content docs/audits/evidence-20261121/p2-cancel-ledger.json -Raw | ConvertFrom-Json
$e | Select-Object id,state,version,attempts,lease,token_present
$e.audit | Select-Object id,event_type,created_at
```

Resultado esperado de esta lectura: cancelled/3/2, lease nula, token_present=false, evento55 mission_cancelled. Es comprobación del recibo conservado, no ejecución nueva ni verificación independiente completa de P2. Observador psql separado acredita únicamente estado durable; no sustituye observador de descendientes.

Se recorrieron P2–P6, oficina y extensibilidad: nueva evidencia de pruebas de componente no completaría los recibos faltantes del mismo intento; las demostraciones integrales posteriores conservan dependencias sin satisfacer. No se crean implementaciones paralelas ni commits repetidos. Presupuesto local: copia67.4MB y tres intentos de arranque aislado; cero llamadas nuevas a inferencia o proveedor comercial, sin certificación de coste externo total. Rollback documental por revert; conservar datos/evidencia y cinco archivos ajenos.
