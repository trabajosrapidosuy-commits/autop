import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentMissionOrchestrator } from './missionRuntime';
import type { ExecutorAdapter, ExecutorContext, MissionLedger } from './executorAdapter';

for (const mode of ['cancel', 'deadline'] as const) {
  test(`pending recovery claim respects runtime ${mode} and never executes its late result`, async () => {
    let release!: (context: ExecutorContext) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<ExecutorContext>(resolve => { release = resolve; });
    const events: string[] = [];
    const ledger: MissionLedger = {
      claimMission: async () => { entered(); return pending; },
      saveCheckpoint: async () => { events.push('checkpoint'); return true; },
      completeMission: async () => { events.push('complete'); },
      failMission: async () => { events.push('fail'); },
    };
    const executor: ExecutorAdapter = {
      executorId: 'synthetic-claim-cancellation',
      execute: async () => { events.push('execute'); throw Error('unexpected_execution'); },
    };
    const controller = new AbortController();
    const reason = Error('host_cancelled');
    const run = new PersistentMissionOrchestrator(ledger, mode === 'deadline' ? 20 : 45000)
      .runMission(executor, 'software', controller.signal);
    // Observe rejection immediately so a timeout never becomes unhandled.
    const outcome = run.then(() => 'resolved' as const, error => error);
    await started;
    if (mode === 'cancel') controller.abort(reason);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([outcome, new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('claim_wait_ignored_signal'), 1000);
      })]);
      if (mode === 'cancel') assert.equal(result, reason);
      else assert.equal((result as Error)?.name, 'TimeoutError');
      assert.deepEqual(events, []);
    } finally {
      clearTimeout(timer);
      // A started claim may still settle; cancellation must not use its result.
      release({
        mission: { missionId: 'synthetic-claim-cancellation', goal: 'Synthetic cancellation test',
          goalVersion: 1, planVersion: 1, plan: [], restrictions: ['no_send'], completionCriteria: ['verified'] },
        checkpoint: { mission_state: 'ready_to_complete', completed_steps: [], pending_steps: [],
          results: [], artifacts: [], test_evidence: [] },
        permissions: [], executorId: '', checkpointVersion: 2,
      });
      await outcome;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(events, []);
    }
  });
}
