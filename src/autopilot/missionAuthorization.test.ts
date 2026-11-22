import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorizedMissionLedger, createMissionClaimGuard, createMissionEffectGuard } from './missionAuthorization';
import { PersistentMissionOrchestrator } from './missionRuntime';
import { LocalMissionStore } from './localMissionStore';
import type { ExecutorAdapter, ExecutorContext, MissionLedger } from './executorAdapter';

const objective = { version: 1, kind: 'synthetic.ensure_verified_artifact', expected: 'canonical_synthetic_result',
  restrictions: ['local_synthetic_only','no_network','no_send'], resources: ['synthetic_worktree','result_artifact','verification_fixture'],
  acceptance: ['artifact_matches','synthetic_test_passed'], limits: {maxReplans:1,maxSteps:8} };
const grant = () => ({ id:'synthetic-grant', revision:1, missionId:'synthetic-authorized', binding:'a'.repeat(64),
  phase:'F0' as const, executorId:'synthetic-executor', goalVersion:1, checkpointVersion:0, planVersion:0,
  objective, expiresAt:Date.now()+30000 });
const executor: ExecutorAdapter = {executorId:'synthetic-executor', execute:async()=>{throw Error('unused');}};

test('independent host authorization is required before claim; a supervisor proposal is insufficient', async () => {
  for (const verdict of [false, 'true', null, undefined]) {
    const guard = createMissionClaimGuard(grant(), executor, async () => verdict as boolean);
    await assert.rejects(guard.beforeClaim('software'), /mission_authorization_denied/);
  }
});

test('authorization is immutable, expires, and is single use even when claim outcome is uncertain', async () => {
  const input=grant(); let seen=0;
  const guard=createMissionClaimGuard(input,executor,async checked=>{seen++;assert.equal(checked.revision,1);return true;});
  input.revision=2; input.objective={...objective,limits:{maxReplans:0,maxSteps:1}};
  await guard.authorizeExecutor(executor);
  await guard.beforeClaim('software');
  assert.equal(guard.expected.goalVersion,1);
  assert.deepEqual(guard.expected.objective,objective);
  await assert.rejects(guard.beforeClaim('software'),/mission_authorization_consumed/);
  assert.equal(seen,2);
  assert.throws(()=>createMissionClaimGuard({...grant(),expiresAt:Date.now()-1},executor,async()=>true),/invalid_mission_authorization/);
});

test('identity means the host-selected executor instance, not a copied executorId', async () => {
  const guard=createMissionClaimGuard(grant(),executor,async()=>true);
  await assert.rejects(guard.authorizeExecutor({...executor}),/mission_executor_mismatch/);
  await assert.rejects(guard.beforeClaim('marketing' as never),/mission_agent_mismatch/);
});

test('the current policy revision is rechecked at claim after initial approval',async()=>{
  let currentRevision=1;
  const guard=createMissionClaimGuard(grant(),executor,async checked=>checked.revision===currentRevision);
  await guard.authorizeExecutor(executor);
  currentRevision=2;
  await assert.rejects(guard.beforeClaim('software'),/mission_authorization_denied/);
});

test('revocation or expiration during independent verification denies claim', async () => {
  const expired=createMissionClaimGuard({...grant(),expiresAt:Date.now()+100},executor,async()=>{
    await new Promise(resolve=>setTimeout(resolve,150));return true;
  });
  await assert.rejects(expired.beforeClaim('software'),/mission_authorization_denied/);
  const revoked=createMissionClaimGuard(grant(),executor,async()=>{throw Error('private host detail');});
  await assert.rejects(revoked.beforeClaim('software'),/^Error: mission_authorization_denied$/);
});

test('runtime checks ledger authorization before claiming or invoking an executor', async () => {
  let claims=0;
  const ledger = { authorizeExecutor:async()=>{throw Error('mission_authorization_denied');},
    claimMission:async()=>{claims++;return null;} } as unknown as MissionLedger;
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission(executor,'software'),/mission_authorization_denied/);
  assert.equal(claims,0);
});

test('claim-only authorization cannot be mistaken for per-effect execution authority', async () => {
  const events:string[]=[];
  const ledger = { authorizeExecutor: async () => { events.push('authorize-claim'); },
    claimMission: async () => { events.push('claim'); return null; } } as unknown as MissionLedger;
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission(executor,'software'),/mission_effect_authorization_required/);
  assert.deepEqual(events,['authorize-claim']);
});

