import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { approvePersistedTask } from './taskStore';

type TaskRow = {
  id: string; status: string; goal: string; actor: string; action: string;
  input: null; policy_context: Record<string,unknown> | null;
  created_at: string; updated_at: string;
};
function fixture() {
  const row:TaskRow={ id:'task_1700000000000_abcdefg',status:'awaiting_approval',
    goal:'synthetic protected action', actor:'codex',action:'deploy_production',
    input:null,policy_context:{risk:'high'}, created_at:'2026-11-01T00:00:00.000Z',
    updated_at:'2026-11-01T00:00:00.000Z' };
  const audit:{event:string}[]=[];
  const client={
    from:(_table:string)=>({
      select:(_cols:string)=>({
        eq:(_field:string,_value:string)=>({
          maybeSingle: async()=>({data:structuredClone(row),error:null}),
        }),
      }),
    }),
    rpc:async(name:string,args:Record<string,unknown>)=>{
      assert.equal(name,'approve_agent_task_if_current');
      if(row.status!=='awaiting_approval'||args.p_task_id!==row.id
        ||args.p_expected_updated_at!==row.updated_at
        ||args.p_expected_actor!==row.actor||args.p_expected_action!==row.action
        ||JSON.stringify(args.p_expected_context)!==JSON.stringify(row.policy_context)) {
        return {data:false,error:null};
      }
      row.status='queued'; row.updated_at='2026-11-01T00:00:01.000Z';
      audit.push({event:'TASK_APPROVED'});
      return {data:true,error:null};
    },
  } as unknown as SupabaseClient;
  return {row,client,audit};
}

test('persisted approval works after in-memory task maps are gone and is audited once',async()=>{
  const f=fixture();
  const task=await approvePersistedTask(f.row.id,f.client);
  assert.equal(task.status,'queued');
  assert.equal(task.policyContext?.risk,'high');
  assert.equal(task.audit.at(-1)?.event,'TASK_APPROVED');
  assert.equal(f.audit.length,1);
  await assert.rejects(approvePersistedTask(f.row.id,f.client),/TASK_NOT_AWAITING_APPROVAL/);
  assert.equal(f.audit.length,1);
});
test('two independent instances cannot approve a persisted task twice',async()=>{
  const f=fixture();
  const res=await Promise.allSettled([
    approvePersistedTask(f.row.id,f.client),approvePersistedTask(f.row.id,f.client),
  ]);
  assert.equal(res.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.audit.length,1);
});
test('legacy or altered policy context cannot be approved after restart',async()=>{
  const f=fixture();
  for(const policy of [null,{risk:'low'},{risk:'high',untrusted:'yes'},
    {risk:'high',amountUsd:-1}]) {
    f.row.policy_context=policy;
    await assert.rejects(approvePersistedTask(f.row.id,f.client),/TASK_POLICY_CONTEXT_UNVERIFIED/);
  }
  f.row.policy_context={risk:'high'};
  f.row.actor='discovery';
  await assert.rejects(approvePersistedTask(f.row.id,f.client),/TASK_POLICY_DENIED/);
  assert.equal(f.audit.length,0);
});
test('generic task approvals are strictly separate from six-agent mission IDs',async()=>{
  const f=fixture();
  await assert.rejects(approvePersistedTask('synthetic-local-run-1',f.client),/TASK_NOT_FOUND/);
});
