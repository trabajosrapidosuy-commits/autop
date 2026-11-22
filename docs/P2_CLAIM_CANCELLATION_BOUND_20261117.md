# P2 · Espera cancelable del claim de recuperación

Fecha: 17/11/2026, America/Montevideo. Misma orden
`ORD-P2-RECOVERY-VERIFICATION-20261117`, producto F0 y P2 parcial.

## Contrato y titularidad

Base remota verificada: `d9a07f93ccca3e4be01c428874c8111a2e62edfe`,
con PR #250 fusionada. Su head `b97e27e150a1a3eb6c8c37e139143019b09e7fc2`
tiene validate/postgres/CodeQL aprobados; el workflow principal de main también
terminó success. PLAN Cloud conserva failure y no se modifica.

Un solo escritor de esta candidata, rama `codex/p2-claim-cancellation-bound-20261117`.
Superficie: `missionRuntime.ts`, una nueva regresión unitaria y esta evidencia/
checkpoint. Se observaron cambios ajenos en las pruebas nativas de cancelación
del worktree existente: se conservaron sin editar, ejecutar ni incorporar.
Esta corrección pertenece al mismo frente P2 y no reemplaza esa prueba nativa.

Problema reproducible: `runMission` esperaba directamente `claimMission`.
El claim protegido puede esperar al oráculo independiente después de SQL;
una señal abortada o el deadline del runtime no liberaban esa espera.

Aceptación: el runtime rechaza con la razón original al cancelar, o con
`TimeoutError` al vencer su plazo, aunque el claim siga pendiente. Si después
llega un contexto, no ejecuta, guarda checkpoint, falla ni completa la misión.
Mantener guardas de SQL, permisos, leases y presupuestos existentes.

Permisos: desarrollo local sintético, publicación de rama/PR y CI.
Sin proveedor nuevo ni gasto externo contratado; Codex consume cuota del host,
sin medidor de coste por misión disponible. Se conserva el deadline existente;
solo las regresiones usan 20 ms y un watchdog de 1 s.
Rollback: revertir únicamente el cambio y su regresión. Detener escrituras si
cambia la titularidad/base o aparece un resultado incierto no conciliable.

## Cambio y evidencia

Se reutiliza `bounded` para esperar `claimMission`, igual que otros callbacks
del runtime. La comprobación posterior de señal permanece.

RED: las dos regresiones fallaron porque el runtime seguía esperando después
de la cancelación y del deadline. GREEN: 43/43 pruebas focales de runtime,
autorización y nuevo archivo. La verificación completa se registra en el
checkpoint de esta candidata y en la PR por su SHA exacto.

Las regresiones liberan el claim en `finally` y comprueban que su contexto
tardío no provoque efectos. Son pruebas de componente con ledger simulado;
no prueban cancelación de SQL, descendientes ni recuperación entre procesos.

## Límites y siguiente caso

Cancelar la espera no revierte un claim aceptado, no detiene por sí solo el
oráculo subyacente ni modifica política durable, attempts o lease. Cualquier
resultado SQL incierto se concilia con el ledger; no se repite automáticamente.

La revisión auxiliar en lectura detectó otro caso pendiente: cancelar durante
la segunda autorización dentro de `createAuthorizedMissionLedger.completeMission`
puede permitir que el wrapper invoque el write base después del aborto.
Reproducción con runtime/wrapper reales y ledger simulado, sin SQL:
`abort_during_ledger_policy → BASE_COMPLETION_WRITE_AFTER_ABORT_true → RUNTIME_RESOLVED`.
Envolver la espera exterior no impediría esa escritura interna. La siguiente
corrección debe propagar la señal hasta la frontera de escritura y comprobarla
después de la autorización, con regresión RED/GREEN; conservar la distinción
entre cancelar antes de admitir SQL y una escritura ya admitida.

No se declara cierre P2, cancelación integral, parada del oráculo, atomicidad
filesystem/SQL, despliegue, SQL alojado, envíos, Windows/cross-host ni operación
permanente. Automatización existente consultada mediante herramienta oficial
solo en modo view; no se alteró ni duplicó.

## Verificación posterior y siguiente dependencia · 17/11/2026

La integración observada de PR #251 deja main en 090486a91dd67f4b2855df4349b32077908f0e80. Diagnóstico exacto del head c1f1068ed1c0457e233988bcd8b8d9a0da6ad004: validate/postgres SUCCESS en 44029983256 y 44030019752, CodeQL/análisis SUCCESS en 44030015739, public-browser-smoke SUCCESS en 44030019767, Vercel y Vercel Preview Comments SUCCESS. Supabase Preview SKIPPED; no es validación alojada. Reviews y threads humanos vacíos cuando fueron consultados.

La siguiente dependencia, dentro de la misma orden P2, se probó con una regresión que falla si el segundo complete_write autoriza mientras llega una cancelación antes del write base. El runtime propaga la señal a authorizeEffect y comprueba abort justo después del grant; completeMission recibe la señal y la guarda vuelve a revisarla antes de consumir la atestación y llamar el writer base. Se conservan el AbortError original y el one-use attestation. Prueba del wrapper real con ledger base simulado verifica cero llamadas al write tras cancelación. RED observado, luego focal43/43, verify583/583, sin fallos/omisiones, lint/build/API/diff-check PASS. No se tocaron SQL ni recursos alojados.

