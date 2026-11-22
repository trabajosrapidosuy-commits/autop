import { authorizedObjective } from './missionPlanner';
import { createHash } from 'node:crypto';
import { missionId, type MissionClaimGuard } from './localMissionStore';
import type { ExecutorAdapter, ExecutorContext, MissionCompletionAttestation, MissionEffectRequest, MissionLedger } from './executorAdapter';

/** Host policy data, never a supervisor decision, bearer token or executor payload. */
export interface MissionClaimAuthorization {
  id: string; revision: number; missionId: string; binding: string; phase: 'F0'; executorId: string;
  goalVersion: number; checkpointVersion: number; planVersion: number;
  objective: unknown; expiresAt: number;
  recovery?: 'ready_to_complete' | 'reconcile_effect';
}

export interface MissionEffectDecision {
  allowed: boolean;
  revision: number;
  operationId: string;
  permissions: readonly string[];
}

/** A distinct host-owned verifier; it receives persisted context, never executor output. */
export interface MissionCompletionVerifier {
  verifierId: string;
  verify(context: Readonly<ExecutorContext>): Promise<boolean>;
  /** Host-owned live artifact oracle required for the narrowly scoped P2 recovery. */
  verifyRecovery?(context: Readonly<ExecutorContext>): Promise<boolean>;
}

export interface MissionEffectGuard {
  readonly verifierId: string;
  verifyRecovery(context: ExecutorContext): Promise<void>;
  beforeEffect(executor: ExecutorAdapter, context: ExecutorContext, effect: MissionEffectRequest, signal?: AbortSignal): Promise<readonly string[]>;
  attestCompletion(context: ExecutorContext): Promise<MissionCompletionAttestation>;
  assertAttestation(context: ExecutorContext, attestation: MissionCompletionAttestation): void;
  consumeAttestation(context: ExecutorContext, attestation: MissionCompletionAttestation): void;
}

// Process-local capabilities bind every field of the JSON-compatible context,
// including plan, checkpoint, artifacts and test evidence, not only its version.
const stableJson=(value:unknown)=>JSON.stringify(value,(_key,item)=>
  item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)) : item);
const contextDigest=(context:ExecutorContext)=>createHash('sha256').update(stableJson(context)).digest('hex');

/**
 * The verifier belongs to the trusted host and must consult its current policy.
 * The executor receives neither it nor SQL credentials. Identity is host-selected
 * object identity, not cryptographic authentication of a remote worker.
 * Authorizes ONE fresh claim, terminal recovery, or the exact plan1 P2 effect
 * reconciliation. Terminal recovery still cannot execute steps. No scope grants
 * completion without a new independent attestation.
 */
export function createMissionClaimGuard(
  input: MissionClaimAuthorization,
  executor: ExecutorAdapter,
  verify: (grant: Readonly<MissionClaimAuthorization>) => Promise<boolean>,
): MissionClaimGuard {
  const grant=structuredClone(input);
  if (!grant || !/^[a-z][a-z0-9-]{2,79}$/.test(grant.id) || !Number.isSafeInteger(grant.revision) || grant.revision<1
    || !/^[a-f0-9]{64}$/.test(grant.binding) || grant.phase!=='F0'
    || typeof grant.executorId!=='string' || !/^[a-zA-Z0-9._:-]{1,80}$/.test(grant.executorId) || grant.executorId!==executor?.executorId
    || grant.goalVersion!==1
    || (grant.recovery===undefined ? (grant.checkpointVersion!==0 || grant.planVersion!==0)
      : !['ready_to_complete','reconcile_effect'].includes(grant.recovery) || !Number.isSafeInteger(grant.checkpointVersion) || grant.checkpointVersion<1
        || !Number.isSafeInteger(grant.planVersion) || grant.planVersion<1
        || (grant.recovery==='reconcile_effect' && (grant.checkpointVersion!==2 || grant.planVersion!==1 || typeof executor.reconcile!=='function')))
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt<=Date.now() || grant.expiresAt>Date.now()+60000
    || typeof verify!=='function') throw Error('invalid_mission_authorization');
  missionId(grant.missionId); authorizedObjective(grant.objective);
  const live=async()=>{
    let accepted=false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (Date.now()>=grant.expiresAt) throw Error('expired');
      accepted=await Promise.race([verify(structuredClone(grant)),new Promise<boolean>(resolve=>{
        timer=setTimeout(()=>resolve(false),Math.max(1,grant.expiresAt-Date.now()));
      })])===true;
    } catch { /* sanitize host errors */ }
    finally { clearTimeout(timer); }
    if (!accepted || Date.now()>=grant.expiresAt || executor.executorId!==grant.executorId)
      throw Error('mission_authorization_denied');
  };
  let consumed=false;
  return {
    expected:structuredClone(grant),
    async authorizeExecutor(candidate) {
      if(candidate!==executor || candidate.executorId!==grant.executorId) throw Error('mission_executor_mismatch');
      await live();
    },
    async beforeClaim(agentId) {
      if(agentId!=='software') throw Error('mission_agent_mismatch');
      if(consumed) throw Error('mission_authorization_consumed');
      // Consume before awaiting: concurrent calls and ambiguous SQL outcomes may not replay.
      consumed=true;
      await live();
    },
  };
}

