# P0 · Revisión de privacidad y recuperación local

Fecha de referencia: 14/11/2026, America/Montevideo. Los recibos técnicos usan UTC. Orden ejecutada: **ORD-P0-RECONCILE-LOCAL-20261114**. Referencia: PR235/head `0f2482fab0f04b5fc58e2d7fc94c0e8d12923bda`. Continuación exclusiva de P0; ningún desarrollo de P1.

## Veredicto revisable

**Orden local ejecutada con límites explícitos. P0 preparada para revisión, todavía no declarada cerrada.** Los dos worktrees tienen propietario de proyecto, propósito y consumidores acotados identificados; sus fuentes y cambios se conservaron cifrados y se recuperaron en memoria desde un proceso nuevo. Ambos quedan **CONSERVAR**. No se propone su eliminación.

Los gates pendientes de P0 son la revisión/CI de esta remediación de privacidad, la aceptación del riesgo residual en versiones históricas del inventario y la decisión sobre la alineación preparada del heartbeat. **El propietario resolvió el punto de los cierres externos: registrarlos y conservar las ramas**, sin reapertura ni recreación remota. La implementación de P0D y la recuperación cloud de efectos pertenecen a P1/P3: no se usan como falsos bloqueos para impedir cerrar una reconciliación documental, ni se activan aquí.

## Cambio de estado remoto durante la orden

La primera lectura confirmó PR235 OPEN/DRAFT, head exacto `0f2482f`, ambos validate y ambos postgres SUCCESS, CodeQL SUCCESS y Supabase Preview SKIPPED. Durante la revisión se observó una fusión externa en main `f2129e9dadf73978b91974d26b39fe0bd297dcb7`, a `2026-11-15T01:49:18Z`. Esta orden no ejecutó merge, auto-merge ni promoción productiva.

Se contrastó que el árbol de ese merge coincide con el candidato235. Main f2129e9 tiene validate/postgres y CodeQL SUCCESS; el handoff continuation conserva FAILURE intencional. El trabajo nuevo se aísla en una rama de continuación P0 sobre ese main, porque #235 ya está fusionada. La rama documental adicional observada apuntaba a la antigua base a4ca9dd, sin trabajo exclusivo ni PR equivalente; se conservó sin modificarla.

PR234 estaba OPEN/DRAFT al inicio en `3ce7fdf6f3e7ea955a705f20f771a91ec8cb1f14`; otra lectura la confirmó CLOSED, sin merge, a `2026-11-15T01:52:09Z`. Las otras16 PR que estaban abiertas también se cerraron externamente sin merge. Los17 heads conservan sus SHA;16 ramas remotas siguen presentes y la de Dependabot/#169 no aparece, aunque constaba en el inventario inicial. Los17 commits y sus refs locales de seguimiento siguen disponibles: no se hizo prune. Se conservaron además sus historias en un pack autocontenido cifrado, descifrado en memoria y validado con strict dry-run, cero objetos plaintext escritos. Esta orden no ejecutó close/merge/delete ni revierte decisiones concurrentes de otro actor por inferencia. [Evidencia](evidence-20261114/p0-pending-prs-baseline.json).

## Revisión de exposición del inventario

| Hallazgo | Impacto | Cambio mínimo y evidencia |
| --- | --- | --- |
| Rutas absolutas, perfiles locales y nombres de repositorios ajenos | Identificación innecesaria del entorno | IDs estables y alias lógicos; otras identidades locales omitidas |
| PIDs, rutas de ejecutables, locks y destinos de chats | Metadatos volátiles o privados sin utilidad para revisar el cambio | Resultado agregado de la inspección; ningún PID/ID de chat nuevo publicado |
| Modelo/sandbox/política global, plugins compartidos, MCP y nombres de variables de su entorno | Configuración compartida innecesaria para el contrato P0 | Inventario público limitado a skills del repo y estado mínimo del heartbeat |
| Destinos cloud, identidades de agentes y revisores | Detalle innecesario de cuentas/configuración | Refs de los dos proyectos necesarios para la separación; conteos y guardas, sin IDs personales/durables |
| Listas de archivos privados de QA y exportaciones | Evidencia útil localmente, excesiva en una PR pública | Originales cifrados; publicación de conteos, categorías, decisiones y hashes de paquetes |