El candidato local todavía no tiene PR ni CI. Sigue sin acreditarse un write ya admitido, cancelación nativa y descendientes: el worktree p2-cancel-reconciliation-20261117 continúa sucio/preservado y su resultado previo no se repite ni se integra por inferencia. P2 sigue parcial. Siguiente acción: una PR revisable, exact CI al head final y luego reconciliar de solo lectura ese worktree preservado. No auto-merge, hosted SQL, deploy o P3.


## 2026-11-17 23:09 UTC - PR252 y CI exacta en curso

PR #252 abierta desde `codex/p2-cancel-ledger-boundary-20261117` al main `090486a91dd67f4b2855df4349b32077908f0e80`; commit inicial `63e3dfada088ad6d8fbec74837d0c48a35c418e1`. No se fusionó ni desplegó. CI del SHA: validate y postgres siguen `in_progress`; CodeQL y public-browser-smoke siguen `in_progress`; Vercel y Vercel Preview Comments `success`; Supabase Preview `skipped` (no es prueba alojada). Sin revisiones ni threads al momento de crearla. PR enlazada: https://github.com/Victoriosas/autopilot/pull/252.

La continuidad se actualiza en este mismo candidato: orden P2 sigue parcial; siguiente paso verificar checks contra el head real más reciente de #252, luego inspeccionar de solo lectura el worktree nativo sucio de cancelación/descendientes y reconciliar el resultado previo antes de cualquier repetición. No merge/deploy/SQL alojado/dispatch/P3.


## 2026-11-17 23:10 UTC - reconciliación de head de PR252

El SHA 001497244c5bde1d6c5554a9e4db4fed544cd0ad fue el destino exacto de la última consulta de CI: validate/postgres y CodeQL/browser seguían en curso; Vercel, Security Review y Preview Comments pasaron; Supabase Preview quedó skipped. Después se creó este commit de continuidad, por lo que el head actual de #252 debe resolverse en vivo antes de atribuirle checks. PR252 continúa abierta, sin merge/deploy ni revisión humana observada.

La siguiente misión sigue en la orden P2 existente: consultar el SHA actual y checks exactos de #252; una vez terminales, lectura únicamente del worktree nativo preservado y reconciliación de proceso/resultado. No repetir efectos inciertos ni tocar ese árbol.


## 2026-11-17 23:18 UTC - CI #252 aprobada y reconciliación nativa bloqueada

PR #252, abierta/no fusionada/no desplegada, main base `090486a91dd67f4b2855df4349b32077908f0e80`. En el SHA exacto `a922107fde44dbeb5c3adab8cafe347dc6f484c7`, validate, postgres, CodeQL (actions/javascript-typescript/python), public-browser-smoke, Vercel Security Review, Vercel y Vercel Preview Comments quedaron SUCCESS. Supabase Preview SKIPPED, sin evidencia alojada. Reviews y threads humanos vacíos al consultar. Este registro crea otro commit solo documental; el siguiente ciclo debe resolver el head vivo nuevo antes de atribuirle estos checks.

Auditoría únicamente de lectura del worktree preservado `p2-cancel-reconciliation-20261117`: sigue sucio en cinco archivos (dos SQL staged locales, dos fixtures de proceso y el test de operador); el diff implementa una cancelación nativa de recuperación, limpieza de descendiente y verificaciones de checkpoint/auditoría/escrituras tardías. No se encontró un proceso relacionado ni listener en puerto 28447. Tampoco se encontró recibo terminal ni salida persistida del test; por tanto el efecto previo queda sin clasificar. No se repitió, detuvo ni modificó nada.

Estado P2 sigue parcial. La siguiente acción exacta es recuperar la salida/recibo original de ese test; si no existe, registrar la dependencia humana/evidencia faltante y mantener el worktree intacto. No reiniciar operación incierta por inferencia. Sin SQL alojado, misión/claim/dispatch, merge, deploy, P3 ni cambios de automatización.


## 2026-11-17 23:30 UTC - CI completo en PR252; ejecución nativa sin recibo

En PR #252, el head `bd7cf7287a28c95eab9c58bfc245bce30e4e7cdd` (base main `090486a91dd67f4b2855df4349b32077908f0e80`) terminó con validate, postgres, los tres análisis CodeQL, public-browser-smoke, Vercel Security Review, Vercel y Vercel Preview Comments en SUCCESS. Supabase Preview quedó SKIPPED y no prueba integración alojada. La PR continúa abierta, sin merge ni deploy; reviews y threads vacíos. Este commit de continuidad es documental y mueve el head, así que la próxima lectura debe resolver el SHA vivo y CI exacta antes de integrar.

Lectura del trabajo preservado `p2-cancel-reconciliation-20261117`: cinco archivos modificados (dos SQL staged locales, dos fixtures de proceso y el test de operador). El diff implementa cancelación nativa de recuperación, cierre del descendiente y comprobaciones de checkpoint/auditoría/escrituras tardías. No se halló proceso asociado ni listener en 28447. El checkout y el extracto reciente de continuidad revisado no contienen recibo/salida terminal de esa ejecución; el resultado previo queda sin clasificar. No se ejecutó, detuvo ni alteró el trabajo.

Próximo paso: recuperar el output/recibo original de esa operación desde su sesión o artefacto. Si no existe, mantener la verificación bloqueada y el worktree intacto; no repetir efectos inciertos. P2 sigue parcial, sin P3, hosted SQL, dispatch, producción, merge ni cambios a la automatización.