/**
 * Extends the same one-mission host grant. The policy callback is consulted for
 * every executor/write effect; an independent verifier is required for completion.
 * This is intentionally an in-process guard, not a remote identity or atomic
 * policy-revocation guarantee. The SQL ledger still fences writes and leases.
 */
export function createMissionEffectGuard(
  input: MissionClaimAuthorization,
  executor: ExecutorAdapter,
  authorize: (grant: Readonly<MissionClaimAuthorization>, context: Readonly<ExecutorContext>, effect: Readonly<MissionEffectRequest>, signal?: AbortSignal) => Promise<MissionEffectDecision>,
  verifier: MissionCompletionVerifier,
): MissionEffectGuard {
  // Reuse the claim validator so this exported guard cannot be constructed with
  // a malformed, expired, overlong, or out-of-scope grant.
  const grant=createMissionClaimGuard(input,executor,async()=>true).expected;
  if (typeof authorize!=='function' || !verifier || typeof verifier.verifierId!=='string'
    || !/^[a-z][a-z0-9-]{2,79}$/.test(verifier.verifierId) || verifier.verifierId===grant.executorId
    || typeof verifier.verify!=='function'
    || (grant.recovery==='reconcile_effect' && typeof verifier.verifyRecovery!=='function')) throw Error('invalid_mission_effect_authorization');
  const usedOperations=new Set<string>();
  const attestations=new WeakMap<object,{digest:string;consumed:boolean}>();
  const attestationFor=(context:ExecutorContext,token:MissionCompletionAttestation)=>{
    const value=attestations.get(token as object);
    let matches=false;
    try { matches=!!value && !value.consumed && value.digest===contextDigest(context); } catch { /* malformed context */ }
    if(!value || !matches) throw Error('mission_completion_attestation_required');
    return value;
  };
  const deny=()=>Error('mission_effect_authorization_denied');
  // First P2 contract only: plan1, prepare already checkpointed, modify applied
  // but not checkpointed. No generic in_progress recovery or replanning grant.
  const recoveryContext=(context:ExecutorContext):boolean=>{
    const ids=['prepare-v1','modify-v1','verify-v1'];
    const done=context.checkpointVersion-1;
    return context.checkpointVersion>=2 && context.checkpointVersion<=4 && context.mission.planVersion===1
      && context.executorId===grant.executorId && context.mission.missionId===grant.missionId
      && context.mission.goal==='Verify synthetic mission recovery' && context.mission.goalVersion===1
      && stableJson(context.mission.objective)===stableJson(grant.objective)
      && stableJson(context.mission.plan)===stableJson(ids.map((id,i)=>({id,task:`synthetic.${id.split('-')[0]}`,depends_on:i?[ids[i-1]]:[]})))
      && stableJson(context.checkpoint.completed_steps)===stableJson(ids.slice(0,done))
      && stableJson(context.checkpoint.pending_steps)===stableJson(ids.slice(done))
      && context.checkpoint.current_step_id===(ids[done]??null)
      && context.checkpoint.mission_state===(done===3?'ready_to_complete':'in_progress')
      && context.checkpoint.results.length===done
      && context.checkpoint.results.every((result,i)=>result.step_id===ids[i]&&result.status==='passed')
      && context.checkpoint.test_evidence.length>=done
      && context.checkpoint.worktree?.branch===`codex/${grant.missionId}`
      && /^[a-f0-9]{40}$/.test(context.checkpoint.worktree?.sha??'');
  };
  const verifyRecovery=async(context:ExecutorContext):Promise<void>=>{
    let digest='',valid=false;let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      if(grant.recovery!=='reconcile_effect' || !recoveryContext(context) || Date.now()>=grant.expiresAt) throw deny();
      digest=contextDigest(context);
      valid=await Promise.race([verifier.verifyRecovery!(structuredClone(context)),new Promise<boolean>(resolve=>{
        timer=setTimeout(()=>resolve(false),Math.max(1,grant.expiresAt-Date.now()));
      })])===true;
      valid=valid && digest===contextDigest(context) && recoveryContext(context) && Date.now()<grant.expiresAt;
    } catch { valid=false; }
    finally {clearTimeout(timer);}
    if(!valid)throw Error('mission_recovery_unverified');
  };
  const scoped=(candidate:ExecutorAdapter,context:ExecutorContext,effect:MissionEffectRequest): boolean => {
    if (candidate!==executor || candidate.executorId!==grant.executorId || context.executorId!==grant.executorId
      || context.mission.missionId!==grant.missionId || context.mission.goalVersion!==grant.goalVersion
      || !Number.isSafeInteger(context.checkpointVersion) || context.checkpointVersion<grant.checkpointVersion
      || !Number.isSafeInteger(context.mission.planVersion) || context.mission.planVersion<grant.planVersion
      || stableJson(authorizedObjective(context.mission.objective))!==stableJson(authorizedObjective(grant.objective))
      || !effect || !['observe_state','execute_step','reconcile_effect','write_checkpoint','save_plan','block','fail','attest_completion','complete_write'].includes(effect.kind)
      || (effect.kind==='reconcile_effect' && grant.recovery!=='reconcile_effect')
      || (grant.recovery==='ready_to_complete' && !['attest_completion','complete_write'].includes(effect.kind))
      || (grant.recovery==='reconcile_effect' && (!recoveryContext(context)
        || !((effect.kind==='reconcile_effect' && context.checkpointVersion===2 && effect.stepId==='modify-v1')
          || (effect.kind==='execute_step' && context.checkpointVersion===3 && effect.stepId==='verify-v1')
          || (effect.kind==='write_checkpoint' && context.checkpointVersion<4)
          || (['attest_completion','complete_write'].includes(effect.kind) && context.checkpointVersion===4))))
      || typeof effect.operationId!=='string' || effect.operationId.length>200
      || !/^[a-zA-Z0-9._:-]{3,200}$/.test(effect.operationId)
      || (effect.kind==='execute_step' && (typeof effect.stepId!=='string' || !context.mission.plan.some(step=>step.id===effect.stepId)))) return false;
    return true;
  };
  const beforeEffect=async(candidate:ExecutorAdapter,context:ExecutorContext,effect:MissionEffectRequest,signal?:AbortSignal):Promise<readonly string[]>=>{
    signal?.throwIfAborted();
    let inScope=false;
    let digest='',request='';
    try { inScope=scoped(candidate,context,effect);digest=contextDigest(context);request=JSON.stringify(effect); } catch { /* malformed context is denied */ }
    if (!inScope || Date.now()>=grant.expiresAt || usedOperations.has(effect.operationId)) throw deny();
    // Consume before awaiting so uncertain decisions/effects cannot replay.
    usedOperations.add(effect.operationId);
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:(()=>void)|undefined;
    let decision:MissionEffectDecision|undefined;
    try {
      const pending:Promise<undefined>=new Promise(resolve=>{
        timer=setTimeout(()=>resolve(undefined),Math.max(1,grant.expiresAt-Date.now()));
      });
      const aborted=signal ? new Promise<never>((_resolve,reject)=>{
        onAbort=()=>reject(signal.reason);
        signal.addEventListener('abort',onAbort,{once:true});
      }) : undefined;
      decision=await Promise.race([authorize(structuredClone(grant),structuredClone(context),structuredClone(effect),signal),pending,...(aborted?[aborted]:[])]);
    } catch { signal?.throwIfAborted(); /* sanitize host details */ }
    finally { clearTimeout(timer);if(onAbort)signal?.removeEventListener('abort',onAbort); }
    signal?.throwIfAborted();
    if(grant.recovery==='reconcile_effect') await verifyRecovery(context);
    let unchanged=false;
    try { unchanged=digest===contextDigest(context) && request===JSON.stringify(effect) && scoped(candidate,context,effect); } catch { /* deny mutation */ }
    if (!decision || decision.allowed!==true || decision.revision!==grant.revision
      || !unchanged
      || decision.operationId!==effect.operationId || Date.now()>=grant.expiresAt
      || executor.executorId!==grant.executorId || !Array.isArray(decision.permissions)
      || decision.permissions.some(permission=>permission!=='synthetic_worktree')
      || (['observe_state','execute_step','reconcile_effect'].includes(effect.kind) && (decision.permissions.length!==1
        || !authorizedObjective(context.mission.objective).resources.includes('synthetic_worktree')
        || !authorizedObjective(context.mission.objective).restrictions.includes('local_synthetic_only')
        || !authorizedObjective(context.mission.objective).restrictions.includes('no_network')
        || !authorizedObjective(context.mission.objective).restrictions.includes('no_send')))
      || (!['observe_state','execute_step','reconcile_effect'].includes(effect.kind) && decision.permissions.length!==0)) throw deny();
    return [...decision.permissions];
  };
  return {
    verifierId:verifier.verifierId,
    verifyRecovery,
    beforeEffect,
    async attestCompletion(context) {
      let valid=false;
      let snapshot:ExecutorContext;
      let digest='';
      try {
        snapshot=structuredClone(context);digest=contextDigest(snapshot);
        const planIds=snapshot.mission.plan.map(step=>step.id);
        const completed=snapshot.checkpoint.completed_steps;
        const resultIds=snapshot.checkpoint.results.map(result=>result.step_id);
        valid=snapshot.mission.missionId===grant.missionId && snapshot.executorId===grant.executorId
          && snapshot.mission.goalVersion===grant.goalVersion && snapshot.checkpointVersion>=grant.checkpointVersion
          && stableJson(authorizedObjective(snapshot.mission.objective))===stableJson(authorizedObjective(grant.objective))
          && snapshot.checkpoint.mission_state==='ready_to_complete' && snapshot.checkpoint.current_step_id==null
          && snapshot.checkpoint.pending_steps.length===0 && planIds.length>0
          && completed.length===planIds.length && new Set(completed).size===completed.length
          && planIds.every(id=>completed.includes(id)) && resultIds.length===completed.length
          && new Set(resultIds).size===resultIds.length && completed.every(id=>resultIds.includes(id))
          && snapshot.checkpoint.results.every(result=>result.status==='passed')
          && snapshot.checkpoint.test_evidence.length>=completed.length;
      } catch { /* malformed persisted context is denied */ }
      if (!valid) throw Error('mission_completion_unverified');
      let accepted=false;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        if (Date.now()>=grant.expiresAt) throw Error('expired');
        accepted=await Promise.race([verifier.verify(structuredClone(snapshot!)),new Promise<boolean>(resolve=>{
          timer=setTimeout(()=>resolve(false),Math.max(1,grant.expiresAt-Date.now()));
        })])===true;
      } catch { /* sanitize verifier details */ }
      finally { clearTimeout(timer); }
      let unchanged=false;
      try { unchanged=digest===contextDigest(context); } catch { /* malformed changed context */ }
      if (!accepted || !unchanged || Date.now()>=grant.expiresAt) throw Error('mission_completion_unverified');
      const token=Object.freeze({});
      attestations.set(token,{digest,consumed:false});
      return token;
    },
    assertAttestation(context,token) { attestationFor(context,token); },
    consumeAttestation(context,token) {
      const value=attestationFor(context,token);
      // Consume before SQL to prevent replay after an ambiguous completion result.
      value.consumed=true;
    },
  };
}