test('every post-claim effect is bound to the live policy revision and exact operation',async()=>{
  let revision=1; let allowed=true;
  const context={mission:{missionId:'synthetic-authorized',goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective},
    checkpointVersion:0,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'queued' as const,completed_steps:[],pending_steps:[],results:[],artifacts:[],test_evidence:[]}};
  const guard=createMissionEffectGuard(grant(),executor,async(_grant,_context,effect)=>({
    allowed,revision,operationId:effect.operationId,permissions:effect.kind==='execute_step'?['synthetic_worktree']:[],
  }),{verifierId:'synthetic-verifier',verify:async()=>true});
  await guard.beforeEffect(executor,context,{kind:'execute_step',operationId:'synthetic:effect:1',stepId:'prepare'});
  revision++;
  await assert.rejects(guard.beforeEffect(executor,context,{kind:'write_checkpoint',operationId:'synthetic:effect:2'}),/mission_effect_authorization_denied/);
  revision--;
  allowed=false;
  await assert.rejects(guard.beforeEffect(executor,context,{kind:'write_checkpoint',operationId:'synthetic:effect:3'}),/mission_effect_authorization_denied/);
  await assert.rejects(guard.beforeEffect({...executor},context,{kind:'execute_step',operationId:'synthetic:effect:4',stepId:'prepare'}),/mission_effect_authorization_denied/);
  const substituted=structuredClone(context); substituted.mission.goalVersion=2; allowed=true;
  await assert.rejects(guard.beforeEffect(executor,substituted,{kind:'execute_step',operationId:'synthetic:effect:5',stepId:'prepare'}),/mission_effect_authorization_denied/);
});

test('effect authorization that crosses grant expiry fails closed',async()=>{
  const expiring={...grant(),expiresAt:Date.now()+120};
  const context={mission:{missionId:expiring.missionId,goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective},
    checkpointVersion:0,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'queued' as const,completed_steps:[],pending_steps:[],results:[],artifacts:[],test_evidence:[]}};
  const guard=createMissionEffectGuard(expiring,executor,async(_grant,_context,effect)=>{
    await new Promise(resolve=>setTimeout(resolve,150)); return {allowed:true,revision:expiring.revision,operationId:effect.operationId,
      permissions:effect.kind==='execute_step'?['synthetic_worktree']:[]};
  },{verifierId:'synthetic-verifier',verify:async()=>true});
  await assert.rejects(guard.beforeEffect(executor,context,{kind:'execute_step',operationId:'synthetic:expiry:1',stepId:'prepare'}),/mission_effect_authorization_denied/);
});

test('completion requires a distinct verifier and a one-use context-bound attestation',async()=>{
  const context={mission:{missionId:'synthetic-authorized',goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective},
    checkpointVersion:3,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'ready_to_complete' as const,completed_steps:['prepare'],pending_steps:[],
      results:[{step_id:'prepare',status:'passed' as const,summary:'verified'}],artifacts:[],test_evidence:['prepare:verified']}};
  const decision=async(_grant:unknown,_context:unknown,effect:{operationId:string})=>({allowed:true,revision:1,operationId:effect.operationId,permissions:[]});
  assert.throws(()=>createMissionEffectGuard(grant(),executor,decision,{verifierId:executor.executorId,verify:async()=>true}),/invalid_mission_effect_authorization/);
  assert.throws(()=>createMissionEffectGuard({...grant(),expiresAt:Date.now()-1},executor,decision,{verifierId:'synthetic-verifier',verify:async()=>true}),/invalid_mission_authorization/);
  const unverified=createMissionEffectGuard(grant(),executor,decision,{verifierId:'synthetic-verifier',verify:async()=>false});
  await assert.rejects(unverified.attestCompletion(context),/mission_completion_unverified/);
  const malformed=structuredClone(context);
  malformed.checkpoint.results.push({step_id:'prepare',status:'passed',summary:'duplicate'});
  const rejectsMalformed=createMissionEffectGuard(grant(),executor,decision,{verifierId:'synthetic-verifier',verify:async()=>true});
  await assert.rejects(rejectsMalformed.attestCompletion(malformed),/mission_completion_unverified/);
  const guard=createMissionEffectGuard(grant(),executor,decision,{verifierId:'synthetic-verifier',verify:async snapshot=>snapshot.checkpoint.mission_state==='ready_to_complete'});
  const token=await guard.attestCompletion(context);
  const changed={...context,checkpointVersion:4};
  assert.throws(()=>guard.consumeAttestation(changed,token),/mission_completion_attestation_required/);
  guard.consumeAttestation(context,token);
  assert.throws(()=>guard.consumeAttestation(context,token),/mission_completion_attestation_required/);
});

