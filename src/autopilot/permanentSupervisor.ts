import type { LocalMissionStatus } from './localMissionStore';

/**
 * Permanent-objective supervisor: deterministic, read-only decision layer.
 * The existing mission ledger remains the sole authority for claims and effects.
 * No scheduling, network calls, dispatch or implicit authorization.
 */
export type SupervisorGoal = Readonly<{
  id: string;
  priority: number;
  phase: string;
  enabled: boolean;
  missionId: string;
}>;
export type SupervisorObservation = Readonly<{
  missionId: string;
  state: 'unknown' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'retry_wait' | 'ready_to_complete';
  leaseActive: boolean;
  checkpointVersion: number;
  evidenceVerified: boolean;
}>;
export type SupervisorDecision = Readonly<{
  goalId: string;
  missionId: string;
  action: 'inspect' | 'wait' | 'verify' | 'checkpoint' | 'propose_resume' | 'blocked';
  reason: string;
}>;

const validId = (id: string) => /^[a-z][a-z0-9-]{2,79}$/.test(id);
export function decidePermanentObjective(
  goals: readonly SupervisorGoal[],
  observations: readonly SupervisorObservation[],
): SupervisorDecision | null {
  if (!Array.isArray(goals) || !Array.isArray(observations)) throw Error('invalid_supervisor_input');
  if (goals.length > 100 || observations.length > 100) throw Error('supervisor_budget_exceeded');
  const seen = new Set<string>();
  for (const goal of goals) {
    if (!goal || typeof goal.enabled !== 'boolean' || !validId(goal.id) || !validId(goal.missionId) || !Number.isSafeInteger(goal.priority) || goal.priority < 0 || goal.priority > 1000 || typeof goal.phase !== 'string' || !/^F[0-8]$/.test(goal.phase))
      throw Error('invalid_supervisor_goal');
    if (seen.has(goal.id)) throw Error('duplicate_supervisor_goal');
    seen.add(goal.id);
  }
  const missions = new Map<string, SupervisorObservation>();
  for (const observation of observations) {
    if (!observation || !validId(observation.missionId) || missions.has(observation.missionId)
      || !['unknown','queued','running','completed','failed','cancelled','blocked','retry_wait','ready_to_complete'].includes(observation.state)
      || typeof observation.leaseActive !== 'boolean' || typeof observation.evidenceVerified !== 'boolean'
      || !Number.isSafeInteger(observation.checkpointVersion) || observation.checkpointVersion < 0)
      throw Error('invalid_supervisor_observation');
    missions.set(observation.missionId, observation);
  }
  const goal = [...goals].filter(g => g.enabled === true).sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id))[0];
  if (!goal) return null;
  const obs = missions.get(goal.missionId);
  const decision = (action: SupervisorDecision['action'], reason: string): SupervisorDecision =>
    ({ goalId: goal.id, missionId: goal.missionId, action, reason });
  if (!obs || obs.state === 'unknown') return decision('inspect', 'mission_state_unverified');
  if (obs.state === 'completed') return obs.evidenceVerified ? decision('checkpoint', 'completed_verified') : decision('verify', 'completion_evidence_missing');
  if (obs.state === 'ready_to_complete') return decision('verify', 'final_completion_requires_independent_evidence');
  if (obs.state === 'retry_wait') return decision('inspect', 'retry_requires_ledger_reconciliation');
  if (obs.state === 'blocked') return decision('blocked', 'blocked_requires_independent_review');
  if (obs.state === 'running') return decision('wait', obs.leaseActive ? 'active_owner' : 'running_state_requires_reconciliation');
  if (obs.state === 'queued') return decision('blocked', 'admission_does_not_authorize_dispatch');
  if (obs.state === 'cancelled') return decision('blocked', 'cancelled_requires_new_authorization');
  // Failed rows are never sufficient authority to propose a replay/resume.
  return obs.leaseActive ? decision('wait', 'lease_still_active') : decision('blocked', 'failed_requires_independent_review');
}


/**
 * Read-only mapping from the existing host-bound LocalMissionStore.status() result.
 * Status alone cannot certify completed evidence or authorize a resume/claim.
 * The caller must supply the binding of the reviewed store. No writes or dispatch.
 */
function localStatusObservation(raw: LocalMissionStatus, missionId: string): SupervisorObservation {
  if (!raw || raw.id !== missionId || !validId(raw.id)
    || typeof raw.queueState !== 'string' || typeof raw.state !== 'string'
    || typeof raw.leaseActive !== 'boolean'
    || !Number.isSafeInteger(raw.checkpointVersion) || raw.checkpointVersion < 0
    || !Number.isSafeInteger(raw.planVersion) || raw.planVersion < 0
    || !Number.isSafeInteger(raw.attempts) || raw.attempts < 0
    || !Number.isSafeInteger(raw.maxAttempts) || raw.maxAttempts < 1
    || raw.attempts > raw.maxAttempts
    || !raw.checkpoint || typeof raw.checkpoint !== 'object' || Array.isArray(raw.checkpoint)
    || raw.checkpoint.mission_state !== raw.state
    || !Array.isArray(raw.audit) || !Array.isArray(raw.plans)) throw Error('untrusted_mission_status');
  const pair = raw.queueState + ':' + raw.state;
  const states: Record<string, SupervisorObservation['state']> = {
    'queued:queued':'queued',
    'running:in_progress':'running',
    'running:ready_to_complete':'ready_to_complete',
    'completed:completed':'completed',
    'failed:retry_wait':'retry_wait',
    'blocked:blocked':'blocked',
    'cancelled:cancelled':'cancelled',
  };
  const state = states[pair];
  if (!state) throw Error('untrusted_mission_status');
  if (raw.leaseActive && !['running','ready_to_complete'].includes(state)) throw Error('untrusted_mission_status');
  return {
    missionId, checkpointVersion: raw.checkpointVersion,
    leaseActive: raw.leaseActive,
    state: state === 'running' && !raw.leaseActive ? 'unknown' : state,
    // A status response is not independent attestation of an effect.
    evidenceVerified: false,
  };
}

/** One host-bound status read. The actual ledger remains authority for effects. */
export async function decidePermanentObjectiveForLocalStore(
  goals: readonly SupervisorGoal[],
  store: Pick<import('./localMissionStore').LocalMissionStore, 'binding' | 'status'>,
  expectedBinding: string,
  authorizedPhase: string,
): Promise<SupervisorDecision | null> {
  if (!store || typeof store.status !== 'function' || typeof store.binding !== 'string'
    || typeof expectedBinding !== 'string' || expectedBinding.length < 16
    || store.binding !== expectedBinding) throw Error('supervisor_binding_mismatch');
  const next = decidePermanentObjective(goals, []);
  if (!next) return null;
  if (typeof authorizedPhase !== 'string' || !/^F[0-8]$/.test(authorizedPhase)
    || goals.find(g => g.id === next.goalId)?.phase !== authorizedPhase)
    throw Error('supervisor_phase_mismatch');
  let raw: LocalMissionStatus;
  try { raw = await store.status(next.missionId); }
  catch { return { ...next, action: 'inspect', reason: 'status_unavailable_requires_reconciliation' }; }
  return decidePermanentObjective(goals, [localStatusObservation(raw, next.missionId)]);
}
