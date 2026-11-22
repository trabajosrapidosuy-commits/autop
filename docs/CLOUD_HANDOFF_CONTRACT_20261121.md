# Handoff cloud por el adaptador existente

Orden `ORD-THREE-DEMONSTRATIONS-20261121`, carril D, staging sintético. **IMPLEMENTADO y PROBADO localmente**; no entrega cloud acreditada. P2 se conserva sin reapertura.

## Recorrido y permisos

`PLAN Cloud / hosted-handoff → fuente CI verificada → consumeCloudHandoff → CloudMissionStore.status → CLI resume existente → ledger/efecto → observación final`.

El modo manual reutiliza el job `hosted-ledger`, el environment `p0c-hosted-ledger`, el SHA revisado exacto y la configuración TLS/rol del runner existentes. No añade provisioning/admisión, tabla, cola, scheduler o ledger. `workflow_run/continuation` conserva su barrera fija: no hace checkout/descarga del código o artefactos de la rama iniciadora y no obtiene secretos para ejecutar candidatos. No se borra el motivo original `cloud_ledger_adapter_not_configured`, observado en run44854526918 y sus sucesores.

El handoff solo acepta el run de Autopilot Core canónico (`.github/workflows/autopilot-core-v4.yml`), push de main, repositorio propietario, completed/success y SHA exacto. Se hace una lectura GitHub API a host fijo con actions:read. El input source_run no es autorización ni se ejecuta su contenido. El host fija misión, binding, caducidad y máximo25s; la aprobación se relee tras IO. El mismo SQL sigue resolviendo claims concurrentes, leases y fencing. Una observación busy o terminal no invoca el runtime. Invocación del runtime (`executed`) no implica completado ni rollback de efectos admitidos si vence el deadline.

Permisos: contents:read/actions:read más las capacidades preexistentes del rol aislado `autopilot_cloud_runner`; sin credenciales en el child salvo los ficheros protegidos ya exigidos, sin permisos sobre el proyecto principal y sin write de repositorio. Se mantienen CA/verify-full, identidad SQL, environment y marcador de ledger existentes.

## Prueba reproducible local

En checkout de esta PR o main que la contenga, Node24 y dependencias del lockfile:

```powershell
node --import tsx --test src/autopilot/cloudLedgerHandoff.test.ts
```

11/11 PASS: contrato estricto, ausencia de configuración sin IO, source run ajeno/fallido/obsoleto, scope y presupuesto, busy/terminal duplicados, recuperación por driver y observación final, revocación durante IO, proveedor indisponible saneado sin retry, deadline propagado checkpoint regresivo rechazado y cierre del child gestionado antes de liberar recursos temporales. Estas pruebas usan el contrato de almacenamiento/driver en aislamiento; no son entrega SQL alojada ni autenticación cloud real. La regresión SQL TLS entre dos procesos existente sigue en CI, sin atribuirla a un handoff alojado.

## Límite remoto observado y condición precisa

Lectura Actions21/11: `AUTOPILOT_CLOUD_SCHEDULE_ENABLED=false`; `P0C_HOSTED_REVIEWED_SHA=a4ca9dd31afa6f576d0bd5e52bc83ffb72e9272c`, distinto de main medido66da49d. El environment existente exige revisor y `prevent_self_review=true`, con un único revisor registrado. No se alteraron variables, secretos, ACL o aprobaciones; no se disparó un run inútil que no satisficiera su guarda. Este bloqueo no impide las pruebas locales ni los carriles A/B/C.

Para verificar remoto: SHA integrado revisado configurado mediante la autoridad del environment, misión sintética ya admitida y autorizada con binding correcto, run Core exitoso del mismo SHA y aprobación independiente disponible. Luego invocar el **mismo** workflow manual con mode=hosted-handoff, mission_id y source_run. No reutilizar la misión P2 incierta; se deniega explícitamente. No hay autorización para saltar prevent_self_review ni para inferir que el token de GitHub concede derechos SQL. Los secretos existentes no fueron leídos ni modificados.

Rollback: revertir únicamente integración del handoff; runner status/resume y barrera automática originales siguen conservados. No borrar estado ni reabrir misiones terminales. Multiempresa queda fuera de esta orden por PROJECT_DIRECTION/F8.

## Revisión independiente

Agente revisor del carril B,21/11: reprodujo rechazo de promisify(execFile) por abort a231ms frente close a269ms. Se corrigió el driver a ManagedProcesses.exec; el finally espera processes.close antes del cleanup del host. Regresión Windows de child propio confirmó mismo PID process_started/process_ended y size0. Revisión posterior confirma corrección. **Límite Linux/cloud:** el gestor existente crea grupos detached para hijos; no se acredita cierre transitivo de nietos con otro PGID. Esta prueba no autoriza afirmar recuperación cloud ni cierre transitivo de procesos remotos; requiere ensayo Linux independiente antes de esa certificación.

Verificación local completa: npm run verify exit0,608/608,0fail/skip,tipos/builds/API PASS; regresión focal final11/11. Node_modules locales reutilizadas (Vite6.4.5 observado), sin afirmar equivalencia al lockfile actual; CI npmci del SHA publicado verifica dependencias canónicas. Python/PyYAML y parsers YAML Node no instalados en este entorno; estructura revisada por diff y análisis Actions en CI, sin inventar validación YAML local.