test('authorized ledger gates direct writes and persists only independent one-use completion evidence',async()=>{
  const context:ExecutorContext={mission:{missionId:'synthetic-authorized',goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective},
    checkpointVersion:3,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'ready_to_complete',completed_steps:['prepare'],pending_steps:[],
      results:[{step_id:'prepare',status:'passed',summary:'verified'}],artifacts:[],test_evidence:['prepare:verified']}};
  const writes:string[]=[];
  const base:MissionLedger={claimMission:async()=>context,saveCheckpoint:async()=>true,
    completeMission:async(_context,evidence)=>{writes.push(evidence);},failMission:async()=>{}};
  const effectGuard=createMissionEffectGuard(grant(),executor,async(_grant,_context,effect)=>({
    allowed:true,revision:1,operationId:effect.operationId,permissions:effect.kind==='execute_step'?['synthetic_worktree']:[],
  }),{verifierId:'synthetic-verifier',verify:async snapshot=>snapshot.checkpoint.mission_state==='ready_to_complete'});
  assert.throws(()=>createAuthorizedMissionLedger(base,executor,grant(),effectGuard,'unverified-verifier'),/mission_completion_verifier_mismatch/);
  const ledger=createAuthorizedMissionLedger(base,executor,grant(),effectGuard,'synthetic-verifier');
  await assert.rejects(ledger.completeMission(context,'executor-supplied-evidence'),/mission_completion_attestation_required/);
  const token=await ledger.attestCompletion!(executor,context);
  await ledger.completeMission(context,'executor-supplied-evidence',token);
  assert.deepEqual(writes,['independent:synthetic-verifier:synthetic-grant:1:3']);
  await assert.rejects(ledger.completeMission(context,'replay',token),/mission_completion_attestation_required/);
  assert.equal(writes.length,1);
});

test('policy revocation between attestation and completion prevents the ledger write',async()=>{
  let allowed=true; const writes:string[]=[];
  const context:ExecutorContext={mission:{missionId:'synthetic-authorized',goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective},
    checkpointVersion:3,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'ready_to_complete',completed_steps:['prepare'],pending_steps:[],
      results:[{step_id:'prepare',status:'passed',summary:'verified'}],artifacts:[],test_evidence:['prepare:verified']}};
  const base:MissionLedger={claimMission:async()=>context,saveCheckpoint:async()=>true,
    completeMission:async(_context,evidence)=>{writes.push(evidence);},failMission:async()=>{}};
  const effectGuard=createMissionEffectGuard(grant(),executor,async(_grant,_context,effect)=>({
    allowed,revision:1,operationId:effect.operationId,permissions:effect.kind==='execute_step'?['synthetic_worktree']:[],
  }),{verifierId:'synthetic-verifier',verify:async()=>true});
  const ledger=createAuthorizedMissionLedger(base,executor,grant(),effectGuard,'synthetic-verifier');
  const token=await ledger.attestCompletion!(executor,context); allowed=false;
  await assert.rejects(ledger.completeMission(context,'untrusted',token),/mission_effect_authorization_denied/);
  assert.deepEqual(writes,[]);
});

test('cancellation during guarded completion authorization prevents the base ledger write',async()=>{
  const context=terminalContext();let writes=0;
  const base:MissionLedger={claimMission:async()=>context,saveCheckpoint:async()=>true,
    completeMission:async()=>{writes++;},failMission:async()=>{}};
  const controller=new AbortController();const reason=Error('guarded_completion_cancelled');
  const guard=createMissionEffectGuard(grant(),executor,(_grant,_context,effect)=>{
    if(effect.kind==='complete_write') return {then(resolve:(decision:{allowed:boolean;revision:number;operationId:string;permissions:readonly string[]})=>void){
      resolve({allowed:true,revision:1,operationId:effect.operationId,permissions:[]});
      controller.abort(reason);
    }} as Promise<{allowed:boolean;revision:number;operationId:string;permissions:readonly string[]}>;
    return Promise.resolve({allowed:true,revision:1,operationId:effect.operationId,permissions:[]});
  },{verifierId:'synthetic-verifier',verify:async()=>true});
  const ledger=createAuthorizedMissionLedger(base,executor,grant(),guard,'synthetic-verifier');
  const token=await ledger.attestCompletion!(executor,context);
  await assert.rejects(ledger.completeMission(context,'untrusted',token,controller.signal),error=>error===reason);
  assert.equal(writes,0);
});

