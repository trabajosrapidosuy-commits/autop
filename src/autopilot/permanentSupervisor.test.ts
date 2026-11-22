import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePermanentObjective, decidePermanentObjectiveForLocalStore } from './permanentSupervisor';
const goal = { id: 'permanent-objective', priority: 1, phase: 'F0', enabled: true, missionId: 'synthetic-p0c-cloud-check' };
const observation = { missionId: goal.missionId, state: 'completed' as const, leaseActive: false, checkpointVersion: 5, evidenceVerified: true };
test('verified terminal mission only records checkpoint; no automatic replay', () => {
  assert.deepEqual(decidePermanentObjective([goal],[observation]), {goalId:goal.id,missionId:goal.missionId,action:'checkpoint',reason:'completed_verified'});
});
test('missing evidence must be verified', () => {
  assert.equal(decidePermanentObjective([goal],[{...observation,evidenceVerified:false}])?.action,'verify');
});
test('running lease never causes competing dispatch', () => {
  assert.equal(decidePermanentObjective([goal],[{...observation,state:'running',leaseActive:true}])?.action,'wait');
});
test('failed mission requires review rather than automatic resume', () => {
  assert.equal(decidePermanentObjective([goal],[{...observation,state:'failed'}])?.action,'blocked');
});
test('queued mission does not imply permission to execute', () => {
  assert.equal(decidePermanentObjective([goal],[{...observation,state:'queued'}])?.action,'blocked');
});
test('unknown mission is inspected, not admitted', () => {
  assert.equal(decidePermanentObjective([goal],[])?.action,'inspect');
});
test('priority is deterministic, disabled goals ignored', () => {
  const other={...goal,id:'other-goal',priority:0,enabled:false};
  assert.equal(decidePermanentObjective([other,goal],[observation])?.goalId,goal.id);
});
test('duplicate or invalid inputs fail closed', () => {
  assert.throws(()=>decidePermanentObjective([goal,goal],[]),/duplicate/);
  assert.throws(()=>decidePermanentObjective([{...goal,priority:-1}],[]),/invalid/);
  assert.throws(()=>decidePermanentObjective([goal],[observation,observation]),/invalid/);
});


