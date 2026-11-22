import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeCloudHandoff, validateCloudSourceRun, validateCloudHandoff, ORIGINAL_CLOUD_BLOCKER,
  type CloudLedgerHandoff, type CloudHandoffPolicy } from './cloudLedgerHandoff';
import type { LocalMissionStatus } from './localMissionStore';
import { ManagedProcesses } from './managedProcesses';
const handoff=():CloudLedgerHandoff=>({schemaVersion:1,sourceSha:'a'.repeat(40),sourceRun:'44854526918',
  sourceResult:'success',missionId:'synthetic-cloud-handoff-check',binding:'b'.repeat(64)});
const policy=():CloudHandoffPolicy=>({enabled:true,reviewedSha:'a'.repeat(40),missionId:handoff().missionId,
  binding:'b'.repeat(64),expiresAt:Date.now()+10000,maxDurationMs:1000});
const state=(patch:Partial<LocalMissionStatus>={}):LocalMissionStatus=>({id:handoff().missionId,
  queueState:'queued',state:'queued',reason:null,runId:null,leaseActive:false,attempts:0,maxAttempts:3,
  checkpointVersion:0,planVersion:0,checkpoint:{},plans:[],audit:[],...patch});
test('unconfigured handoff preserves original diagnostic without calling the ledger or runtime',async()=>{
  const result=await consumeCloudHandoff(handoff(),{policy:()=>undefined,
    store:{binding:handoff().binding,status:async()=>{throw Error('must_not_query');}},resume:async()=>{throw Error('must_not_resume');}});
  assert.equal(result.reason,ORIGINAL_CLOUD_BLOCKER);assert.equal(result.executed,false);
  assert.equal(result.originalReason,ORIGINAL_CLOUD_BLOCKER);assert.equal(result.schedulerCreated,false);
});
test('strict envelope rejects task credentials, alternate binding types, unknown fields and the preserved uncertain mission',()=>{
  for(const v of [undefined,{}, {...handoff(),credentials:'secret'}, {...handoff(),sourceRun:1},
    {...handoff(),sourceSha:{toString:()=>handoff().sourceSha}}, {...handoff(),schemaVersion:'1'},
    {...handoff(),missionId:'synthetic-protected-node-effect-cancel-cead08'}])assert.throws(()=>validateCloudHandoff(v));
});
test('source run must be exact completed main push of the canonical CI in the owning repository',()=>{
  const r={id:44854526918,head_sha:'a'.repeat(40),status:'completed',conclusion:'success',head_branch:'main',
    event:'push',path:'.github/workflows/autopilot-core-v4.yml',head_repository:{full_name:'Victoriosas/autopilot'}};
  validateCloudSourceRun(r,{sha:r.head_sha,run:String(r.id)});
  for(const patch of [{head_sha:'b'.repeat(40)},{event:'pull_request'},{head_branch:'candidate'},{status:'in_progress'},
    {conclusion:'failure'},{head_repository:{full_name:'other/fork'}},{path:'.github/workflows/untrusted.yml'}])
    assert.throws(()=>validateCloudSourceRun({...r,...patch},{sha:r.head_sha,run:String(r.id)}));
});
test('wrong SHA/binding/mission/expiry/budget and false-like approval are denied before IO',async()=>{
  for(const patch of [{reviewedSha:'c'.repeat(40)},{binding:'c'.repeat(64)},{missionId:'synthetic-other'},
    {expiresAt:0},{maxDurationMs:25001},{enabled:'true'}]){
    let queried=false;
    const r=await consumeCloudHandoff(handoff(),{policy:()=>({...policy(),...patch} as CloudHandoffPolicy),
      store:{binding:handoff().binding,status:async()=>{queried=true;return state();}},resume:async()=>{throw Error('must_not_resume');}});
    assert.equal(r.state,'blocked');assert.equal(r.executed,false);assert.equal(queried,false);
  }
});
test('failed source never resumes; terminal and live-lease duplicate handoffs do not invoke runtime',async()=>{
  for(const s of [state({state:'completed',queueState:'completed',checkpointVersion:5}),
    state({state:'in_progress',queueState:'running',leaseActive:true,attempts:1})]){
    let executions=0;const deps={policy,store:{binding:handoff().binding,status:async()=>s},resume:async()=>{executions++;}};
    const failed=await consumeCloudHandoff({...handoff(),sourceResult:'failure'},deps);
    assert.equal(failed.reason,'source_ci_not_successful');
    const first=await consumeCloudHandoff(handoff(),deps),duplicate=await consumeCloudHandoff(handoff(),deps);
    assert.equal(first.state,duplicate.state);assert.equal(executions,0);
  }
});
test('existing runtime driver advances one durable ledger; duplicate event observes terminal without replay',async()=>{
  let durable=state(),executions=0;
  const deps={policy,store:{binding:handoff().binding,status:async()=>structuredClone(durable)},resume:async(id:string)=>{
    assert.equal(id,durable.id);executions++;
    durable=state({state:'completed',queueState:'completed',attempts:1,checkpointVersion:5});
  }};
  const a=await consumeCloudHandoff(handoff(),deps),b=await consumeCloudHandoff(handoff(),deps);
  assert.equal(a.state,'observed');assert.equal(a.checkpointVersion,5);assert.equal(a.executed,true);
  assert.equal(b.state,'terminal');assert.equal(b.executed,false);assert.equal(executions,1);
});
test('policy revoked while reading ledger denies before resume',async()=>{
  let enabled=true,executions=0;
  const r=await consumeCloudHandoff(handoff(),{policy:()=>({...policy(),enabled}),
    store:{binding:handoff().binding,status:async()=>{enabled=false;return state();}},resume:async()=>{executions++;}});
  assert.equal(r.reason,ORIGINAL_CLOUD_BLOCKER);assert.equal(executions,0);
});
test('provider outage is sanitized and never retried automatically',async()=>{
  let queries=0;
  const r=await consumeCloudHandoff(handoff(),{policy,store:{binding:handoff().binding,status:async()=>{
    queries++;throw Error('secret provider payload');}},resume:async()=>{throw Error('must_not_resume');}});
  assert.equal(r.reason,'cloud_ledger_unavailable');assert.equal(queries,1);
  assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(r.executed,false);
});
test('deadline aborts runtime driver, reports invocation without pretending to roll back an admitted effect',async()=>{
  let aborted=false;
  const r=await consumeCloudHandoff(handoff(),{policy:()=>({...policy(),maxDurationMs:100}),
    store:{binding:handoff().binding,status:async()=>state()},resume:async(_id,signal)=>new Promise<void>((_resolve,reject)=>{
      signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
    })});
  assert.equal(r.reason,'handoff_deadline_exceeded');assert.equal(aborted,true);assert.equal(r.executed,true);
});
test('regressed checkpoint or unrelated observation cannot be reported as recovered',async()=>{
  let calls=0;
  const r=await consumeCloudHandoff(handoff(),{policy,store:{binding:handoff().binding,status:async()=>{
    calls++;return state({checkpointVersion:calls===1?2:1});}},resume:async()=>{}});
  assert.equal(r.reason,'cloud_checkpoint_regressed');
});
test('managed runtime child closes before the host releases temporary resources after deadline', {timeout:10000}, async()=>{
  const events:Array<{event:string;pid:number}>=[];
  const processes=new ManagedProcesses(e=>events.push(e));
  let receipt;
  try {
    receipt=await consumeCloudHandoff(handoff(),{policy:()=>({...policy(),maxDurationMs:100}),
      store:{binding:handoff().binding,status:async()=>state()},resume:async(_id,signal)=>{
        await processes.exec(process.execPath,['-e','setInterval(()=>{},1000)'],
          {signal,timeout:2000,operation:'handoff_test_child'});
      }});
  } finally {await processes.close();}
  assert.equal(receipt.reason,'handoff_deadline_exceeded');
  assert.equal(processes.size,0);
  assert.equal(events.filter(e=>e.event==='process_started').length,1);
  assert.equal(events.find(e=>e.event==='process_ended')?.pid,events.find(e=>e.event==='process_started')?.pid);
});