function terminalContext(): ExecutorContext {
  return {mission:{missionId:'synthetic-authorized',goal:'synthetic',goalVersion:1,planVersion:0,
    plan:[{id:'prepare',depends_on:[],task:'synthetic.prepare'}],restrictions:[],completionCriteria:[],objective:structuredClone(objective)},
    checkpointVersion:3,executorId:executor.executorId,permissions:[],
    checkpoint:{mission_state:'ready_to_complete',completed_steps:['prepare'],pending_steps:[],
      results:[{step_id:'prepare',status:'passed',summary:'verified'}],artifacts:['verified-artifact'],test_evidence:['verified-test']}};
}
const allowEffect=async(_grant:unknown,_context:unknown,effect:{operationId:string;kind:string})=>({
  allowed:true,revision:1,operationId:effect.operationId,permissions:effect.kind==='execute_step'?['synthetic_worktree']:[],
});

test('completion attestation binds the exact verified checkpoint, plan and evidence at the same version',async()=>{
  for (const mutate of [
    (c:ExecutorContext)=>{c.checkpoint.artifacts=['unverified-artifact'];},
    (c:ExecutorContext)=>{c.checkpoint.test_evidence=['forged-test'];},
    (c:ExecutorContext)=>{c.checkpoint.results[0].status='failed';},
    (c:ExecutorContext)=>{c.mission.plan[0].task='synthetic.modify';},
    (c:ExecutorContext)=>{c.checkpoint.mission_state='in_progress';},
  ]) {
    const context=terminalContext();
    const guard=createMissionEffectGuard(grant(),executor,allowEffect,{verifierId:'synthetic-verifier',verify:async()=>true});
    const token=await guard.attestCompletion(context);
    const changed=structuredClone(context);mutate(changed);
    assert.throws(()=>guard.consumeAttestation(changed,token),/mission_completion_attestation_required/);
    guard.consumeAttestation(context,token);
  }
});

test('a verifier cannot retarget its approval to a context changed while verification awaited',async()=>{
  const context=terminalContext();
  const guard=createMissionEffectGuard(grant(),executor,allowEffect,{verifierId:'synthetic-verifier',verify:async verified=>{
    assert.deepEqual(verified.checkpoint.artifacts,['verified-artifact']);
    context.checkpoint.artifacts=['unverified-artifact'];return true;
  }});
  await assert.rejects(guard.attestCompletion(context),/mission_completion_unverified/);
});

test('an asynchronous policy approval cannot authorize a different context or operation',async()=>{
  for (const change of ['context','operation']) {
    const context=terminalContext();
    const effect={kind:'write_checkpoint' as const,operationId:'synthetic:write:original'};
    const guard=createMissionEffectGuard(grant(),executor,async(g,c,e)=>{
      assert.deepEqual(c.checkpoint.artifacts,['verified-artifact']);
      if(change==='context') context.checkpoint.artifacts=['unreviewed-artifact'];
      else effect.operationId='synthetic:write:substituted';
      return allowEffect(g,c,e);
    },{verifierId:'synthetic-verifier',verify:async()=>true});
    await assert.rejects(guard.beforeEffect(executor,context,effect),/mission_effect_authorization_denied/);
  }
});

test('changing verified content during completion authorization prevents the base ledger write',async()=>{
  const context=terminalContext();let writes=0;
  const base:MissionLedger={claimMission:async()=>context,saveCheckpoint:async()=>true,
    completeMission:async()=>{writes++;},failMission:async()=>{}};
  const guard=createMissionEffectGuard(grant(),executor,async(g,c,e)=>{
    if(e.kind==='complete_write') context.checkpoint.artifacts=['unreviewed-artifact'];
    return allowEffect(g,c,e);
  },{verifierId:'synthetic-verifier',verify:async()=>true});
  const ledger=createAuthorizedMissionLedger(base,executor,grant(),guard,'synthetic-verifier');
  const token=await ledger.attestCompletion!(executor,context);
  await assert.rejects(ledger.completeMission(context,'untrusted',token),/mission_effect_authorization_denied|mission_completion_attestation_required/);
  assert.equal(writes,0);
});

