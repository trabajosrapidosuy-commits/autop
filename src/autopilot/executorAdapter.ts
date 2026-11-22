import type { AgentId } from './sixAgentControlPlane';
import type { PlanProposal, SyntheticObservation } from './missionPlanner';

export interface MissionPlanStep {
  id: string;
  depends_on: string[];
  task: string;
}

export interface MissionSpecification {
  missionId: string;
  goal: string;
  goalVersion: number;
  planVersion: number;
  plan: MissionPlanStep[];
  restrictions: string[];
  completionCriteria: string[];
  /** Structured authorization, never an executable plan or a source of host permissions. */
  objective?: unknown;
  planHistory?: PlanProposal[];
}

export interface MissionStepResult {
  step_id: string;
  status: 'passed' | 'failed' | 'blocked';
  summary: string;
}

export type MissionCheckpointState =
  | 'queued'
  | 'in_progress'
  | 'retry_wait'
  | 'blocked'
  | 'cancelled'
  | 'ready_to_complete'
  | 'completed';

export interface PersistedMissionCheckpoint {
  mission_state: MissionCheckpointState;
  current_step_id?: string | null;
  completed_steps: string[];
  pending_steps: string[];
  results: MissionStepResult[];
  artifacts: string[];
  test_evidence: string[];
  worktree?: {
    branch: string;
    sha: string;
  };
  last_error?: string;
  plan_version?: number;
}

export interface MissionCheckpoint extends Omit<PersistedMissionCheckpoint, 'mission_state' | 'current_step_id' | 'worktree'> {
  mission_state: 'in_progress' | 'ready_to_complete';
  current_step_id: string | null;
  worktree: {
    branch: string;
    sha: string;
  };
}

export interface ExecutorContext {
  mission: MissionSpecification;
  checkpointVersion: number;
  checkpoint: PersistedMissionCheckpoint;
  executorId: string;
  permissions: readonly string[];
}

export interface ExecutorEvent {
  type: 'progress' | 'artifact' | 'test_result';
  stepId: string;
  summary: string;
  reference?: string;
}

export interface ExecutorResult {
  checkpoint: MissionCheckpoint;
  events: ExecutorEvent[];
  evidence: string[];
}

/** A host-authorized, single-use operation in the existing mission runtime. */
export interface MissionEffectRequest {
  kind: 'observe_state' | 'execute_step' | 'reconcile_effect' | 'write_checkpoint' | 'save_plan' | 'block' | 'fail' | 'attest_completion' | 'complete_write';
  operationId: string;
  stepId?: string;
}

/** Opaque capability returned only after independent host verification. */
export type MissionCompletionAttestation = object;

export interface ExecutorAdapter {
  readonly executorId: string;
  execute(context: ExecutorContext, signal?: AbortSignal): Promise<ExecutorResult>;
  /** Read-only reconciliation of an already applied synthetic effect, never creation. */
  reconcile?(context: ExecutorContext, signal?: AbortSignal): Promise<ExecutorResult>;
  observe?(context: ExecutorContext, signal?: AbortSignal): Promise<SyntheticObservation>;
}

export interface ModelProvider {
  readonly providerId: string;
  generate(input: string, signal?: AbortSignal): Promise<string>;
}

export interface MissionLedger {
  readonly recovery?: 'ready_to_complete' | 'reconcile_effect';
  /** Optional host policy gate; checked before any claim, never selected by a task. */
  authorizeExecutor?(executor: ExecutorAdapter): Promise<void>;
  /** Explicitly authorized execution paths must reauthorize every runtime effect. */
  authorizeEffect?(executor: ExecutorAdapter, context: ExecutorContext, effect: MissionEffectRequest, signal?: AbortSignal): Promise<readonly string[]>;
  /** Returns an opaque capability only after independent completion verification. */
  attestCompletion?(executor: ExecutorAdapter, context: ExecutorContext): Promise<MissionCompletionAttestation>;
  claimMission(agentId: AgentId): Promise<ExecutorContext | null>;
  saveCheckpoint(
    context: ExecutorContext,
    operationId: string,
    checkpoint: MissionCheckpoint,
  ): Promise<boolean>;
  completeMission(context: ExecutorContext, evidence: string, attestation?: MissionCompletionAttestation, signal?: AbortSignal): Promise<void>;
  failMission(context: ExecutorContext, reasonCode: string): Promise<void>;
  savePlan?(context: ExecutorContext, proposal: PlanProposal, plannerId: string): Promise<boolean>;
  blockMission?(context: ExecutorContext, reasonCode: string): Promise<void>;
}

export interface MissionOrchestrator {
  readonly ledger: MissionLedger;
  runMission(executor: ExecutorAdapter, agentId: AgentId, signal?: AbortSignal): Promise<void>;
}
