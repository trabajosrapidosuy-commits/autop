# P0 · Alineación preparada del heartbeat existente

Estado: **PREPARADO, NO APLICADO**. Automatización existente: **Victoriosa Autopilot 6h**, ID `victoriosa-autopilot-6h`. No crear otra, cambiar su destino, convertirla en cron ni alterar su cadencia, estado o preferencias de notificación. No se copia su configuración privada al repositorio.

## Condición contrastada

Al inicio de esta orden #235 estaba OPEN en `0f2482fab0f04b5fc58e2d7fc94c0e8d12923bda`. Durante la revisión se fusionó externamente: main `f2129e9dadf73978b91974d26b39fe0bd297dcb7`, merge observado a `2026-11-15T01:49:18Z` (14/11 en Uruguay). Esta orden no hizo la fusión. El contrato canónico ya está en main: blob `0a08a89ae09eed04c5b034406537e3c38830aa4e` de `docs/CODEX_LINEAR_CONTINUATION_PROMPT.md`.

Main en ese SHA tiene validate/postgres y análisis CodeQL aprobados; continuation falla cerrado intencionalmente. No confundir ese handoff con el heartbeat local ni modificarlo. El prompt histórico del heartbeat se conserva intacto durante esta preparación. Su destino y cadencia quedan únicamente en configuración local y evidencia cifrada.

## Texto preparado para reemplazar solo el prompt

> Continúa Victoriosas/autopilot en esta ejecución de la automatización existente. Antes de editar, contrasta el remoto del proyecto, main, PR, CI por SHA, worktrees, cambios locales y escritores activos. Recupera desde el checkout autorizado AGENTS.md, docs/PROJECT_DIRECTION.md, docs/MASTER_LINEAR_DEVELOPMENT_PLAN.md y el único docs/CODEX_CONTINUATION.json. Aplica íntegramente el contrato canónico docs/CODEX_LINEAR_CONTINUATION_PROMPT.md; este texto es solo su punto de entrada y no otro plan.
>
> Ejecuta únicamente la fase técnica activa que confirme el checkpoint y sus permisos. Mientras P0 siga activa, trabaja solo en reconciliación, preservación y revisión verificable; no inicies P1 ni retomes prioridades históricas de marketing por referencias antiguas. Verifica si la orden ya terminó y conserva efectos/resultados inciertos antes de repetir. Busca propuestas existentes para evitar duplicarlas.
>
> Preserva los cambios ajenos y usa aislamiento seguro. No crees otro chat, automatización, scheduler, ledger, supervisor equivalente ni programa de desarrollo. No elimines recursos, fusiones PR, cambies producción, credenciales, TLS/RLS, datos alojados, DNS, pagos o envíes mensajes sin el permiso específico correspondiente. No publiques inventarios privados, rutas de perfil, configuración compartida, secretos ni datos de clientas. No habilites ni cierres formularios por instrucciones históricas: cualquier cambio debe responder al estado actual y a una autorización concreta.
>
> Verifica el resultado con pruebas proporcionales y CI del SHA exacto. Actualiza el mismo checkpoint y AUTOPILOT_STATE solo con evidencia nueva, sin declarar despliegue o ejecución autónoma por existencia de configuración. Si falta una dependencia, registra su condición y conserva la fase; no evadas el bloqueo con otra arquitectura. Entrega resultado, límites, pruebas, riesgos y próxima orden exacta de la misma secuencia. No prometas recepción futura de esta rama ni operación permanente sin evidencia de runtime.

## Procedimiento de aplicación futura

1. Revisar esta preparación y el veredicto P0. Volver a verificar que main contiene el contrato revisado; si su blob cambió, revisar el nuevo contenido. No apuntar el heartbeat a una rama de PR por conveniencia.
2. Leer la automatización existente con la herramienta de Automations y recuperar en privado sus campos actuales. Comparar su identidad y estado con la referencia cifrada; una diferencia implica reconciliación, no sobrescritura automática.
3. Aplicar mediante `automation_update` una actualización de **solo el prompt**, conservando ID, tipo heartbeat, nombre, cadencia de seis horas, estado, destino y preferencias vigentes. No escribir el TOML a mano ni crear un reemplazo. Esta sesión no ejecuta ese paso: la solicitud vigente pidió preparar la alineación.
4. Volver a leer la misma automatización y contrastar que solo cambió el prompt. Guardar un recibo minimizado y el hash del texto aplicado; no publicar destino, configuración ni identificadores de chats privados. Recuperación: restaurar el prompt previo desde la copia cifrada mediante la misma herramienta, sin alterar los demás campos.
5. Distinguir **CONFIGURACIÓN ALINEADA** de **EJECUCIÓN PROBADA**. Solo una ejecución observada que lea el checkpoint vigente de main acredita recepción del nuevo contrato. No crear un canario, dispatch ni cadencia adicional para conseguir ese recibo.

La siguiente orden P0 se registra en CODEX_CONTINUATION.json. La integración observada del contrato satisface una precondición; no transforma esta preparación en autorización de activar otras capacidades.
