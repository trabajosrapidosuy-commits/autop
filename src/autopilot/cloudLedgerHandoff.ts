import { continuationDecision } from './missionContinuation';
import { missionId, type LocalMissionStatus } from './localMissionStore';
import type { CloudMissionStore } from './cloudMissionStore';

export const ORIGINAL_CLOUD_BLOCKER = 'cloud_ledger_adapter_not_configured';
export interface CloudLedgerHandoff {
  schemaVersion: 1; sourceSha: string; sourceRun: string; sourceResult: string;
  missionId: string; binding: string;
}
/** Issued by the reviewed host/environment, never by the triggering task or artifact. */
export interface CloudHandoffPolicy {
  enabled: boolean; reviewedSha: string; missionId: string; binding: string;
  expiresAt: number; maxDurationMs: number;
}
export interface CloudHandoffReceipt {
  originalReason: typeof ORIGINAL_CLOUD_BLOCKER; sourceSha?: string; sourceRun?: string;
  missionId?: string; state: 'blocked' | 'busy' | 'terminal' | 'observed'; reason: string;
  executed: boolean; checkpointVersion?: number; attempts?: number; schedulerCreated: false;
}
const exact = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
export function validateCloudHandoff(value: unknown): CloudLedgerHandoff {
  const h = value as CloudLedgerHandoff;
  if (!exact(h,['schemaVersion','sourceSha','sourceRun','sourceResult','missionId','binding'])
    || h.schemaVersion !== 1 || typeof h.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(h.sourceSha)
    || typeof h.sourceRun !== 'string' || !/^[1-9][0-9]{0,19}$/.test(h.sourceRun) || !['success','failure','cancelled'].includes(h.sourceResult)
    || typeof h.binding !== 'string' || !/^[a-f0-9]{64}$/.test(h.binding)) throw Error('invalid_cloud_handoff');
  missionId(h.missionId);
  // The preserved uncertain attempt must never be reopened through this entry.
  if (h.missionId === 'synthetic-protected-node-effect-cancel-cead08') throw Error('uncertain_effect_preserved');
  return structuredClone(h);
}
export function validateCloudSourceRun(value: unknown, expected: {sha: string; run: string}): void {
  const r = value as Record<string, any>;
  if (!r || String(r.id) !== expected.run || r.head_sha !== expected.sha || r.status !== 'completed'
    || r.conclusion !== 'success' || r.head_branch !== 'main' || r.event !== 'push'
    || r.path !== '.github/workflows/autopilot-core-v4.yml'
    || r.head_repository?.full_name !== 'Victoriosas/autopilot') throw Error('source_run_not_authorized');
}
/** No queue or ledger of its own. SQL remains authority for every claim and effect. */
export async function consumeCloudHandoff(value: unknown, dependencies: {
  policy: () => CloudHandoffPolicy | undefined;
  store: Pick<CloudMissionStore,'binding'|'status'>;
  resume: (id: string, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}): Promise<CloudHandoffReceipt> {
  const base = {originalReason:ORIGINAL_CLOUD_BLOCKER,schedulerCreated:false} as const;
  let handoff: CloudLedgerHandoff;
  try { handoff=validateCloudHandoff(value); }
  catch (e) {return {...base,state:'blocked',reason:e instanceof Error?e.message:'invalid_cloud_handoff',executed:false};}
  const metadata = {sourceSha:handoff.sourceSha,sourceRun:handoff.sourceRun,missionId:handoff.missionId};
  const now=dependencies.now??Date.now;
  const policy=() => {
    const p=dependencies.policy();
    if (!p || !exact(p,['enabled','reviewedSha','missionId','binding','expiresAt','maxDurationMs'])
      || p.enabled !== true) throw Error(ORIGINAL_CLOUD_BLOCKER);
    if (p.reviewedSha !== handoff.sourceSha || p.missionId !== handoff.missionId
      || p.binding !== handoff.binding || p.binding !== dependencies.store.binding)
      throw Error('handoff_scope_denied');
    if (!Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now()
      || !Number.isSafeInteger(p.maxDurationMs) || p.maxDurationMs<100 || p.maxDurationMs>25000)
      throw Error('handoff_budget_denied');
    return {...p};
  };
  if (handoff.sourceResult !== 'success') return {...base,...metadata,state:'blocked',reason:'source_ci_not_successful',executed:false};
  let executed=false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const approved=policy();
    const controller=new AbortController();
    const deadline=new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{controller.abort(Error('handoff_deadline_exceeded'));reject(Error('handoff_deadline_exceeded'));},
        Math.min(approved.maxDurationMs,approved.expiresAt-now()));
    });
    const bounded=<T>(operation:Promise<T>)=>Promise.race([operation,deadline]);
    const before=await bounded(dependencies.store.status(handoff.missionId));
    policy();
    const check=(s:LocalMissionStatus)=>{
      if(s.id!==handoff.missionId || !Number.isSafeInteger(s.checkpointVersion) || s.checkpointVersion<0)
        throw Error('invalid_cloud_ledger_observation');
      return continuationDecision(s);
    };
    const decision=check(before);
    if(decision!=='resume') return {...base,...metadata,state:decision,reason:'ledger_'+decision,executed:false,
      checkpointVersion:before.checkpointVersion,attempts:before.attempts};
    // Host approval is read again after IO. The existing CLI/runtime performs the guarded claim.
    policy(); controller.signal.throwIfAborted();
    executed=true;
    await bounded(dependencies.resume(handoff.missionId,controller.signal));
    const after=await bounded(dependencies.store.status(handoff.missionId));
    policy(); check(after);
    if(after.checkpointVersion<before.checkpointVersion || after.attempts<before.attempts)
      throw Error('cloud_checkpoint_regressed');
    return {...base,...metadata,state:'observed',reason:'runtime_observed',executed,
      checkpointVersion:after.checkpointVersion,attempts:after.attempts};
  } catch(e) {
    const known=[ORIGINAL_CLOUD_BLOCKER,'handoff_scope_denied','handoff_budget_denied','handoff_deadline_exceeded',
      'invalid_cloud_ledger_observation','invalid_continuation_state','cloud_checkpoint_regressed'];
    const message=e instanceof Error?e.message:'';
    return {...base,...metadata,state:'blocked',reason:known.includes(message)?message:'cloud_ledger_unavailable',executed};
  } finally {if(timer)clearTimeout(timer);}
}