/** Wrap the existing ledger without introducing a second queue or storage authority. */
export function createAuthorizedMissionLedger(
  base: MissionLedger, executor: ExecutorAdapter, grant: MissionClaimAuthorization,
  guard: MissionEffectGuard, verifierId: string,
): MissionLedger {
  const scopedGrant=createMissionClaimGuard(grant,executor,async()=>true).expected;
  if (verifierId!==guard.verifierId) throw Error('mission_completion_verifier_mismatch');
  const authorize=(context:ExecutorContext,kind:MissionEffectRequest['kind'],operationId:string,stepId?:string)=>
    guard.beforeEffect(executor,context,{kind,operationId,...(stepId?{stepId}:{})});
  return {
    recovery:scopedGrant.recovery,
    authorizeExecutor:candidate=>{
      if(candidate!==executor) throw Error('mission_executor_mismatch');
      return Promise.resolve();
    },
    authorizeEffect:(candidate,context,effect,signal)=>guard.beforeEffect(candidate,context,effect,signal),
    attestCompletion:async(candidate,context)=>{
      if(candidate!==executor) throw Error('mission_executor_mismatch');
      await authorize(context,'attest_completion',`ledger:attest:${scopedGrant.id}:${context.mission.missionId}:${context.checkpointVersion}`);
      return guard.attestCompletion(context);
    },
    claimMission:async agent=>{
      const context=await base.claimMission(agent);
      if(context && scopedGrant.recovery==='reconcile_effect') {
        context.executorId=executor.executorId;
        await guard.verifyRecovery(context);
      }
      return context;
    },
    saveCheckpoint:async(context,operationId,checkpoint)=>{
      await authorize(context,'write_checkpoint',`ledger:${operationId}`);
      return base.saveCheckpoint(context,operationId,checkpoint);
    },
    savePlan:async(context,proposal,plannerId)=>{
      await authorize(context,'save_plan',`ledger:plan:${scopedGrant.id}:${context.mission.missionId}:${proposal.version}`);
      if(!base.savePlan) throw Error('planning_ledger_required');
      return base.savePlan(context,proposal,plannerId);
    },
    blockMission:async(context,reason)=>{
      await authorize(context,'block',`ledger:block:${scopedGrant.id}:${context.mission.missionId}:${context.checkpointVersion}:${reason}`);
      if(!base.blockMission) throw Error('planning_ledger_required');
      return base.blockMission(context,reason);
    },
    failMission:async(context,reason)=>{
      await authorize(context,'fail',`ledger:fail:${scopedGrant.id}:${context.mission.missionId}:${context.checkpointVersion}:${reason}`);
      return base.failMission(context,reason);
    },
    completeMission:async(context,_evidence,attestation,signal)=>{
      if(!attestation) throw Error('mission_completion_attestation_required');
      guard.assertAttestation(context,attestation);
      signal?.throwIfAborted();
      await guard.beforeEffect(executor,context,{kind:'complete_write',operationId:`ledger:complete:${scopedGrant.id}:${context.mission.missionId}:${context.checkpointVersion}`},signal);
      // Rebind after the async policy callback, then consume immediately before SQL.
      signal?.throwIfAborted();
      guard.consumeAttestation(context,attestation);
      return base.completeMission(context,
        `independent:${verifierId}:${scopedGrant.id}:${scopedGrant.revision}:${context.checkpointVersion}`);
    },
  };
}
