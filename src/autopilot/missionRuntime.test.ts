import test from 'node:test';
import assert from 'node:assert/strict';
import { missionFromTask, PersistentMissionOrchestrator } from './missionRuntime';
import { SyntheticMissionExecutor, SYNTHETIC_GOAL, SYNTHETIC_PLAN } from './syntheticMissionExecutor';
import { SYNTHETIC_ACCEPTANCE, SYNTHETIC_RESOURCES, SYNTHETIC_RESTRICTIONS, type PlanProposal } from './missionPlanner';
import type { ExecutorAdapter, ExecutorContext, MissionLedger } from './executorAdapter';

function context(): ExecutorContext {
  return { mission: { missionId: 'synthetic-unit', goal: SYNTHETIC_GOAL, goalVersion: 1, planVersion: 1,
    plan: structuredClone(SYNTHETIC_PLAN), restrictions: ['local_synthetic_only', 'no_network', 'no_send'], completionCriteria: ['synthetic_test_passed'] },
    checkpointVersion: 0, executorId: 'synthetic-unit', permissions: ['synthetic_worktree'],
    checkpoint: { mission_state: 'queued', completed_steps: [], pending_steps: [], results: [], artifacts: [], test_evidence: [] } };
}
test('mission envelope rejects cyclic, unknown and duplicate dependencies before execution', () => {
  for (const plan of [
    [{ id: 'a', task: 'synthetic.prepare', depends_on: ['a'] }],
    [{ id: 'a', task: 'synthetic.prepare', depends_on: ['missing'] }],
    [{ id: 'a', task: 'synthetic.prepare', depends_on: [] }, { id: 'a', task: 'synthetic.prepare', depends_on: [] }],
  ]) {
    assert.throws(() => missionFromTask({ task_id: 'synthetic-unit', claim_token: 'fake', task_payload: {
      goal: SYNTHETIC_GOAL, goal_version: 1, plan_version: 1, restrictions: [], completion_criteria: ['passed'], plan,
      __autopilot: { spec_version: '1', mission_id: 'synthetic-unit', checkpoint_version: 0, checkpoint: {} },
    } }), /invalid/);
  }
});
test('synthetic runner denies missing host permission, goal changes and path traversal before filesystem access', async () => {
  const executor = new SyntheticMissionExecutor('unit', 'unreachable', 'unreachable', 'a'.repeat(40));
  for (const mutate of [
    (c: ExecutorContext) => { c.permissions = []; },
    (c: ExecutorContext) => { c.mission.goal = 'send a message'; },
    (c: ExecutorContext) => { c.mission.missionId = 'synthetic-../../escape'; },
    (c: ExecutorContext) => { c.mission.plan[0].task = 'shell:arbitrary'; },
  ]) {
    const candidate = context(); mutate(candidate);
    await assert.rejects(executor.execute(candidate), /synthetic_authorization_required/);
  }
});
function ledgerFor(candidate: ExecutorContext) {
  const events: string[] = [];
  const ledger: MissionLedger = {
    claimMission: async () => candidate,
    saveCheckpoint: async () => { events.push('save'); return true; },
    completeMission: async () => { events.push('complete'); },
    failMission: async (_context, code) => { events.push(code); },
  };
  return { ledger, events };
}
test('an executor cannot bypass steps or failed evidence to complete the mission', async () => {
  const candidate = context(); const { ledger, events } = ledgerFor(candidate);
  const invalid = { mission_state: 'ready_to_complete' as const, current_step_id: null,
    completed_steps: ['prepare', 'modify', 'verify'], pending_steps: [], results: [], artifacts: [], test_evidence: [], worktree: { branch: 'fake', sha: 'fake' } };
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'invalid', execute: async () => ({ checkpoint: invalid, events: [], evidence: [] }) }, 'software'), /invalid_executor_result/);
  assert.deepEqual(events, []);
});
test('checkpoint refusal stops execution and never attempts a stale completion', async () => {
  const candidate = context(); const { ledger, events } = ledgerFor(candidate);
  ledger.saveCheckpoint = async () => { events.push('rejected'); return false; };
  const checkpoint = { mission_state: 'in_progress' as const, current_step_id: 'modify', completed_steps: ['prepare'], pending_steps: ['modify', 'verify'],
    results: [{ step_id: 'prepare', status: 'passed' as const, summary: 'verified' }], artifacts: [], test_evidence: ['prepare:verified'], worktree: { branch: 'synthetic', sha: 'a'.repeat(40) } };
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'stale', execute: async () => ({ checkpoint, events: [], evidence: [] }) }, 'software'), /checkpoint_rejected/);
  assert.deepEqual(events, ['rejected']);
});
test('executor failure records only a reason code and does not complete', async () => {
  const { ledger, events } = ledgerFor(context());
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'failing', execute: async () => { throw Error('untrusted detailed error'); } }, 'software'), /executor_failed/);
  assert.deepEqual(events, ['executor_failed']);
});
test('recovery after ready checkpoint completes without invoking the executor again', async () => {
  const candidate = context(); candidate.checkpoint.mission_state = 'ready_to_complete';
  candidate.checkpoint.completed_steps = ['prepare', 'modify', 'verify'];
  const { ledger, events } = ledgerFor(candidate);
  await new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'replacement', execute: async () => { throw Error('must not execute'); } }, 'software');
  assert.deepEqual(events, ['complete']);
});
test('abort after second completion authorization prevents the not-yet-admitted ledger write', async () => {
  const candidate = context(); candidate.checkpoint.mission_state = 'ready_to_complete';
  candidate.checkpoint.completed_steps = ['prepare', 'modify', 'verify'];
  const { ledger, events } = ledgerFor(candidate);
  const controller = new AbortController();
  const reason = Error('completion_cancelled');
  const authorization = ledger as MissionLedger & {
    authorizeEffect: (executor: ExecutorAdapter, context: ExecutorContext,
      effect: { kind: string; operationId: string }, signal?: AbortSignal) => Promise<readonly string[]>;
  };
  authorization.authorizeEffect = (_executor, _context, effect, signal) => {
    events.push(`authorize:${effect.kind}`);
    if (effect.kind === 'complete_write') {
      assert.ok(signal);
      assert.equal(signal.aborted, false);
      return { then(resolve: (permissions: readonly string[]) => void) {
        resolve([]);
        controller.abort(reason);
      } } as Promise<readonly string[]>;
    }
    return Promise.resolve([]);
  };
  authorization.attestCompletion = async () => { events.push('attest'); return {}; };
  const outcome = new PersistentMissionOrchestrator(ledger)
    .runMission({ executorId: candidate.executorId, execute: async () => { throw Error('unexpected_execution'); } },
      'software', controller.signal).then(() => null, error => error);
  // Queue abort after the authorization promise settles but before the awaiting
  // runtime continuation resumes, exercising the final admission boundary.
  assert.equal(await outcome, reason);
  assert.deepEqual(events, ['authorize:attest_completion', 'attest', 'authorize:complete_write']);
});
test('effect denial after execution stops before checkpoint write', async () => {
  const candidate = context(); candidate.mission.plan = [{ id: 'prepare', depends_on: [], task: 'synthetic.prepare' }];
  const { ledger, events } = ledgerFor(candidate);
  const authorization = ledger as MissionLedger & { authorizeEffect: (executor: ExecutorAdapter, context: ExecutorContext, effect: { kind: string; operationId: string; stepId?: string }) => Promise<readonly string[]> };
  authorization.authorizeEffect = async (_executor, _context, effect) => {
    events.push(`authorize:${effect.kind}`);
    if (effect.kind === 'write_checkpoint') throw Error('mission_effect_authorization_denied');
    return effect.kind==='execute_step'?['synthetic_worktree']:[];
  };
  authorization.attestCompletion = async () => ({});
  const checkpoint = { mission_state: 'ready_to_complete' as const, current_step_id: null,
    completed_steps: ['prepare'], pending_steps: [],
    results: [{ step_id: 'prepare', status: 'passed' as const, summary: 'synthetic verification' }],
    artifacts: [], test_evidence: ['prepare:verified'], worktree: { branch: 'synthetic', sha: 'a'.repeat(40) } };
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'synthetic-unit',
    execute: async () => { events.push('execute'); return { checkpoint, events: [], evidence: [] }; } }, 'software'),
  /mission_effect_authorization_denied/);
  assert.deepEqual(events, ['authorize:execute_step', 'execute', 'authorize:write_checkpoint']);
});
test('legacy planned ledger uses its explicitly scoped local synthetic permission', async () => {
  const candidate=context();
  const objective={version:1 as const,kind:'synthetic.ensure_verified_artifact' as const,expected:'canonical_synthetic_result' as const,
    restrictions:[...SYNTHETIC_RESTRICTIONS],resources:[...SYNTHETIC_RESOURCES],acceptance:[...SYNTHETIC_ACCEPTANCE],limits:{maxReplans:1,maxSteps:8}};
  const steps=[{id:'prepare-v1',task:'synthetic.prepare',depends_on:[]}];
  const proposal:PlanProposal={version:1,objective,steps,resources:[...objective.resources],restrictions:[...objective.restrictions],
    reason:'initial_state',observation:{worktree:'missing',result:'missing',test:'missing'},evidence:'legacy-local-fixture'};
  candidate.mission.objective=objective; candidate.mission.plan=steps; candidate.mission.planVersion=1; candidate.mission.planHistory=[proposal];
  candidate.checkpoint.mission_state='in_progress'; candidate.checkpoint.pending_steps=['prepare-v1']; candidate.checkpoint.current_step_id='prepare-v1';
  const {ledger,events}=ledgerFor(candidate);
  const executor:ExecutorAdapter={executorId:'synthetic-unit',observe:async()=>({worktree:'missing',result:'missing',test:'missing'}),execute:async snapshot=>({
    checkpoint:{mission_state:'ready_to_complete',current_step_id:null,completed_steps:['prepare-v1'],pending_steps:[],
      results:[{step_id:'prepare-v1',status:'passed',summary:'synthetic'}],artifacts:[],test_evidence:['prepare-v1:verified'],
      worktree:{branch:'synthetic',sha:'a'.repeat(40)}},events:[],evidence:[],
  })};
  const planner={plannerId:'legacy-test-planner',propose:async()=>{throw Error('planner_should_not_run');}};
  await new PersistentMissionOrchestrator(ledger,45_000,planner).runMission(executor,'software');
  assert.deepEqual(events,['save','complete']);
});

