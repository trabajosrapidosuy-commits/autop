# P0C cloud: credenciales verificadas, transporte operativo bloqueado

> **Bloqueo TLS resuelto posteriormente en esta misma fecha.** El diagnóstico y
> las mediciones iniciales siguientes se conservan como historial. Véase
> [HOSTED_LEDGER_TLS_RESOLVED_20261114.md](HOSTED_LEDGER_TLS_RESOLVED_20261114.md):
> SSL Enforcement habilitado, backend TLS real y misión sintética completed.

Fecha: 14/11/2026 (America/Montevideo). F0/N2, soporte de F1–F4.
Orden: misión del propietario para completar el ledger alojado y GitHub Actions.
PR existente: [232](https://github.com/Victoriosas/autopilot/pull/232), sin duplicarla.
Base contrastada: main `a63ed47a3b79b3ca109fdaba30ecf77f46a37fc2`;
PR inicial `e1712f49a0c98f19466d1777e698701659b52c70`, OPEN/DRAFT.
CI de esa base: validate/postgres/CodeQL aprobados; Supabase Preview omitido.
No equivale a la CI del nuevo commit; consultar el SHA final de la PR.

## Evidencia real

Proyecto exclusivo `juyowvmtluxfetgkckjd`, nombre
`victoriosas-autopilot-ledger`, ca-central-1, ACTIVE_HEALTHY, PostgreSQL 17.11.
El proyecto principal `jfjzpwlrhzqbcrvqxhzf` no fue consultado ni modificado.
Cuatro tablas con RLS, doce funciones públicas, cero grants de tablas a roles API,
cero membresías del ejecutor y **cero misiones**. Binding:
`263f17927216cb1d06dff0426359e0631886685d392d669acb29851779740983`.
No se reaplicó bootstrap ni se admitió una misión nueva.

DNS directo: sin A, AAAA `2600:1f11:c29:8b01:403f:201e:bb46:48ef`.
Windows tiene IPv6 habilitado en adaptadores, pero no ruta predeterminada `::/0`.
`psql` directo agotó cinco segundos antes de autenticación. No es fallo de contraseña
ni demuestra caída del endpoint desde una red IPv6 funcional.
Herramientas: Node 24.15.0, psql 18.3 y gh autenticado con alcance repo/workflow.
No se detectaron procesos con comandos relativos a hosted-ledger/P0C ni OpenCode;
esto no certifica exclusividad entre sesiones/máquinas. Worktree limpio antes del cambio.

El dashboard autenticado suministró Session Pooler:
`aws-0-ca-central-1.pooler.supabase.com:5432`, base `postgres`, login
`autopilot_cloud_runner.juyowvmtluxfetgkckjd`.
DNS A observado: 15.156.188.226, 15.156.114.158, 15.156.180.136.
Negociación TLS 1.3 y comprobación de cadena/nombre aprobadas con la CA del proyecto.

**Incompatibilidad comprobada:** autenticado en el pooler, `session_user` es
`autopilot_cloud_runner`, marcador y binding coinciden, pero `pg_stat_ssl.ssl=false`
en el backend. La guarda SQL existente devuelve `unauthorized_cloud_session`.
TLS cliente→pooler no acredita TLS pooler→PostgreSQL. No se retira esa guarda.
No activar este transporte como solución operativa con el estado observado.

## Credenciales y entorno protegido

Antes: rol LOGIN sin contraseña. Ahora: contraseña SCRAM configurada, login probado,
sin superuser/createdb/createrole/replication/bypassrls ni membresías.
La rotación generó 48 bytes aleatorios dentro de PostgreSQL; el único resultado
transferido fue cifrado OpenPGP con subclave RSA3072/AES256. Descifrado local en
memoria y carga a GitHub por stdin, sin contraseña en argumentos, respuesta o Git.
Una primera prueba de cifrado con clave primaria sin subclave fue rechazada y la
transacción se revirtió antes del ALTER; se corrigió antes de rotar efectivamente.
No se intentó leer GitHub Secrets. La autenticación SQL y carga exitosa usan el
mismo valor generado; GitHub no permite confirmar su contenido por lectura.

Environment `p0c-hosted-ledger`: reviewer Victoriosas, `prevent_self_review=true`,
política custom solo rama `main`; `can_admins_bypass=true` preexistente no usado.
Secrets presentes y actualizados: `P0C_LEDGER_CA_CERT`, `P0C_LEDGER_RUNNER_PASSWORD`.
No se configuraron variables de activación ni SHA revisado; no se despachó workflow.

CA tomada del enlace Download certificate del propio proyecto:
<https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>.
Supabase Root 2021 CA, válida 28/04/2021–26/04/2031; SHA256:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
Se comprobó la cadena del endpoint y el nombre del host antes de usar la contraseña.

## Candidato explícito, sin activación

Se conserva el transporte directo como predeterminado. Opción
`database.connectionMode='supabase-session'` únicamente con host exacto anterior,
puerto 5432, base postgres y rol SQL fijo. Solo el login de transporte recibe el
sufijo del proyecto; identidad SQL, binding, CA verify-full y guardas permanecen.
Se rechazan transaction/6543, otro pooler, otra referencia, usuario administrativo,
opciones TLS desconocidas y variables libpq heredadas. Sin fallback automático.
El job lee `P0C_LEDGER_CONNECTION_MODE`; esa variable **no está configurada**.
Esta opción es un candidato para revisión y pruebas de compatibilidad futuras,
no una afirmación de soporte operativo del pooler actual.

## Verificación y límites

- `npm run verify`: exit 0, 516/516, sin omisiones; tipos, skills, builds y API.
- Fixture TLS PostgreSQL desechable: recuperación tras muerte real, fencing,
  ACL/auth/bootstrap y routing del pooler con identidad SQL estable; prueba
  adicional conserva rechazo cuando el backend no presenta TLS.
- Consulta alojada real: autenticación, base/rol, marcador, binding y cero misiones.
- Cinco negativos reales denegados: DDL, DML, admisión, claim general y SET ROLE
  postgres. DDL/DML envueltos en transacciones con rollback incluso si fallase ACL.
- Guarda TLS real rechaza el pooler. No se ejecutó recuperación alojada.
- No producción, envíos, migraciones de aplicación, gastos, scheduler ni servicio.

## Puertas pendientes y próxima acción

1. Disponer de ruta IPv6 hacia el endpoint directo **o** evidencia del proveedor
   y prueba real de TLS upstream en el pooler. Enforce SSL entrante no es prueba
   del enlace upstream; no cambiarlo ni reiniciar la base para intentar resolverlo.
2. Revisar esta actualización de PR232 y CI del SHA final. Mantener borrador y
   workflow bloqueado hasta cerrar la incompatibilidad; no fusionar por inercia.
3. El criterio exige una misión *previamente admitida*, pero hay cero. El propietario
   autorizó expresamente en esta sesión una única misión
   `synthetic-p0c-cloud-check`, sin envíos/producción, **una vez resuelto el bloqueo
   TLS y revisado el código**. No admitirla antes de esas condiciones; no crear
   una misión real ni interpretar esta auditoría como admisión ya realizada.
4. Solo entonces integrar el código revisado, fijar el SHA exacto de main y el
   transporte aprobado, despachar status/resume manual y obtener revisión del
   environment. No saltar aprobación ni habilitar continuación automática.

Reversión del candidato: revertir el commit manteniendo variables de activación
ausentes. No borrar ledger ni restablecer checkpoints. Los secrets quedan aislados
en el environment existente; una futura rotación sigue requiriendo autorización.

Fuentes oficiales consultadas:
[conexiones y Session Pooler](https://supabase.com/docs/guides/database/connecting-to-postgres),
[configuración Supavisor: upstream_ssl/upstream_verify frente a enforce_ssl](https://github.com/supabase/supavisor/blob/main/docs/configuration/tenants.md).

## Evidencia adicional: GitHub Actions IPv6 (14/11/2026 UY)

Prueba manual sin secretos ni checkout en el workflow `plan-cloud.yml`, modo `ipv6-probe`.
Commit `e7e3cd0`; run https://github.com/Victoriosas/autopilot/actions/runs/43656109953.
Runner `ubuntu-latest`: DNS AAAA resolvió 1 dirección, conexión IPv6 TCP/5432 devolvió `OSError 101` (network unreachable). Job finalizó failure como se esperaba al no existir ruta; otros jobs omitidos. No se intentó autenticar ni acceder al ledger.
Conclusión acotada: el runner GitHub-hosted probado no permite conexión directa IPv6. No habilitar `hosted-ledger`, no bajar guardas TLS ni asumir que todos los runners carecen de IPv6. Próximo transporte requiere conectividad IPv6 verificada o TLS upstream demostrado por proveedor.
