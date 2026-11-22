import { createHash } from 'node:crypto';
import type { ExecutorAdapter, ExecutorContext, ExecutorResult, MissionPlanStep } from './executorAdapter';
import type { SourceConnector } from '../services/connectors/types';
import { CatalogIntegrationError, SyntheticCatalogConnector } from '../integrations/syntheticCatalogConnector';

export const CATALOG_PERMISSION = 'catalog_synthetic_read';
export const CATALOG_GOAL = 'Read the authorized synthetic catalog';
export const CATALOG_PLAN: MissionPlanStep[] = [{ id: 'catalog-read', task: 'catalog.synthetic.read', depends_on: [] }];
export const CATALOG_RESTRICTIONS = ['local_synthetic_only', 'no_network', 'no_send', 'read_only'];
export interface CatalogAuditEvent {
  missionId: string;
  checkpointVersion: number;
  event: 'catalog_read_requested' | 'catalog_read_completed' | 'catalog_read_denied';
  reason?: string;
  digest?: string;
  count?: number;
  simulation: true;
}

/** Adapter for the existing mission entry point. Permission comes from the host ledger, never task input.
 * Host owns the connector, immutable source metadata and audit sink; candidate receives none of its credentials.
 */
export class CatalogMissionExecutor implements ExecutorAdapter {
  constructor(readonly executorId: string, private readonly connector: SourceConnector,
    private readonly audit: (event: CatalogAuditEvent) => Promise<void>,
    private readonly source: { branch: string; sha: string }) {
    if (!(connector instanceof SyntheticCatalogConnector) || !/^[a-f0-9]{40}$/.test(source.sha)
      || typeof audit !== 'function' || !/^[a-zA-Z0-9._:-]{1,80}$/.test(executorId)) throw Error('catalog_host_configuration_required');
  }
  async execute(context: ExecutorContext, signal?: AbortSignal): Promise<ExecutorResult> {
    signal?.throwIfAborted();
    const record = (event: Omit<CatalogAuditEvent, 'missionId' | 'checkpointVersion' | 'simulation'>) => this.audit({
      missionId: context.mission.missionId, checkpointVersion: context.checkpointVersion, simulation: true, ...event,
    });
    const mission = context.mission;
    if (!context.permissions.includes(CATALOG_PERMISSION) || context.executorId !== this.executorId
      || !/^synthetic-catalog-[a-z0-9-]{1,40}$/.test(mission.missionId)
      || mission.goal !== CATALOG_GOAL || mission.goalVersion !== 1 || mission.planVersion !== 1
      || mission.objective !== undefined || JSON.stringify(mission.plan) !== JSON.stringify(CATALOG_PLAN)
      || JSON.stringify(mission.restrictions) !== JSON.stringify(CATALOG_RESTRICTIONS)
      || JSON.stringify(mission.completionCriteria) !== JSON.stringify(['synthetic_catalog_read'])
      || context.checkpoint.current_step_id !== 'catalog-read' || context.checkpoint.completed_steps.length !== 0) {
      await record({ event: 'catalog_read_denied', reason: 'catalog_authorization_required' });
      throw Error('catalog_authorization_required');
    }
    await record({ event: 'catalog_read_requested' });
    signal?.throwIfAborted();
    let items;
    try { items = await this.connector.searchProducts({ limit: 2 }); }
    catch (error) {
      const reason = error instanceof CatalogIntegrationError ? error.code : 'catalog_unavailable';
      await record({ event: 'catalog_read_denied', reason });
      throw Error(reason);
    }
    signal?.throwIfAborted();
    const digest = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    await record({ event: 'catalog_read_completed', count: items.length, digest });
    signal?.throwIfAborted();
    const summary = `SIMULADO:catalog_read:${items.length}:${digest}`;
    return {
      checkpoint: { mission_state: 'ready_to_complete', current_step_id: null, completed_steps: ['catalog-read'],
        pending_steps: [], results: [{ step_id: 'catalog-read', status: 'passed', summary }],
        artifacts: [`synthetic-catalog:sha256:${digest}`], test_evidence: [`catalog-read:${summary}`],
        worktree: { ...this.source } },
      events: [{ type: 'artifact', stepId: 'catalog-read', summary, reference: `synthetic-catalog:sha256:${digest}` }],
      evidence: [summary],
    };
  }
}