test('JSON object key order from a SQL ledger does not change the authorized objective',async()=>{
  const context=terminalContext();
  context.mission.objective=Object.fromEntries(Object.entries(objective).reverse());
  const guard=createMissionEffectGuard(grant(),executor,allowEffect,{verifierId:'synthetic-verifier',verify:async()=>true});
  await guard.beforeEffect(executor,context,{kind:'write_checkpoint',operationId:'synthetic:ordered:objective'});
  const token=await guard.attestCompletion(context);
  guard.consumeAttestation(context,token);
});

function policyStore(assertPolicy:()=>Promise<void>) {
  const store=Object.create(LocalMissionStore.prototype) as LocalMissionStore;
  Object.defineProperty(store,'binding',{value:'a'.repeat(64)});
  store.assertAuthorization=assertPolicy;
  store.status=async id=>({id,queueState:'queued',state:'queued',reason:null,runId:null,leaseActive:false,
    attempts:0,maxAttempts:3,checkpointVersion:0,planVersion:0,checkpoint:{mission_state:'queued'},plans:[],audit:[]});
  store.client=()=>({rpc:async()=>({data:[],error:null})}) as never;
  return store;
}

test('runtime factory rejects absent durable policy before reading a supervisor observation',async()=>{
  let observations=0;
  const store=policyStore(async()=>{throw Error('durable_policy_denied');});
  store.status=async()=>{observations++;throw Error('must_not_observe');};
  await assert.rejects(PersistentMissionOrchestrator.authorizedPermanentMissionRuntime(store,grant(),'synthetic-run',executor,
    async()=>true,allowEffect,{verifierId:'synthetic-verifier',verify:async()=>true}),/durable_policy_denied/);
  assert.equal(observations,0);
});

test('callback true cannot override durable revocation after the host decision',async()=>{
  let checks=0,decisions=0;
  const store=policyStore(async()=>{if(++checks>1)throw Error('durable_policy_denied');});
  const ledger=await PersistentMissionOrchestrator.authorizedPermanentMissionRuntime(store,grant(),'synthetic-run',executor,
    async()=>true,async(g,c,e)=>{decisions++;return allowEffect(g,c,e);},
    {verifierId:'synthetic-verifier',verify:async()=>true});
  await assert.rejects(ledger.authorizeEffect!(executor,terminalContext(),{kind:'write_checkpoint',operationId:'synthetic:revoked:write'}),/mission_effect_authorization_denied/);
  assert.equal(checks,2);assert.equal(decisions,1);
});

test('terminal recovery needs an explicit scope and cannot authorize observation, plans or effects',async()=>{
  const recovery={...grant(),checkpointVersion:4,planVersion:1,recovery:'ready_to_complete' as const};
  assert.throws(()=>createMissionClaimGuard({...recovery,recovery:undefined},executor,async()=>true),/invalid_mission_authorization/);
  let decisions=0;
  const guard=createMissionEffectGuard(recovery,executor,async(g,c,e)=>{decisions++;return allowEffect(g,c,e);},
    {verifierId:'synthetic-verifier',verify:async()=>true});
  const context=terminalContext();context.checkpointVersion=4;context.mission.planVersion=1;
  for(const kind of ['execute_step','observe_state','save_plan','write_checkpoint','block','fail'] as const) {
    await assert.rejects(guard.beforeEffect(executor,context,{kind,operationId:`synthetic:recovery:${kind}`,stepId:'prepare'}),/mission_effect_authorization_denied/);
  }
  assert.equal(decisions,0);
  const token=await guard.attestCompletion(context);guard.consumeAttestation(context,token);
});

test('grant executor identity matches the existing SQL checkpoint identifier contract',()=>{
  for(const executorId of ['', 'local:$policy$:$authorization$',"local:quote'",'x'.repeat(81),
    'local:valid\n','local:valid\r','local:valid\u2028','local:valid\u2029','local:valid\0','local/invalid','local invalid','local:ñ']) {
    const candidate={...executor,executorId};
    assert.throws(()=>createMissionClaimGuard({...grant(),executorId},candidate,async()=>true),/invalid_mission_authorization/);
  }
  const executorId='x'.repeat(80);
  assert.doesNotThrow(()=>createMissionClaimGuard({...grant(),executorId},{...executor,executorId},async()=>true));
});

