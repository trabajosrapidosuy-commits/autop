import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CloudMissionStore,cloudBinding, cloudConnectionUser } from '../src/autopilot/cloudMissionStore.ts';
import { ManagedProcesses } from '../src/autopilot/managedProcesses.ts';
import { consumeCloudHandoff,validateCloudSourceRun } from '../src/autopilot/cloudLedgerHandoff.ts';
import { isolatedHostEnvironment,prepareHostedHost } from './hosted-ledger-host.mjs';

// Invoked only by the manual, protected job. No provisioning/admission path.
const exec=promisify(execFile);
let root;
try {
 const {GITHUB_ACTIONS,GITHUB_SHA,P0C_REVIEWED_SHA,P0C_RUNNER_PASSWORD,P0C_CA_CERT,P0C_MISSION_ID,P0C_ACTION}=process.env;
 if(GITHUB_ACTIONS!=='true' || !/^[a-f0-9]{40}$/.test(GITHUB_SHA||'') || P0C_REVIEWED_SHA!==GITHUB_SHA
   || !['status','resume','handoff'].includes(P0C_ACTION) || !/^synthetic-[a-z0-9-]{1,60}$/.test(P0C_MISSION_ID||'')
   || !P0C_RUNNER_PASSWORD || /[\r\n\0]/.test(P0C_RUNNER_PASSWORD) || !P0C_CA_CERT) throw Error('configuration_required');
 root=await mkdtemp(path.join(tmpdir(),'p0c-runner-'));
 // Deliberately excludes secrets, injected Git/Node/PG options and author configuration.
 const env=isolatedHostEnvironment();
 const config=await prepareHostedHost(root,process.env.P0C_CONNECTION_MODE || 'direct');const {database}=config;
 await writeFile(database.sslRootCert,P0C_CA_CERT,{mode:0o600});
 const escaped=P0C_RUNNER_PASSWORD.replaceAll('\\','\\\\').replaceAll(':','\\:');
 await writeFile(database.passFile,`${database.host}:5432:postgres:${cloudConnectionUser(config)}:${escaped}\n`,{mode:0o600});
 const file=path.join(root,'host.json');await writeFile(file,JSON.stringify(config),{mode:0o600});
 // Only sanitized outcome metadata is published, never config, SQL stderr, task data or audit.
 console.log(JSON.stringify({event:'hosted_runner_configured',binding:cloudBinding(config),baseSha:config.resources.baseSha}));
 if(P0C_ACTION==='handoff') {
   const run=process.env.P0C_HANDOFF_SOURCE_RUN;
   if(!/^[1-9][0-9]{0,19}$/.test(run||'') || process.env.GITHUB_REPOSITORY!=='Victoriosas/autopilot'
     || process.env.GITHUB_REF!=='refs/heads/main' || !process.env.GH_TOKEN) throw Error('source_run_required');
   // One fixed-host API read; no download/execution of triggering artifacts or fork code.
   const response=await fetch(`https://api.github.com/repos/Victoriosas/autopilot/actions/runs/${run}`,{
     headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},
     signal:AbortSignal.timeout(5000),redirect:'error'});
   if(!response.ok)throw Error('source_run_unavailable');
   validateCloudSourceRun(await response.json(),{sha:GITHUB_SHA,run});
   const processes=new ManagedProcesses();
   try {
     const store=new CloudMissionStore(config,processes);
     const policy={enabled:true,reviewedSha:GITHUB_SHA,missionId:P0C_MISSION_ID,binding:cloudBinding(config),
       expiresAt:Date.now()+25000,maxDurationMs:25000};
     const receipt=await consumeCloudHandoff({schemaVersion:1,sourceSha:GITHUB_SHA,sourceRun:run,
       sourceResult:'success',missionId:P0C_MISSION_ID,binding:store.binding},{policy:()=>policy,store,
       resume:async(id,signal)=>{
         await processes.exec(process.execPath,['--import','tsx','scripts/autopilot-mission.ts','resume','--config',file,'--id',id],
           {env,cwd:process.cwd(),signal,timeout:25000,operation:'cloud_handoff_resume'});
       }});
     console.log(JSON.stringify({event:'cloud_handoff_receipt',...receipt}));
     if(receipt.state==='blocked')process.exitCode=2;
   } finally {await processes.close();}
 } else {
 const result=await exec(process.execPath,['--import','tsx','scripts/autopilot-mission.ts',P0C_ACTION,'--config',file,'--id',P0C_MISSION_ID],
   {env,cwd:process.cwd(),windowsHide:true,timeout:45000,maxBuffer:1024*1024});
 const last=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
 console.log(JSON.stringify({event:'hosted_runner_finished',action:P0C_ACTION,completed:true,
   state:['queued','running','completed','blocked','failed','cancelled'].includes(last.mission?.state)?last.mission.state:undefined}));
 }
} catch { console.error('hosted_runner_blocked_or_failed');process.exitCode=2; }
finally {if(root)await rm(root,{recursive:true,force:true});}