La revisión acotada no encontró valores de credenciales ni expedientes de clientas en el material publicado que se examinó. Esto no es garantía de ausencia de secretos en todo el historial. El contenido actual se minimiza, pero **los commits anteriores siguen accesibles**, incluida la captura de #235 ya integrada. No se hizo force push, reescritura de historia, rotación de credenciales ni eliminación de artefactos. Borrar un campo del árbol actual no lo retira del historial: cualquier decisión adicional debe evaluar ese alcance explícitamente.

Los inventarios originales se conservaron además en un paquete cifrado local antes de minimizarlos. No se publica su ruta física, mapa de recursos ni configuración privada. El manifiesto mantiene 83 IDs y sus decisiones; la evidencia antigua no se presenta como medición nueva.

## Propietario, consumidores y cambios exclusivos

| Recurso | Procedencia y custodia | Cambios locales / exclusividad | Consumidores y decisión |
| --- | --- | --- | --- |
| alignment-audit-20261105 | Victoriosas/autopilot; PR195 fusionada; custodia del mismo perfil Windows actual | 13 paths locales de informes/sesión QA; 13 blobs ausentes del historial de main contrastado; sin staged | Git/worktree y evidencia de QA histórica. Cero referencias literales en runtime/build/workflows inspeccionados; CONSERVAR |
| diseno | Victoriosas/autopilot; PR79 fusionada; custodia del mismo perfil Windows actual | 48 paths, 47 blobs ausentes de main; capturas, informes y tres scripts de QA; sin staged | Git/worktree y QA manual. Tres scripts de navegador pueden usar red/escribir evidencia; no se ejecutaron. Cero referencias literales runtime/build inspeccionadas; CONSERVAR |

Heads originales: alignment `48a6f2f3fde5ac48e7664f0b47143ac385dcae7d`, diseno `c132ed0efcad02593f9b348141d96c28b25c9af7`. Ninguno es ancestro de main: una PR fusionada no prueba que cada blob o commit local se conserve en main. Se conservaron sus snapshots y sus historias Git completas cifradas.

La custodia se contrastó con ACL en privado. **El autor humano de los cambios sin commit no está establecido**: ACL, autor de Git, rama y fechas no atribuyen la edición local. La custodia operativa queda en el propietario del proyecto, y no se usa esa atribución para autorizar retirada.

La búsqueda estática usó paths relativos de los cambios y alias de worktree en src/scripts/.github/package/entradas/build de main y de cada base local. Cero coincidencias literales no excluye consumidores dinámicos o externos. Se inspeccionaron acciones de tareas Windows sin publicar sus argumentos: cero referencias a estos destinos. La muestra reciente de la app mostró solo esta auditoría activa y ningún chat Codex activo en esos dos worktrees; no es inventario global ni prueba de exclusión entre máquinas. No se detuvo ningún proceso ni se borraron locks.

## Preservación y recuperación demostradas

