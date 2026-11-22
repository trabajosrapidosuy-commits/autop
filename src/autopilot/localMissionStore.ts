import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hostBinding, localProcessEnvironment, validateLocalConfig, type LocalMissionConfig } from './localMissionConfig';
import { authorizedObjective } from './missionPlanner';
import { ManagedProcesses } from './managedProcesses';
import type { ExecutorAdapter } from './executorAdapter';
import type { AgentId } from './sixAgentControlPlane';

export interface MissionClaimGuard {
  expected: { missionId: string; binding: string; goalVersion: number; checkpointVersion: number;
    planVersion: number; objective: unknown; expiresAt: number; id: string; revision: number; executorId: string; phase: 'F0'; recovery?:'ready_to_complete'|'reconcile_effect' };
  authorizeExecutor(executor: ExecutorAdapter): Promise<void>;
  beforeClaim(agentId: AgentId): Promise<void>;
}

const literal = (v: unknown) => `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
export function missionId(value: string): string {
  if (!/^synthetic-[a-z0-9-]{1,60}$/.test(value)) throw Error('invalid_mission_id'); return value;
}
export function admissionRequest(value: unknown): { id: string; objective: ReturnType<typeof authorizedObjective> } {
  const request = value as { id: string; objective: unknown };
  if (!request || Object.keys(request).sort().join(',') !== 'id,objective') throw Error('invalid_admission_request');
  return { id: missionId(request.id), objective: authorizedObjective(request.objective) };
}
export interface LocalMissionStatus {
  id: string; queueState: string; state: string; reason: string | null; runId: string | null; leaseActive: boolean;
  attempts: number; maxAttempts: number; checkpointVersion: number; planVersion: number;
  checkpoint: Record<string, unknown>; plans: unknown[]; audit: unknown[];
  authorization?: {active:boolean;revision:number;expiresAt:number} | null;
}
export class LocalMissionStore {
  protected get databaseName(): string { return this.config.database.name; }
  get binding(): string { return hostBinding(this.config); }
  private claim?: { id: string; token: string };
  constructor(readonly config: LocalMissionConfig, protected readonly processes: ManagedProcesses,
    protected readonly signal?: AbortSignal, private readonly report: (event: Record<string, unknown>) => void = () => {}) {
    validateLocalConfig(config);
  }
  protected async execute(query: string, operation: string): Promise<string> {
    const d = this.config.database;
    const prelude = `set statement_timeout=${this.config.queryTimeoutMs}; set lock_timeout=${this.config.queryTimeoutMs};
      set idle_in_transaction_session_timeout=${this.config.queryTimeoutMs}; set request.jwt.claim.role='service_role';`;
    const result = await this.processes.exec(process.env.PSQL_PATH || 'psql',
      ['-h',d.host,'-p',String(d.port),'-U',d.user,'-d',d.name,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
      { env: localProcessEnvironment(), timeout: this.config.queryTimeoutMs + 2000, signal: this.signal,
        input: `${prelude}\n${query}`, operation });
    return result.stdout.trim();
  }
  private async query(query: string, operation: string): Promise<string> {
    return this.execute(`do $guard$ begin
      if current_database()<>${literal(this.databaseName)} or not exists(select 1 from public.autopilot_local_lab where binding=${literal(this.binding)})
      then raise exception 'unbound_local_lab'; end if; end $guard$;\n${query}`, operation);
  }
  async initialize(): Promise<void> {
    if (!this.config.permissions.admit || !this.config.permissions.execute) throw Error('host_permission_required');
    const files = ['supabase/migrations/20260912033258_autopilot_core_v4.sql',
      'supabase/staged/six_agent_queue_20261025.sql','supabase/staged/six_agent_mission_checkpoint_20261109.sql',
      'supabase/staged/six_agent_mission_planning_20261109.sql','supabase/staged/six_agent_local_operator_20261109.sql',
      'supabase/staged/six_agent_local_policy_20261116.sql'];
    // Paths are source-owned; no SQL path or text comes from config or an admitted objective.
    const sources = await Promise.all(files.map(file => readFile(new URL(file, new URL('../../', import.meta.url)), 'utf8')));
    await this.execute(`begin; select pg_advisory_xact_lock(204205);
      do $$ begin if current_database()<>'victoriosa_mission_operator_lab'
        or exists(select 1 from pg_catalog.pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg_%')
        or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S'))
        then raise exception 'fresh_disposable_database_required'; end if; end $$;
      create schema auth; create function auth.role() returns text language sql stable as 'select current_setting(''request.jwt.claim.role'',true)';
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      end $$;
      ${sources.join('\n')}
      insert into public.autopilot_local_lab(binding) values(${literal(this.binding)}); commit;`, 'initialize_local_lab');
  }
  async admit(value: unknown): Promise<string> {
    if (!this.config.permissions.admit) throw Error('host_permission_required');
    const request = admissionRequest(value);
    const state = await this.query(`select public.local_mission_admit(${literal(request.id)},${literal(request.objective)}::jsonb,${literal(this.binding)});`, 'admit');
    if (state !== 'queued' && state !== 'duplicate') throw Error('admission_conflict'); return state;
  }
  async status(id: string): Promise<LocalMissionStatus> {
    missionId(id);
    const result = await this.query(`select jsonb_build_object('id',t.id,'queueState',t.status,'state',t.mission_checkpoint->>'mission_state',
      'reason',case when t.status='completed' then 'acceptance_satisfied' else t.mission_checkpoint->>'last_error' end,
      'runId',t.local_run_id,'leaseActive',coalesce(t.status='running' and t.lease_until>clock_timestamp(),false),
      'attempts',t.attempt_count,'maxAttempts',t.max_attempts,'checkpointVersion',t.mission_checkpoint_version,
      'planVersion',coalesce((t.input->>'plan_version')::integer,0),'checkpoint',t.mission_checkpoint,'plans',coalesce(t.input->'plan_history','[]'::jsonb),
      'authorization',case when t.input ? 'local_authorization' then jsonb_build_object(
        'active',t.input->'local_authorization'->'active','revision',t.input->'local_authorization'->'grant'->'revision',
        'expiresAt',t.input->'local_authorization'->'grant'->'expiresAt') else null end,
      'audit',(select coalesce(jsonb_agg(jsonb_build_object('event',a.event_type,'details',a.details) order by a.id),'[]'::jsonb)
        from public.agent_audit_events a where a.task_id=t.id)) from public.agent_tasks t
      where t.id=${literal(id)} and t.actor='autopilot-local-cli' and t.input->>'host_binding'=${literal(this.binding)};`, 'status');
    if (!result) throw Error('mission_not_found'); return JSON.parse(result);
  }
  async cancel(id: string): Promise<boolean> {
    if (!this.config.permissions.cancel) throw Error('host_permission_required');
    missionId(id); return await this.query(`select public.local_mission_cancel(${literal(id)},${literal(this.binding)});`, 'cancel') === 't';
  }
  /** Explicit trusted host policy administration, never called by supervisor/executor. */
  async authorizeMission(grant:MissionClaimGuard['expected'],expectedRevision:number):Promise<boolean> {
    if(this.constructor!==LocalMissionStore || !this.config.permissions.admit || !this.config.permissions.execute)
      throw Error('host_policy_permission_required');
    missionId(grant.missionId);
    if(grant.binding!==this.binding || !Number.isSafeInteger(expectedRevision) || expectedRevision<0)
      throw Error('invalid_policy_revision');
    return await this.query(`select public.local_mission_authorize(${literal(grant.missionId)},${literal(this.binding)},${literal(grant)}::jsonb,${expectedRevision});`,'authorize_policy')==='t';
  }
  async revokeAuthorization(id:string,expectedRevision:number):Promise<boolean> {
    if(this.constructor!==LocalMissionStore || !this.config.permissions.cancel) throw Error('host_policy_permission_required');
    missionId(id);
    if(!Number.isSafeInteger(expectedRevision) || expectedRevision<1) throw Error('invalid_policy_revision');
    return await this.query(`select public.local_mission_revoke(${literal(id)},${literal(this.binding)},${expectedRevision});`,'revoke_policy')==='t';
  }
  async assertAuthorization(grant:MissionClaimGuard['expected']):Promise<void> {
    if(this.constructor!==LocalMissionStore || grant.binding!==this.binding) throw Error('mission_authorization_scope_mismatch');
    missionId(grant.missionId);
    const valid=await this.query(`select public.local_mission_policy_valid(t.input,t.id,${literal(grant)}::jsonb)
      from public.agent_tasks t where t.id=${literal(grant.missionId)} and t.input->>'host_binding'=${literal(this.binding)};`,'verify_policy');
    if(valid!=='t') throw Error('durable_policy_denied');
  }
  client(id: string, runId: string, guard?: MissionClaimGuard): SupabaseClient {
    missionId(id);
    const expected=guard ? structuredClone(guard.expected) : undefined;
    if (expected && (this.constructor!==LocalMissionStore || expected.missionId!==id || expected.binding!==this.binding))
      throw Error('mission_authorization_scope_mismatch');
    const parameters: Record<string, string[]> = {
      six_agent_checkpoint: ['p_task_id','p_mission_id','p_token','p_checkpoint_version','p_operation_id','p_executor_id','p_checkpoint'],
      six_agent_complete: ['p_task_id','p_token','p_evidence'], six_agent_fail: ['p_task_id','p_token','p_reason'],
      six_agent_save_plan: ['p_task_id','p_token','p_checkpoint_version','p_operation_id','p_planner_id','p_proposal'],
      six_agent_block_mission: ['p_task_id','p_token','p_checkpoint_version','p_reason'],
    };
    return { rpc: async (rpc: string, args: Record<string, unknown>) => {
      if (!this.config.permissions.execute) return { data: null, error: { message: 'host_permission_required' } };
      try {
        if (rpc === 'six_agent_claim_mission') {
          if (args.p_agent !== 'software') throw Error('agent_not_allowed');
          if (guard) await guard.beforeClaim('software');
          // Same transaction and row lock as the claim: no read/claim TOCTOU.
          // Fresh claims or explicit scoped synthetic recovery after lease expiry; no live takeover.
          const precondition=expected ? `begin; set local autopilot.policy_grant=${literal(expected)}; do $authorization$ begin
            perform 1 from public.agent_tasks t where t.id=${literal(id)} and t.mission_id=${literal(id)}
              and t.goal='Verify synthetic mission recovery' and t.input->>'mission_schema_version'='1'
              and t.actor='autopilot-local-cli'
              and t.agent_id='software' and t.input->>'host_binding'=${literal(expected.binding)}
              and ${expected.recovery
                ? `t.status='running' and t.lease_until<clock_timestamp() and t.execution_token is not null
                    and t.attempt_count<t.max_attempts and t.mission_checkpoint->>'mission_state'=${literal(expected.recovery==='ready_to_complete'?'ready_to_complete':'in_progress')}`
                : "t.status='queued' and t.attempt_count=0 and t.execution_token is null and t.lease_until is null and t.mission_checkpoint->>'mission_state'='queued'"}
              and t.mission_checkpoint_version=${literal(expected.checkpointVersion)}::integer
              and coalesce((t.input->>'plan_version')::integer,0)=${literal(expected.planVersion)}::integer
              and (t.input->>'goal_version')::integer=${literal(expected.goalVersion)}::integer
              and t.input->'objective'=${literal(expected.objective)}::jsonb
              and clock_timestamp()<to_timestamp(${literal(expected.expiresAt)}::double precision/1000)
              for update;
            if not found or clock_timestamp()>=to_timestamp(${literal(expected.expiresAt)}::double precision/1000)
              then raise exception 'mission_authorization_stale'; end if;
          end $authorization$;` : '';
          const audit=expected ? `insert into public.agent_audit_events(task_id,event_type,details)
            select ${literal(id)},'mission_authorized_claim',jsonb_build_object('grant_id',${literal(expected.id)},
              'revision',${literal(expected.revision)}::integer,'executor_id',${literal(expected.executorId)},'run_id',${literal(runId)})
            where exists(select 1 from public.agent_tasks where id=${literal(id)} and local_run_id=${literal(runId)}::uuid and status='running'); commit;` : '';
          const data = JSON.parse(await this.query(`${precondition}
            select coalesce(json_agg(c),'[]'::json) from public.local_mission_claim(${literal(id)},${literal(this.binding)},${literal(runId)}::uuid,${this.config.leaseSeconds}) c;
            ${audit}`, 'claim'));
          if (data[0]) { this.claim = { id, token: data[0].claim_token }; this.report({ event: 'claimed', missionId: id, runId }); }
          return { data, error: null };
        }
        if (!Object.hasOwn(parameters,rpc) || args.p_task_id !== id) throw Error('rpc_not_allowed');
        const values = parameters[rpc].map(key => literal(args[key]) + (['p_checkpoint','p_proposal'].includes(key) ? '::jsonb' : '')).join(',');
        const prefix=expected ? `begin; set local autopilot.policy_grant=${literal(expected)};` : '';
        const data = JSON.parse(await this.query(`${prefix} select to_json(public.${rpc}(${values})); ${expected?'commit;':''}`, rpc));
        if (data === true) this.report({ event: 'write_confirmed', operation: rpc, missionId: id, runId });
        return { data, error: null };
      } catch { return { data: null, error: { message: 'local_rpc_failed' } }; }
    } } as unknown as SupabaseClient;
  }
  async recordInterruption(control: LocalMissionStore, reason: 'run_timeout' | 'operator_interrupted'): Promise<void> {
    if (!this.claim) return;
    await control.query(`select public.six_agent_fail(${literal(this.claim.id)},${literal(this.claim.token)},${literal(reason)});`, 'record_interruption');
  }
}