const binding = 'synthetic-ledger-binding-verified';
const baseStatus = {
  id:goal.missionId, queueState:'running', state:'in_progress',
  reason:null, runId:'synthetic-run', leaseActive:true,
  attempts:1, maxAttempts:2, checkpointVersion:3, planVersion:1,
  checkpoint:{mission_state:'in_progress'}, plans:[], audit:[],
};
const statusStore = (changes: Record<string,unknown> = {}) => ({
  binding, status:async (_id:string) => ({...baseStatus,...changes}),
});
test('host-bound running claim waits and never dispatches',async()=>{
  const result=await decidePermanentObjectiveForLocalStore([goal],statusStore(),binding,'F0');
  assert.equal(result?.action,'wait');
});
test('finished row cannot self-attest verification',async()=>{
  const result=await decidePermanentObjectiveForLocalStore([goal],statusStore({
    queueState:'completed',state:'completed',leaseActive:false,
    checkpoint:{mission_state:'completed'},
  }),binding,'F0');
  assert.equal(result?.action,'verify');
});
test('ready_to_complete is not terminal without independent evidence',async()=>{
  const result=await decidePermanentObjectiveForLocalStore([goal],statusStore({
    state:'ready_to_complete',checkpoint:{mission_state:'ready_to_complete'},
  }),binding,'F0');
  assert.equal(result?.action,'verify');
});
test('expired running lease requires inspection; no competing owner',async()=>{
  const result=await decidePermanentObjectiveForLocalStore([goal],statusStore({leaseActive:false}),binding,'F0');
  assert.equal(result?.action,'inspect');
});
test('retry_wait cannot automatically propose resume',async()=>{
  const result=await decidePermanentObjectiveForLocalStore([goal],statusStore({
    queueState:'failed',state:'retry_wait',leaseActive:false,
    checkpoint:{mission_state:'retry_wait'},
  }),binding,'F0');
  assert.equal(result?.action,'inspect');
});
test('queued or blocked cannot authorize dispatch',async()=>{
  for(const [queueState,state] of [['queued','queued'],['blocked','blocked']]){
    const result=await decidePermanentObjectiveForLocalStore([goal],statusStore({
      queueState,state,leaseActive:false,checkpoint:{mission_state:state},
    }),binding,'F0');
    assert.equal(result?.action,'blocked');
  }
});
test('reject forged booleans, inconsistent states, negative versions, mismatched IDs',async()=>{
  for(const changes of [
    {leaseActive:'false'}, {checkpointVersion:-1}, {id:'other-mission'},
    {queueState:'running',state:'surprise',checkpoint:{mission_state:'surprise'}},
    {state:'completed',queueState:'completed',checkpoint:{mission_state:'in_progress'},leaseActive:false},
    {queueState:'failed',state:'in_progress',leaseActive:false},
  ]){
    await assert.rejects(decidePermanentObjectiveForLocalStore([goal],statusStore(changes),binding,'F0'),/untrusted_mission_status/);
  }
});
test('wrong binding rejected before status read',async()=>{
  let called=false;
  const store={binding,status:async (_id:string)=>{called=true;return {...baseStatus};}};
  await assert.rejects(decidePermanentObjectiveForLocalStore([goal],store,'other-binding-verified','F0'),/supervisor_binding_mismatch/);
  assert.equal(called,false);
});
test('status error returns inspect instead of retrying or replaying',async()=>{
  let calls=0;
  const store={binding,status:async (_id:string):Promise<typeof baseStatus>=>{calls++;throw Error('unavailable');}};
  assert.equal((await decidePermanentObjectiveForLocalStore([goal],store,binding,'F0'))?.action,'inspect');
  assert.equal(calls,1);
});
test('unknown state is invalid even for pure decision API',()=>{
  assert.throws(()=>decidePermanentObjective([goal],[{...observation,state:'malicious'} as never]),/invalid_supervisor_observation/);
});

test('unauthorized product phase rejected before accessing the store',async()=>{
  let reads=0;
  const store={binding,status:async (_id:string)=>{reads++;return {...baseStatus};}};
  await assert.rejects(decidePermanentObjectiveForLocalStore([goal],store,binding,'F1'),/supervisor_phase_mismatch/);
  assert.equal(reads,0);
});
test('invalid goal phase rejected before accessing store',async()=>{
  let reads=0;
  const store={binding,status:async (_id:string)=>{reads++;return {...baseStatus};}};
  await assert.rejects(decidePermanentObjectiveForLocalStore([{...goal,phase:'F9'}],store,binding,'F0'),/invalid_supervisor_goal/);
  assert.equal(reads,0);
});

const forgedEnabledValues: unknown[] = ['false', 'true', '', 0, 1, null, undefined, [], {}, new Boolean(false)];

test('enabled accepts only primitive booleans before selecting an objective', () => {
  for (const enabled of forgedEnabledValues) {
    assert.throws(
      () => decidePermanentObjective([{ ...goal, enabled } as never], []),
      /invalid_supervisor_goal/,
    );
  }
  assert.equal(decidePermanentObjective([{ ...goal, enabled: false }], []), null);
  assert.equal(decidePermanentObjective([{ ...goal, enabled: true }], [])?.action, 'inspect');
});

test('forged or disabled enabled flags cannot reach the host status reader', async () => {
  let reads = 0;
  const store = { binding, status: async (_id: string) => { reads++; return { ...baseStatus }; } };
  for (const enabled of forgedEnabledValues) {
    await assert.rejects(
      decidePermanentObjectiveForLocalStore([{ ...goal, enabled } as never], store, binding, 'F0'),
      /invalid_supervisor_goal/,
    );
  }
  assert.equal(await decidePermanentObjectiveForLocalStore([{ ...goal, enabled: false }], store, binding, 'F0'), null);
  assert.equal(reads, 0);
  assert.equal((await decidePermanentObjectiveForLocalStore([goal], store, binding, 'F0'))?.action, 'wait');
  assert.equal(reads, 1);
});