test('guarded planner and observation receive only explicitly authorized transient permissions',async()=>{
  const candidate=context();candidate.permissions=[];candidate.mission.plan=[];candidate.mission.planVersion=0;
  candidate.mission.planHistory=[];
  candidate.mission.objective={version:1,kind:'synthetic.ensure_verified_artifact',expected:'canonical_synthetic_result',
    restrictions:[...SYNTHETIC_RESTRICTIONS],resources:[...SYNTHETIC_RESOURCES],acceptance:[...SYNTHETIC_ACCEPTANCE],limits:{maxReplans:1,maxSteps:8}};
  const {ledger}=ledgerFor(candidate);let observed=0,planned=0;
  ledger.authorizeExecutor=async()=>{};
  ledger.authorizeEffect=async(_executor,snapshot,effect)=>{
    assert.deepEqual(snapshot.permissions,[]);
    if(effect.kind==='save_plan') throw Error('synthetic_stop_after_observation');
    return effect.kind==='observe_state'?['synthetic_worktree']:[];
  };
  ledger.attestCompletion=async()=>({});
  ledger.blockMission=async(_context,reason)=>{throw Error(`unexpected_block_${reason}`);};
  ledger.savePlan=async()=>true;
  const executor:ExecutorAdapter={executorId:'synthetic-unit',observe:async snapshot=>{
    observed++;assert.deepEqual(snapshot.permissions,['synthetic_worktree']);
    return {worktree:'missing',result:'missing',test:'missing'};
  },execute:async()=>{throw Error('unused');}};
  const planner={plannerId:'synthetic-planner',propose:async()=>{planned++;throw Error('unused');}};
  await assert.rejects(new PersistentMissionOrchestrator(ledger,45000,planner).runMission(executor,'software'),/synthetic_stop_after_observation/);
  assert.equal(observed,1);assert.equal(planned,0);assert.deepEqual(candidate.permissions,[]);
});
test('post-claim policy revocation blocks the executor before it can run', async () => {
  const candidate=context(); const {ledger,events}=ledgerFor(candidate);
  const guarded=ledger as MissionLedger & {
    authorizeEffect:(executor:ExecutorAdapter,context:ExecutorContext,effect:{kind:string;operationId:string;stepId?:string})=>Promise<readonly string[]>;
    attestCompletion:(executor:ExecutorAdapter,context:ExecutorContext)=>Promise<unknown>;
  };
  guarded.authorizeEffect=async(_executor,_context,effect)=>{events.push(`authorize:${effect.kind}`);throw Error('mission_effect_authorization_denied');};
  guarded.attestCompletion=async()=>({});
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({executorId:'synthetic-unit',
    execute:async()=>{events.push('execute');throw Error('must_not_execute');}},'software'),/mission_effect_authorization_denied/);
  assert.deepEqual(events,['authorize:execute_step']);
});
test('ready_to_complete recovery requires an independent verifier before completion', async () => {
  const candidate = context(); candidate.checkpoint.mission_state = 'ready_to_complete';
  const { ledger, events } = ledgerFor(candidate);
  const guarded = ledger as MissionLedger & {
    authorizeEffect: (executor: ExecutorAdapter, context: ExecutorContext, effect: { kind: string; operationId: string }) => Promise<readonly string[]>;
    attestCompletion: (executor: ExecutorAdapter, context: ExecutorContext) => Promise<unknown>;
  };
  guarded.authorizeEffect = async (_executor, _context, effect) => { events.push(`authorize:${effect.kind}`); return []; };
  guarded.attestCompletion = async () => { events.push('attest'); throw Error('mission_completion_unverified'); };
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'synthetic-unit',
    execute: async () => { events.push('execute'); throw Error('must not execute'); } }, 'software'),
  /mission_completion_unverified/);
  assert.deepEqual(events, ['authorize:attest_completion', 'attest']);
});
test('abort stops the host before any task claim', async () => {
  const { ledger, events } = ledgerFor(context());
  ledger.claimMission = async () => { events.push('claim'); return null; };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new PersistentMissionOrchestrator(ledger).runMission({ executorId: 'unused', execute: async () => { throw Error('unused'); } }, 'software', controller.signal));
  assert.deepEqual(events, []);
});
test('cancelling read-only reconciliation preserves the abort reason and makes no later write',async()=>{
  const candidate=context();candidate.checkpoint.completed_steps=['prepare'];
  candidate.checkpoint.mission_state='in_progress';candidate.checkpoint.current_step_id='modify';
  const {ledger,events}=ledgerFor(candidate);
  const controller=new AbortController();
  await assert.rejects(new PersistentMissionOrchestrator({...ledger,recovery:'reconcile_effect'}).runMission({
    executorId:candidate.executorId,execute:async()=>{throw Error('must_not_execute');},
    reconcile:async()=>{controller.abort();throw Error('injected_reconcile_fault');},
  },'software',controller.signal),{name:'AbortError'});
  assert.deepEqual(events,[]);
});
test('deadline stops a nonresponsive adapter without accepting subsequent writes', async () => {
  const { ledger, events } = ledgerFor(context());
  // An independent timer keeps the test event loop alive; the runtime deadline is unref'ed by Node.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(new PersistentMissionOrchestrator(ledger, 10).runMission({
      executorId: 'nonresponsive', execute: async () => new Promise(() => {}),
    }, 'software'), { name: 'TimeoutError' });
    assert.deepEqual(events, []);
  } finally { clearTimeout(keepAlive); }
});


