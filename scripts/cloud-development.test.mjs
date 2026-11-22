import test from 'node:test';
import assert from 'node:assert/strict';
import { montevideoMonthStart, reservationRecorded, assertCloudRunMonth, reserveCloudEvaluation, advanceCloudEvaluation, requireLiveCloudOptIn, github, cloudInferenceRejection } from './cloud-development.mjs';
import { CLOUD_DEVELOPMENT as C } from '../src/autopilot/cloudDevelopment.ts';

test('inference rejection exposes only fixed diagnostic codes and never provider messages or arbitrary fields',async()=>{
  assert.deepEqual(await cloudInferenceRejection({status:429,json:async()=>({error:{code:'insufficient_quota',message:'PRIVATE',param:'PRIVATE'}})}),
    {httpStatus:429,code:'insufficient_quota',param:null});
  assert.deepEqual(await cloudInferenceRejection({status:400,json:async()=>({error:{code:'unsupported_value',param:'reasoning.effort',message:'PRIVATE'}})}),
    {httpStatus:400,code:'unsupported_value',param:'reasoning.effort'});
  assert.deepEqual(await cloudInferenceRejection({status:401,json:async()=>({error:{code:'PRIVATE',param:'PRIVATE',message:'PRIVATE'}})}),
    {httpStatus:401,code:'unclassified',param:null});
  assert.deepEqual(await cloudInferenceRejection({status:503,json:async()=>{throw Error('PRIVATE');}}),
    {httpStatus:503,code:'unclassified',param:null});
});
test('monthly allowance uses the owner timezone rather than resetting three hours early',()=>{
  assert.equal(montevideoMonthStart(new Date('2026-12-01T02:59:59Z')),'2026-11-01T03:00:00.000Z');
  assert.equal(montevideoMonthStart(new Date('2026-12-01T03:00:00Z')),'2026-12-01T03:00:00.000Z');
  assert.throws(()=>assertCloudRunMonth('2026-12-01T02:59:59Z',new Date('2026-12-01T03:00:00Z')),/month_expired/);
  assert.doesNotThrow(()=>assertCloudRunMonth('2026-12-01T03:00:00Z',new Date('2026-12-02T03:00:00Z')));
});
test('live owner opt-in is reread and revocation between prepare and publish denies the next effect',async()=>{
  let enabled=true,reads=0,effects=0;
  const api=async route=>{
    assert.equal(route,'contents/docs/CODEX_CONTINUATION.json?ref=main');reads++;
    return {encoding:'base64',content:Buffer.from(JSON.stringify({cloud_development_request:{enabled,owner_monthly_budget_usd:5}})).toString('base64')};
  };
  await requireLiveCloudOptIn(api); // prepare admission
  enabled=false;
  await assert.rejects(async()=>{await requireLiveCloudOptIn(api);effects++;},/revoked/);
  assert.equal(reads,2);assert.equal(effects,0);
  await assert.rejects(()=>requireLiveCloudOptIn(async()=>null),/unavailable/);
  await assert.rejects(()=>requireLiveCloudOptIn(async()=>({encoding:'base64',content:'broken'})),/unavailable/);
});
test('unchanged evaluations cannot reserve twice and publication cannot replace another writer',async()=>{
  const base='a'.repeat(40),next='b'.repeat(40),branch='codex/cloud-'+'c'.repeat(20);
  let head=null;const operations=[];
  const api=async(route,method='GET',body)=>{
    operations.push({route,method,body});
    if(method==='POST'){
      if(head!==null)throw Error('already_exists');head=body.sha;
      return {ref:body.ref,object:{sha:head}};
    }
    if(method==='GET')return {object:{sha:head}};
    assert.equal(method,'PATCH');assert.equal(body.force,false);head=body.sha;
  };
  await reserveCloudEvaluation(base,branch,api);
  await assert.rejects(()=>reserveCloudEvaluation(base,branch,api),/already_exists/);
  assert.equal(head,base); // blocked/no_change leaves the same durable receipt.
  head='d'.repeat(40);
  await assert.rejects(()=>advanceCloudEvaluation(base,branch,next,api,async()=>{}),/branch_changed/);
  assert.equal(operations.filter(o=>o.method==='PATCH').length,0);
  head=base;await advanceCloudEvaluation(base,branch,next,api,async()=>{});assert.equal(head,next);
  head=base;const before=operations.filter(o=>o.method==='PATCH').length;
  await assert.rejects(()=>advanceCloudEvaluation(base,branch,next,api,async()=>{throw Error('revoked_during_branch_read');}),/revoked/);
  assert.equal(operations.filter(o=>o.method==='PATCH').length,before);
});
test('failed/cancelled/uncertain first attempts consume their reservation, skipped steps do not',()=>{
  const jobs=step=>({total_count:1,jobs:[{steps:[{name:C.reservationStep,...step}]}]});
  for(const step of [{status:'in_progress',conclusion:null},{status:'completed',conclusion:'success'},
    {status:'completed',conclusion:'failure'},{status:'completed',conclusion:'cancelled'}])assert.equal(reservationRecorded(jobs(step)),true);
  assert.equal(reservationRecorded(jobs({status:'completed',conclusion:'skipped'})),false);
  assert.equal(reservationRecorded(jobs({status:'queued',conclusion:null})),false);
  assert.throws(()=>reservationRecorded({total_count:101,jobs:[]}),/unverified/);
  assert.throws(()=>reservationRecorded(null),/unverified/);
  assert.throws(()=>reservationRecorded({total_count:1,jobs:[{}]}),/unverified/);
});

test('every GitHub write rereads live consent after intervening reads and fails closed',async t=>{
  const token=process.env.GH_TOKEN;
  process.env.GH_TOKEN='synthetic-test-only';
  t.after(()=>{if(token===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=token;});
  let enabled=true,unavailable=false,policyReads=0;
  const writes=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const route=String(url).split('/repos/'+C.repository+'/')[1];
    if(route==='contents/docs/CODEX_CONTINUATION.json?ref=main'){
      policyReads++;
      if(unavailable)return {ok:false,status:403};
      return {ok:true,status:200,json:async()=>({encoding:'base64',content:Buffer.from(JSON.stringify({
        cloud_development_request:{enabled,owner_monthly_budget_usd:5}
      })).toString('base64')})};
    }
    if(options.method==='GET'){
      // Consent can change while an unrelated GitHub read is pending.
      enabled=false;
      return {ok:true,status:200,json:async()=>({})};
    }
    writes.push({route,method:options.method});
    return {ok:true,status:200,json:async()=>({})};
  });
  const effects=[['git/refs','POST'],['git/blobs','POST'],['git/trees','POST'],
    ['git/commits','POST'],['git/refs/heads/codex/cloud-test','PATCH'],
    ['pulls','POST'],['actions/workflows/autopilot-core-v4.yml/dispatches','POST']];
  for(const [route,method] of effects){
    enabled=true;
    await requireLiveCloudOptIn(github); // earlier live()/prepare admission
    await github('pulls?state=open&per_page=100');
    await assert.rejects(()=>github(route,method,{}),/cloud_opt_in_revoked/);
  }
  assert.equal(writes.length,0);
  assert.equal(policyReads,effects.length*2);
  enabled=true;
  await github('git/blobs','POST',{});
  await github('git/trees','POST',{});
  assert.equal(writes.length,2);
  assert.equal(policyReads,effects.length*2+2); // no cached permission between writes
  unavailable=true;
  await assert.rejects(()=>github('pulls','POST',{}),/github_operation_failed/);
  assert.equal(writes.length,2);
});
