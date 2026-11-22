import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticCatalogConnector } from '../integrations/syntheticCatalogConnector';
import { CatalogMissionExecutor, CATALOG_GOAL, CATALOG_PERMISSION, CATALOG_PLAN, CATALOG_RESTRICTIONS, type CatalogAuditEvent } from './catalogMissionExecutor';
import type { ExecutorContext } from './executorAdapter';

function setup() {
  let enabled = true, available = true;
  const connector = new SyntheticCatalogConnector({ enabled: () => enabled, available: () => available, maxCalls: 1 });
  const audit: CatalogAuditEvent[] = [];
  const executor = new CatalogMissionExecutor('catalog-unit', connector, async e => { audit.push(e); }, { branch: 'synthetic/catalog', sha: 'a'.repeat(40) });
  const context: ExecutorContext = { executorId: executor.executorId, permissions: [CATALOG_PERMISSION], checkpointVersion: 0,
    mission: { missionId: 'synthetic-catalog-unit', goal: CATALOG_GOAL, goalVersion: 1, planVersion: 1,
      plan: CATALOG_PLAN, restrictions: CATALOG_RESTRICTIONS, completionCriteria: ['synthetic_catalog_read'] },
    checkpoint: { mission_state: 'queued', current_step_id: 'catalog-read', completed_steps: [], pending_steps: [], results: [], artifacts: [], test_evidence: [] } };
  return { connector, executor, context, audit, disable: () => { enabled = false; }, unavailable: () => { available = false; } };
}

test('synthetic connector exposes only bounded search and rejects every write-capable contract method', async () => {
  const s = setup();
  assert.deepEqual(s.connector.capabilities, ['search']);
  const first = await s.connector.searchProducts({ limit: 2 });
  assert.ok(first.every(p => p.rawAttributes?.simulation === true && p.rawAttributes?.purchasable === false));
  await assert.rejects(s.connector.searchProducts({ limit: 2 }), /catalog_budget_exhausted/);
  await assert.rejects(s.connector.createPurchaseOrder(), /catalog_read_only/);
  await assert.rejects(s.connector.verifyAvailabilityAndPrice(), /catalog_read_only/);
  await assert.rejects(s.connector.getProductByUrl(), /catalog_read_only/);
  await assert.rejects(s.connector.getTracking(), /catalog_read_only/);
});

test('executor denies forged scope and missing permission before a connector read', async () => {
  for (const mutate of [
    (c: ExecutorContext) => { c.permissions = []; },
    (c: ExecutorContext) => { c.mission.goal = 'Publish a real product'; },
    (c: ExecutorContext) => { c.mission.plan = [{ id: 'catalog-read', task: 'purchase', depends_on: [] }]; },
    (c: ExecutorContext) => { c.executorId = 'other'; },
  ]) {
    const s = setup(); mutate(s.context);
    await assert.rejects(s.executor.execute(s.context), /catalog_authorization_required/);
    assert.equal(s.connector.consumedCalls, 0);
    assert.equal(s.audit.at(-1)?.event, 'catalog_read_denied');
  }
});

test('disabled and unavailable connector fail closed with audit and consume no catalog budget', async () => {
  for (const reason of ['catalog_disabled', 'catalog_unavailable']) {
    const s = setup(); if (reason === 'catalog_disabled') s.disable(); else s.unavailable();
    await assert.rejects(s.executor.execute(s.context), new RegExp(reason));
    assert.equal(s.connector.consumedCalls, 0);
    assert.equal(s.audit.at(-1)?.reason, reason);
  }
});

test('host deactivation during awaited audit is checked before any integration read', async () => {
  const s = setup();
  const executor = new CatalogMissionExecutor(s.executor.executorId, s.connector,
    async event => { s.audit.push(event); if (event.event === 'catalog_read_requested') s.disable(); },
    { branch: 'synthetic/catalog', sha: 'a'.repeat(40) });
  await assert.rejects(executor.execute(s.context), /catalog_disabled/);
  assert.equal(s.connector.consumedCalls, 0);
  assert.equal(s.audit.at(-1)?.reason, 'catalog_disabled');
});

test('host quota cannot be overspent by concurrent reads; invalid query and failed audit expose no catalog result', async () => {
  const s = setup();
  await assert.rejects(s.connector.searchProducts({ limit: 1000 }), /catalog_query_denied/);
  const outcomes = await Promise.allSettled([s.connector.searchProducts({ limit: 1 }), s.connector.searchProducts({ limit: 1 })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const t = setup();
  const executor = new CatalogMissionExecutor(t.executor.executorId, t.connector, async () => { throw Error('audit unavailable'); }, { branch: 'synthetic/catalog', sha: 'a'.repeat(40) });
  await assert.rejects(executor.execute(t.context), /audit unavailable/);
  assert.equal(t.connector.consumedCalls, 0);
});
