import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AutopilotTask } from './orchestrator';
import { evaluatePolicy, isActor, isAutopilotAction, isRiskLevel, type PolicyContext } from './policyEngine';

export interface AuditEvent {
  taskId: string;
  at: string;
  event: string;
  details?: unknown;
}

function createSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const db = createSupabase();
// Enable only after the additive migration is reviewed and applied to the target DB.
const durableApprovalEnabled=()=>process.env.AUTOPILOT_DURABLE_APPROVAL_V2_ENABLED==='true';

export function taskPersistenceStatus() {
  return {
    backend: db ? 'supabase' : 'memory-only',
    durable: Boolean(db),
  } as const;
}

export async function persistTask(task: AutopilotTask): Promise<void> {
  if (!db) return;

  const { error } = await db.from('agent_tasks').upsert({
    id: task.id,
    goal: task.goal,
    actor: task.actor,
    action: task.action,
    status: task.status,
    input: task.input ?? null,
    ...(durableApprovalEnabled() ? {policy_context: task.policyContext ?? null} : {}),
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  });

  if (error) throw new Error(`Unable to persist agent task: ${error.message}`);
}

export async function persistAuditEvent(event: AuditEvent): Promise<void> {
  if (!db) return;

  const { error } = await db.from('agent_audit_events').insert({
    task_id: event.taskId,
    event_type: event.event,
    details: event.details ?? null,
    created_at: event.at,
  });

  if (error) throw new Error(`Unable to persist audit event: ${error.message}`);
}

export async function listPersistedTasks(limit = 100): Promise<AutopilotTask[]> {
  if (!db) return [];

  const { data, error } = await db
    .from('agent_tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) throw new Error(`Unable to list agent tasks: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    goal: row.goal,
    actor: row.actor,
    action: row.action,
    status: row.status,
    input: row.input ?? undefined,
    policyContext: row.policy_context ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    audit: [],
  }));
}


/**
 * Recover a generic task from durable storage. Legacy rows without an
 * authoritative policy snapshot cannot be approved after a restart.
 */
export async function approvePersistedTask(
  taskId: string,
  client: SupabaseClient | null = db,
): Promise<AutopilotTask> {
  if (!client) throw Error('TASK_PERSISTENCE_REQUIRED');
  if (client===db && !durableApprovalEnabled()) throw Error('TASK_APPROVAL_DURABLE_MIGRATION_REQUIRED');
  if (!/^task_[0-9]+_[a-z0-9]+$/.test(taskId)) throw Error('TASK_NOT_FOUND');
  const {data:row,error:readError}=await client.from('agent_tasks')
    .select('*').eq('id',taskId).maybeSingle();
  if(readError) throw Error('TASK_STORE_UNAVAILABLE');
  if(!row) throw Error('TASK_NOT_FOUND');
  if(row.status!=='awaiting_approval') throw Error('TASK_NOT_AWAITING_APPROVAL');
  const ctx=row.policy_context;
  if(!isActor(row.actor)||!isAutopilotAction(row.action)
     ||!ctx||typeof ctx!=='object'||Array.isArray(ctx)
     ||Object.keys(ctx).some(key=>!['risk','amountUsd','targetBranch'].includes(key))
     ||ctx.risk!=='high'
     ||(ctx.amountUsd!==undefined&&(!Number.isFinite(ctx.amountUsd)||ctx.amountUsd<0))
     ||(ctx.targetBranch!==undefined&&(typeof ctx.targetBranch!=='string'||!ctx.targetBranch.trim()))
     ||!isRiskLevel(ctx.risk)) throw Error('TASK_POLICY_CONTEXT_UNVERIFIED');
  const policyContext=ctx as Omit<PolicyContext,'actor'|'action'>;
  const decision=evaluatePolicy({actor:row.actor,action:row.action,...policyContext});
  if(decision.disposition!=='human_gate') throw Error('TASK_POLICY_DENIED');
  // The database rechecks this exact policy snapshot and state atomically.
  const {data:accepted,error:writeError}=await client.rpc('approve_agent_task_if_current',{
    p_task_id:taskId,p_expected_updated_at:row.updated_at,
    p_expected_actor:row.actor,p_expected_action:row.action,
    p_expected_context:policyContext,
  });
  if(writeError) throw Error('TASK_APPROVAL_UNAVAILABLE');
  if(accepted!==true) throw Error('TASK_APPROVAL_STALE');
  const {data:updated,error:postError}=await client.from('agent_tasks')
    .select('*').eq('id',taskId).maybeSingle();
  if(postError || !updated || updated.status!=='queued') throw Error('TASK_APPROVAL_OUTCOME_UNCERTAIN');
  // The audit is recorded within the same SQL transaction as the state change.
  return {
    id:updated.id, goal:updated.goal, actor:updated.actor, action:updated.action,
    status:'queued', input:updated.input??undefined, policyContext,
    createdAt:updated.created_at, updatedAt:updated.updated_at,
    audit:[{at:updated.updated_at,event:'TASK_APPROVED',details:{approvedBy:'human',principal:'admin'}}],
  };
}