test('P1 supervisor runtime reads only one host-bound ledger status', async () => {
  let reads=0;
  const binding='synthetic-bound-ledger-verified';
  const store={
    binding,
    status: async (id:string) => {
      reads++;
      assert.equal(id,'synthetic-runtime-check');
      return { id, queueState:'running', state:'in_progress', reason:null,
        runId:'fake-run', leaseActive:true, attempts:1, maxAttempts:2,
        checkpointVersion:3, planVersion:1, checkpoint:{mission_state:'in_progress'},
        plans:[],audit:[] };
    },
  };
  const result=await PersistentMissionOrchestrator.inspectPermanentMission(store,'synthetic-runtime-check',binding);
  assert.deepEqual(result,{goalId:'permanent-objective',missionId:'synthetic-runtime-check',action:'wait',reason:'active_owner'});
  assert.equal(reads,1);
});
test('P1 supervisor runtime refuses unbound or invalid IDs without reading', async () => {
  let reads=0;
  const binding='synthetic-bound-ledger-verified';
  const store={binding,status:async()=>{reads++;throw Error('unexpected_read')}};
  await assert.rejects(PersistentMissionOrchestrator.inspectPermanentMission(store,'synthetic-bounded','incorrect-binding-value'),/supervisor_binding_mismatch/);
  await assert.rejects(PersistentMissionOrchestrator.inspectPermanentMission(store,'synthetic-..-invalid',binding),/invalid_mission_id/);
  assert.equal(reads,0);
});
test('P1 supervisor runtime refuses replay on unverified retry or completion', async () => {
  const binding='synthetic-bound-ledger-verified';
  const status={id:'synthetic-runtime-check',queueState:'failed',state:'retry_wait',reason:'interrupted',runId:null,
    leaseActive:false,attempts:1,maxAttempts:2,checkpointVersion:3,planVersion:1,
    checkpoint:{mission_state:'retry_wait'},plans:[],audit:[]};
  const store={binding,status:async()=>status};
  assert.equal((await PersistentMissionOrchestrator.inspectPermanentMission(store,status.id,binding))?.action,'inspect');
  status.queueState='completed';status.state='completed';status.checkpoint={mission_state:'completed'};
  assert.equal((await PersistentMissionOrchestrator.inspectPermanentMission(store,status.id,binding))?.action,'verify');
});
