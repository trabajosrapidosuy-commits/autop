/** Source-owned proof shared by the operator regression and isolated native diagnostics. */
import assert from 'node:assert/strict';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { readFile,writeFile,lstat } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LocalMissionStore } from '../../src/autopilot/localMissionStore';
import { readLocalConfig } from '../../src/autopilot/localMissionConfig';
import { ManagedProcesses } from '../../src/autopilot/managedProcesses';
const exec=promisify(execFile);
interface ProcessEvidence {pid:number;mode:string;state:string;version?:number;attempts:number;rejected?:boolean;reconciles:number;executions:number;}
export async function verifyProtectedEffectRecovery(config:string,env:NodeJS.ProcessEnv){
 const host=await readLocalConfig(config);
 const processes=new ManagedProcesses();
 const effectStore=new LocalMissionStore(host,processes);
 const worktrees=host.resources.worktreeRoot;
 const objective={version:1,kind:'synthetic.ensure_verified_artifact',expected:'canonical_synthetic_result',
  restrictions:['local_synthetic_only','no_network','no_send'],resources:['synthetic_worktree','result_artifact','verification_fixture'],
  acceptance:['artifact_matches','synthetic_test_passed'],limits:{maxReplans:1,maxSteps:8}};
 const fixture=fileURLToPath(new URL('./p1ProtectedRestartProcess.ts',import.meta.url));
 const launch=async(mode:string,id:string):Promise<ProcessEvidence>=>{
  const result=await exec(process.execPath,['--import','tsx',fixture,mode,config,id],{env,windowsHide:true,timeout:60000,maxBuffer:65536});
  const evidence=JSON.parse(result.stdout.trim());
  assert.equal(evidence.mode,mode);assert.ok(Number.isInteger(evidence.pid)&&evidence.pid>0);
  return evidence;
 };
 try {
  // First P2 increment: kill the protected controller AFTER the artifact is
  // written but BEFORE its checkpoint. Keep the existing terminal proof above.
  const effectCases=['good','tampered','missing','revoked'] as const;
  const nonce=randomUUID().slice(0,6);
  const interrupted=new Map<string,{pid:number;checkpoint:Record<string,unknown>;files:unknown[];started:number}>();
  const fileEvidence=async(id:string)=>Promise.all(['result.txt','result.test.cjs'].map(async name=>{
    const file=path.join(worktrees,id,'.autopilot-synthetic',name);
    const info=await lstat(file);
    return {name,sha256:createHash('sha256').update(await readFile(file)).digest('hex'),
      inode:info.ino,mtimeMs:info.mtimeMs,birthtimeMs:info.birthtimeMs,size:info.size};
  }));
  for(const scenario of effectCases){
    const id='synthetic-protected-node-effect-'+scenario+'-'+nonce;
    const started=Date.now();
    const child=spawn(process.execPath,['--import','tsx',fixture,'prepare-effect',config,id],
      {env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const exit=once(child,'exit');
    try {
      const message=await Promise.race([
        once(child,'message',{signal:AbortSignal.timeout(30000)}).then(([event])=>event),
        exit.then(()=>{throw Error('protected_effect_controller_exited_early');})
      ]) as {event:string;pid:number};
      assert.equal(message.event,'effect_before_checkpoint');assert.equal(message.pid,child.pid);
      const state=await effectStore.status(id);
      assert.equal(state.state,'in_progress');assert.equal(state.checkpointVersion,2);assert.equal(state.planVersion,1);
      assert.deepEqual(state.checkpoint.completed_steps,['prepare-v1']);assert.equal(state.leaseActive,true);
      interrupted.set(id,{pid:child.pid!,checkpoint:state.checkpoint,files:await fileEvidence(id),started});
      assert.equal(child.kill('SIGKILL'),true);
      const [,signal]=await exit;
      assert.equal(signal,'SIGKILL','the original controller must actually be killed at the declared boundary');
      assert.equal(await effectStore.revokeAuthorization(id,1),true);
      const active={id:id+'-recovery',revision:3,missionId:id,binding:effectStore.binding,phase:'F0' as const,
        executorId:'local:active-effect-probe',goalVersion:1,checkpointVersion:2,planVersion:1,
        recovery:'reconcile_effect' as const,objective,expiresAt:Date.now()+60000};
      await assert.rejects(effectStore.authorizeMission(active,2),'new recovery cannot take a live lease');
      assert.deepEqual((await effectStore.status(id)).checkpoint,state.checkpoint);
    } finally {
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}
    }
  }
  const recoveredEffects=[];
  for(const scenario of effectCases){
    const id='synthetic-protected-node-effect-'+scenario+'-'+nonce;
    const original=interrupted.get(id)!;
    const until=Date.now()+20000;
    while((await effectStore.status(id)).leaseActive){
      if(Date.now()>until)throw Error('effect_recovery_lease_did_not_expire');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const artifact=path.join(worktrees,id,'.autopilot-synthetic','result.txt');
    if(scenario==='tampered')await writeFile(artifact,'synthetic conflicting effect\n');
    const mode=scenario==='good'?'recover-effect':`recover-effect-${scenario}`;
    const result=await launch(mode,id);
    assert.notEqual(result.pid,original.pid);
    const state=await effectStore.status(id);
    if(scenario==='good'){
      assert.equal(result.state,'completed');assert.equal(result.version,5);assert.equal(result.attempts,2);
      assert.equal(result.reconciles,1);assert.equal(result.executions,1);
      assert.deepEqual(await fileEvidence(id),original.files,'reconciliation must preserve file identity, hashes and timestamps');
    }else{
      assert.equal(result.rejected,true);assert.equal(state.state,'in_progress');assert.equal(state.checkpointVersion,2);
      assert.deepEqual(state.checkpoint,original.checkpoint);assert.equal(result.executions,0);
      if(scenario==='missing')await assert.rejects(lstat(artifact),{code:'ENOENT'},'read-only reconciliation did not recreate the removed effect');
      if(scenario==='tampered')assert.equal(await readFile(artifact,'utf8'),'synthetic conflicting effect\n');
      if(scenario==='revoked'){
        assert.equal(state.authorization?.active,false);assert.equal(state.authorization?.revision,4);
        assert.deepEqual(await fileEvidence(id),original.files);
      }
    }
    assert.ok(Date.now()-original.started<90000,'each bounded scenario must finish within90s');
    recoveredEffects.push({scenario,initialPid:original.pid,recoveryPid:result.pid,state:state.state,
      version:state.checkpointVersion,attempts:state.attempts,reconciles:result.reconciles,executions:result.executions});
  }
  return {event:'protected_effect_recovery_verified',cases:recoveredEffects};
 } finally {await processes.close();}
}
