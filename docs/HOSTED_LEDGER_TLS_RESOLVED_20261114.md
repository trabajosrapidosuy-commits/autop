# P0C: TLS y prueba sintética alojada resueltos

**Cierre verificado:** PR232 integrada en main `0337d47c84239d05fc574967315700bf4de9d428`.
CI validate/postgres/CodeQL aprobada en ese SHA. GitHub Actions
[run 43657434746](https://github.com/Victoriosas/autopilot/actions/runs/43657434746)
terminó SUCCESS: hosted-status del ledger real devolvió state completed.

14/11/2026, America/Montevideo. Continuación expresa del propietario: «solucionalo».
Proyecto exclusivo `juyowvmtluxfetgkckjd`; principal intacto. PR232 existente,
base de esta continuación `acba5f7aee737383b73ef7fede54e963f84e64e9`.

## Corrección del diagnóstico

La documentación oficial de [SSL Enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
indica explícitamente que la opción afecta tanto cliente→pooler como
pooler→PostgreSQL. La conclusión anterior de que no debía habilitarse para
resolver el upstream fue incorrecta. El `ssl=false` observado era real, pero
describía el estado con SSL Enforcement desactivado, no una imposibilidad del servicio.

Se activó **Enforce SSL on incoming connections** en el dashboard del proyecto
aislado y se confirmó el interruptor activo tras el reinicio breve. Antes: cero
misiones y cero conexiones del ejecutor. Después: proyecto saludable y base SSL on.
No hubo cambio de RLS/grants/guarda SQL, IPv4 pago, proxy externo ni servicio nuevo.

## Evidencia real con el ejecutor

Session Pooler oficial `aws-0-ca-central-1.pooler.supabase.com:5432`, base postgres,
login de transporte `autopilot_cloud_runner.juyowvmtluxfetgkckjd`.
Cliente `verify-full` con CA del proyecto. El propio `CloudMissionStore`, sin
desactivar su prelude, confirmó:

```json
{"backend_tls":true,"session_user":"autopilot_cloud_runner","project_ref":"juyowvmtluxfetgkckjd","binding":"263f17927216cb1d06dff0426359e0631886685d392d669acb29851779740983"}
```

Cinco pruebas reales posteriores a la configuración volvieron a negar DDL, DML,
admisión, claim general y elevación a postgres. Contraseña SCRAM nuevamente rotada
porque la copia temporal previa fue destruida y GitHub no recupera secrets;
transferencia OpenPGP cifrada y actualización del mismo valor por stdin en
`P0C_LEDGER_RUNNER_PASSWORD`. CA existente conservada; ningún secreto en Git/logs.

## Misión autorizada y ejecutada

Única ID autorizada por el propietario: `synthetic-p0c-cloud-check`.
Admisión administrativa después de la prueba TLS y revisión del candidato;
objetivo canónico `synthetic.ensure_verified_artifact`, restricciones
`local_synthetic_only/no_network/no_send`, recursos/aceptación fijos.
El runner sigue sin poder admitir misiones.

CLI real ejecutada desde el PC contra PostgreSQL alojado, mediante el adaptador
pooler revisado y el usuario dedicado. Resultado verificado por CLI y consulta
independiente del ledger: **completed, intento 1, checkpoint 5, last_error null**.
Esto prueba ejecución real con ledger alojado; no constituye una ejecución iniciada
por GitHub Actions ni certifica almacenamiento de efectos entre hosts.
No clientes, envíos, datos reales, producción ni modelos externos.

## Revisión, integración y puerta cloud

Candidato conserva exactitud de host/puerto/proyecto, rol mínimo, binding,
verify-full y comprobación SSL backend; no fallback. El diff de aplicación ya fue
probado con verify516/516 y fixture TLS1/1, incluido el negativo backend sin SSL;
CI validate/postgres/CodeQL/navegador de acba5f7 aprobados. Esta continuación solo
añade documentación; CI del commit final debe verificarse antes de integrar.
Vercel mantiene Git deployments de main y de la rama deshabilitados.

Después de CI/revisión: integrar PR232 sin auto-merge ni deploy, fijar
`P0C_LEDGER_CONNECTION_MODE=supabase-session` y `P0C_HOSTED_REVIEWED_SHA` al SHA
exacto integrado. Despachar la misma ID terminal por hosted-resume permite verificar
acceso cloud e idempotencia sin una nueva misión ni repetir sus efectos.
El environment conserva reviewer humano, main y prevent_self_review; nunca
aprobar automáticamente ni usar bypass administrativo. Si GitHub exige una
intervención humana o rechaza la auto-revisión, entregar el run concreto y la
acción mínima para completar esa puerta, conservando el trabajo ya probado.

Reversión de activación: retirar SHA revisado; no bajar TLS, borrar ledger,
resetear checkpoints ni readmitir la misión. La continuación automática permanece
bloqueada; no se configura schedule ni se afirma operación continua.

## Resultado final de GitHub Actions

Variables configuradas tras revisar e integrar: modo `supabase-session` y SHA
revisado exacto. Se despachó únicamente hosted-status para la misma misión terminal.
El job pasó todas las comprobaciones del adaptador (incluida SSL backend) y emitió:

```json
{"event":"hosted_runner_finished","action":"status","completed":true,"state":"completed"}
```

La revisión normal estaba bloqueada porque `prevent_self_review=true` y la única
cuenta iniciadora/revisora era Victoriosas. El propietario **autorizó expresamente
en el chat una aprobación administrativa excepcional solo del run 43657434746**.
Se aplicó Start all waiting jobs únicamente a ese environment/run y se dejó
comentario de alcance en su auditoría. Esta autorización posterior y específica
es la excepción a la prohibición de bypass indicada en la preparación anterior;
no es permiso para futuras ejecuciones ni una aprobación automática de Codex.
Reviewers, prevent_self_review, política main y capacidad administrativa preexistente
permanecen sin cambios. Un futuro run requiere su propia revisión/autorización.

Después del run: una misión, completed, intento1, checkpoint5, siete eventos de
auditoría y updated_at idéntico al anterior. El replay local anterior también
devolvió continuation_skipped sin nuevas escrituras. No se disparó hosted-resume
desde GitHub ni se afirma recuperación de efectos entre hosts.
Las claves privadas temporales de transferencia se eliminaron con GPG; no quedan
secret keys en ese homedir. Los dos secrets siguen en el environment protegido.

La entrada Deployment de GitHub corresponde a `p0c-hosted-ledger`, no a una
publicación web. Git deployments de Vercel main/rama siguen deshabilitados.
El ajuste documental de cierre puede cambiar el SHA de main; solo actualizar el
SHA revisado después de comprobar CI y que los archivos runtime son idénticos a
0337d47. No ejecutar otro job por ese cambio documental.
