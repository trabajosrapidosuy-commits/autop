import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CLOUD_DEVELOPMENT as C, checkCloudBudget, cloudBranch, cloudRequest, validateCloudProposal, parseCloudResponse, cloudPreviewPolicyAllowsProposals } from './cloudDevelopment';

test('Vercel JSON has unique keys and preserves production and historical deployment stops',()=>{
  const text=readFileSync(new URL('../../vercel.json',import.meta.url),'utf8');
  const config=JSON.parse(text);
  const syntax=ts.parseJsonText('vercel.json',text);
  const visit=(node:ts.Node)=>{
    if(ts.isObjectLiteralExpression(node)){
      const names=node.properties.filter(ts.isPropertyAssignment).map(p=>ts.isStringLiteral(p.name)?p.name.text:p.name.getText(syntax));
      assert.equal(new Set(names).size,names.length,'duplicate deployment configuration key');
    }
    ts.forEachChild(node,visit);
  };
  visit(syntax);
  assert.equal(config.git.deploymentEnabled.main,false);
  assert.equal(config.git.deploymentEnabled['codex/cloud-*'],false);
  assert.equal(config.git.deploymentEnabled['codex/hosted-ledger-20261112'],false);
});
test('cloud preview gate preserves other stops and denies positive overlapping patterns',()=>{
  const policy=rules=>({git:{deploymentEnabled:rules}});
  assert.equal(cloudPreviewPolicyAllowsProposals(policy({'codex/cloud-*':false,main:false,'codex/old':false})),true);
  assert.equal(cloudPreviewPolicyAllowsProposals(policy({'codex/cloud-*':false,main:true})),true);
  assert.equal(cloudPreviewPolicyAllowsProposals(policy(false)),true);
  for(const rules of [{main:false},{'codex/cloud-*':true},{'codex/cloud-*':false,'*':true},
    {'codex/cloud-*':false,'codex/*':true},{'codex/cloud-*':false,'codex/cloud-other':true},true,null])
    assert.equal(cloudPreviewPolicyAllowsProposals(policy(rules)),false);
});

test('cloud reserves before inference, includes current attempt and never reuses uncertain attempts',()=>{
  const runs = Array.from({length:125},(_,i)=>({id:i+1,attempt:1,reserved:true}));
  assert.equal(checkCloudBudget(runs,125,1).remainingMicrousd,0);
  assert.throws(()=>checkCloudBudget([...runs,{id:126,attempt:1,reserved:true}],126,1),/exhausted/);
  assert.throws(()=>checkCloudBudget(runs,125,2),/unverified/);
  assert.throws(()=>checkCloudBudget([],125,1),/unverified/);
  assert.throws(()=>checkCloudBudget([...runs,runs[0]],125,1),/unverified/);
  assert.equal(checkCloudBudget([{id:1,attempt:1,reserved:false},{id:2,attempt:1,reserved:true}],2,1).reservedMicrousd,40000);
});
test('worst-case byte/token estimate fits fixed reservation without tools, retries or premium tier',()=>{
  const bound=Math.ceil(((C.inputBytes+4096)*C.inputMicrousdPerMillion+C.outputTokens*C.outputMicrousdPerMillion)/1e6);
  assert(bound<=C.reservationMicrousd);
  const r=cloudRequest('Return JSON only',{goal:'safe'});
  assert.equal(r.model,'gpt-5.4-mini-2026-03-17');assert.equal(r.store,false);
  assert.equal(r.service_tier,'default');assert(!('tools' in r));
  assert.throws(()=>cloudRequest('x'.repeat(20001),{}),/input_budget/);
});
const source='export function count(x: number) { return Math.min(x, 5); }\n';
const proposal=()=>({status:'change',summary:'Bound negatives',edits:[{path:'src/autopilot/sample.ts',before:'Math.min(x, 5)',after:'Math.max(0, Math.min(x, 5))'}],
  regression:{path:'src/autopilot/sampleCloudRegression.test.ts',source:"import test from 'node:test'; test('negative',()=>{});"}});
test('cloud candidate is limited to host-supplied source fragments and one new regression',()=>{
  const sources={'src/autopilot/sample.ts':source};
  assert.equal(validateCloudProposal(proposal(),sources).status,'change');
  for(const file of ['../../x','.github/workflows/plan-cloud.yml','src/autopilot/sample.test.ts','src/autopilot/cloudDevelopment.ts','docs/CODEX_CONTINUATION.json']){
    const p=proposal();p.edits[0].path=file;assert.throws(()=>validateCloudProposal(p,{[file]:source}));
  }
  assert.throws(()=>validateCloudProposal(proposal(),{}));
  assert.throws(()=>validateCloudProposal(proposal(),{'src/autopilot/sample.ts':source+source}));
  assert.throws(()=>validateCloudProposal(proposal(),{'src/autopilot/sample.ts':source+' '.repeat(65536)}));
  assert.throws(()=>validateCloudProposal(proposal(),{'src/autopilot/sample.ts':source+' '.repeat(65536-Buffer.byteLength(source))}));
  const bad=proposal();bad.regression.path='src/autopilot/sample.test.ts';assert.throws(()=>validateCloudProposal(bad,sources));
  assert.throws(()=>validateCloudProposal({...proposal(),command:'curl secret'},sources));
  assert.throws(()=>validateCloudProposal({...proposal(),status:'blocked'},sources));
});
test('refused/incomplete/tool-bearing responses and missing usage cannot become effects',()=>{
  const valid={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"status":"blocked"}'}]}],usage:{input_tokens:100,output_tokens:100}};
  assert.equal(parseCloudResponse(valid).observedMicrousd,525);
  assert.equal(parseCloudResponse({...valid,output:[{type:'reasoning'},...valid.output]}).observedMicrousd,525);
  for(const bad of [{...valid,status:'incomplete'},{...valid,usage:null},{...valid,output:[{type:'function_call'}]},
    {...valid,usage:{input_tokens:100,output_tokens:4001}}])assert.throws(()=>parseCloudResponse(bad));
});
test('publication identity changes with canonical order, objective and base, never random replay',()=>{
  const sha='a'.repeat(40);assert.equal(cloudBranch('ORD-P2','one',sha),cloudBranch('ORD-P2','one',sha));
  assert.notEqual(cloudBranch('ORD-P2','one',sha),cloudBranch('ORD-P2','two',sha));
  assert.throws(()=>cloudBranch('ORD-P2','one','main'));
});