1. Lectura de todos los archivos regulares rastreados y no ignorados; captura de árbol base, metadatos de Git, patches binarios staged/unstaged y hashes. No se siguieron enlaces inseguros ni se copiaron dependencias ignoradas a ciegas.
2. Paquetes cifrados con **Windows DPAPI CurrentUser**, escritos exclusivamente como ciphertext fuera de Git. Credenciales/llaves no se imprimieron ni se crearon copias plaintext. El índice de rutas y la referencia a la automatización también quedaron cifrados.
3. Un **proceso nuevo** leyó el ciphertext persistido, lo descifró en memoria, recuperó y verificó **745 archivos de alignment y 405 de diseno**, junto con los hashes del árbol base y patches. Los archivos recuperados se compararon con los originales; no se ejecutó su código ni se escribió un checkout plaintext de esos datos.
4. Las historias Git de ambos heads se conservaron en packs cifrados autocontenidos. Se descifraron en memoria y se validaron mediante `git unpack-objects -n -q --strict` en repositorios bare vacíos: exit0 y **cero objetos Git plaintext escritos**. Esto prueba formato/integridad del pack; no equivale a ejecutar una restauración completa ni sus scripts.
5. Status y hashes de los archivos capturados se revalidaron al terminar la captura; no cambiaron. La siguiente lectura independiente contrastó otra vez los bytes recuperados con las fuentes.

Evidencia: [p0-local-recovery-proof.json](evidence-20261114/p0-local-recovery-proof.json) y [p0-target-consumers.json](evidence-20261114/p0-target-consumers.json). Los hashes publicados identifican paquetes y pruebas, no revelan rutas o contenidos privados. La ubicación y el mapa de recuperación permanecen exclusivamente locales y cifrados; se indican al operador fuera de Git.

**Límites materiales:** DPAPI depende de la identidad Windows y su recuperación de perfil/máquina; no se certificó recuperación offsite ni ante pérdida de esa identidad. Hay 10.228 y 9.649 archivos ignorados respectivamente, conservados en sus árboles, sin clasificación completa ni respaldo en esta prueba. No se infiere que todos sean regenerables. Por eso esta evidencia **no habilita borrar directorios completos**. Tampoco una captura estable prueba ausencia de todos los escritores posibles.

## Recuperación operativa reproducible, sin activarla aquí

El operador debe usar el localizador privado y su identidad Windows original; comprobar primero el hash del ciphertext. Descifrar el mapa/paquete en memoria y validar paths relativos sin '..', sin raíces ni entradas .git. Para una restauración futura autorizada: crear un destino nuevo y vacío, reconstruir objetos desde el pack, verificar el head exacto, materializar la base, aplicar el patch staged al índice y después recuperar el snapshot de trabajo, manteniendo borrados y archivos no rastreados según el manifiesto privado. Comparar cada hash y el status esperado antes de considerar la copia recuperable. No restaurar dentro de un árbol existente ni ejecutar scripts recuperados como parte de la verificación.

Si el material contiene configuración sensible, la restauración a disco exige un destino con protección cifrada verificada; esta orden solo recuperó en memoria. Antes de proponer retirada, clasificar/rescatar también los ignorados necesarios, comprobar todos los consumidores, verificar recuperación fuera del fallo que se pretende tolerar y obtener autorización específica. Esta sesión no propone ninguna retirada.

## Próxima orden exacta y heartbeat

**ORD-P0-REVIEW-PRIVACY-ALIGN6H-20261114**: revisar y verificar CI del SHA final de esta continuación, decidir aceptación del riesgo histórico de metadatos y revisar el [texto preparado del heartbeat](../P0_HEARTBEAT_ALIGNMENT_PREPARATION_20261114.md). La decisión sobre los17 cierres quedó registrada por respuesta explícita del propietario: conservar estados cerrados y refs/heads disponibles, sin reabrir ni recrear la rama ausente169. El contrato maestro ya está en main, pero la actualización del heartbeat no se ejecutó: conservar mismo ID/tipo/nombre/estado/destino/cadencia/notificaciones. Si se autoriza aplicarla, usar la herramienta existente y verificar que solo cambió el prompt. Hasta entonces registrar PREPARADO, no CONFIGURADO ni EJECUTADO.

No se inicia P1, no se fusiona esta propuesta por iniciativa del agente y no se repiten las reconciliaciones ya verificadas salvo cambio de hashes o nueva evidencia. Un eventual cierre P0 debe registrar la decisión y sus límites en el **mismo CODEX_CONTINUATION.json**; no crear otro plan o checkpoint.