function effectRecoveryContext(): ExecutorContext {
  const context=terminalContext();
  context.mission.goal='Verify synthetic mission recovery';context.mission.planVersion=1;
  context.mission.plan=[
    {id:'prepare-v1',task:'synthetic.prepare',depends_on:[]},
    {id:'modify-v1',task:'synthetic.modify',depends_on:['prepare-v1']},
    {id:'verify-v1',task:'synthetic.verify',depends_on:['modify-v1']},
  ];
  context.checkpointVersion=2;
  context.checkpoint={mission_state:'in_progress',current_step_id:'modify-v1',completed_steps:['prepare-v1'],
    pending_steps:['modify-v1','verify-v1'],results:[{step_id:'prepare-v1',status:'passed',summary:'verified'}],
    artifacts:[],test_evidence:['prepare-v1:verified'],worktree:{branch:'codex/synthetic-authorized',sha:'b'.repeat(40)}};
  return context;
}
const effectRecoveryGrant=()=>({...grant(),checkpointVersion:2,planVersion:1,recovery:'reconcile_effect' as const});
const recoveryDecision=async(g:{revision:number},_c:unknown,e:{operationId:string;kind:string})=>({
  allowed:true,revision:g.revision,operationId:e.operationId,
  permissions:['reconcile_effect','execute_step'].includes(e.kind)?['synthetic_worktree']:[],
});

test('effect recovery requires its own scope and independent live oracle, never a terminal grant',async()=>{
  const replacement={...executor,reconcile:executor.execute};
  assert.doesNotThrow(()=>createMissionClaimGuard(effectRecoveryGrant(),replacement,async()=>true));
  assert.throws(()=>createMissionEffectGuard(effectRecoveryGrant(),replacement,recoveryDecision,
    {verifierId:'independent-recovery',verify:async()=>true}),/invalid_mission_effect_authorization/);
  const guard=createMissionEffectGuard(effectRecoveryGrant(),replacement,recoveryDecision,
    {verifierId:'independent-recovery',verify:async()=>true,verifyRecovery:async()=>false});
  await assert.rejects(guard.beforeEffect(replacement,effectRecoveryContext(),
    {kind:'reconcile_effect',operationId:'recovery:denied',stepId:'modify-v1'}),/mission_recovery_unverified/);
});

test('effect recovery cannot execute modify, prepare, observe, replan or change the admitted plan',async()=>{
  const replacement={...executor,reconcile:executor.execute};let oracleCalls=0;
  const guard=createMissionEffectGuard(effectRecoveryGrant(),replacement,recoveryDecision,
    {verifierId:'independent-recovery',verify:async()=>true,verifyRecovery:async()=>{oracleCalls++;return true;}});
  const context=effectRecoveryContext();
  await guard.beforeEffect(replacement,context,{kind:'reconcile_effect',operationId:'recovery:read',stepId:'modify-v1'});
  assert.equal(oracleCalls,1);
  for(const [kind,stepId] of [['execute_step','modify-v1'],['execute_step','prepare-v1'],['execute_step','verify-v1'],
    ['observe_state',undefined],['save_plan',undefined],['fail',undefined],['block',undefined]] as const){
    await assert.rejects(guard.beforeEffect(replacement,context,{kind,operationId:`recovery:deny:${kind}:${stepId??'none'}`,stepId}),/mission_effect_authorization_denied/);
  }
  const changed=structuredClone(context);changed.mission.planVersion=2;
  await assert.rejects(guard.beforeEffect(replacement,changed,{kind:'reconcile_effect',operationId:'recovery:changed',stepId:'modify-v1'}),/mission_effect_authorization_denied/);
  const tampered=structuredClone(context);tampered.mission.plan[1].task='synthetic.prepare';
  await assert.rejects(guard.beforeEffect(replacement,tampered,{kind:'reconcile_effect',operationId:'recovery:tampered',stepId:'modify-v1'}),/mission_effect_authorization_denied/);
  assert.equal(oracleCalls,1,'out-of-scope operations do not reach the oracle');
});

test('runtime retains class verifier methods and their receiver for existing fresh missions',async()=>{
  class Verifier {
    get verifierId(){return 'class-host-verifier';}
    calls=0;
    async verify(){this.calls++;return true;}
  }
  const verifier=new Verifier();
  const ledger=await PersistentMissionOrchestrator.authorizedPermanentMissionRuntime(policyStore(async()=>{}),grant(),
    'class-verifier-run',executor,async()=>true,allowEffect,verifier);
  await ledger.attestCompletion!(executor,terminalContext());
  assert.equal(verifier.calls,1);
});
