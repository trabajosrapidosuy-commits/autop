import { createHash } from 'node:crypto';

/** Repository proposal lane only. Never grants synthetic SQL mission permissions. */
export const CLOUD_DEVELOPMENT = Object.freeze({
  repository: 'Victoriosas/autopilot', model: 'gpt-5.4-mini-2026-03-17',
  monthlyMicrousd: 5_000_000, reservationMicrousd: 40_000,
  inputBytes: 20_000, outputTokens: 4_000,
  inputMicrousdPerMillion: 750_000, outputMicrousdPerMillion: 4_500_000,
  reservationStep: 'Generate bounded proposal (USD 0.04 reservation)',
});
export type CloudRun = { id: number; attempt: number; reserved: boolean };
export function cloudPreviewPolicyAllowsProposals(config: unknown): boolean {
  const rules=(config as {git?:{deploymentEnabled?:unknown}}|null)?.git?.deploymentEnabled;
  if(rules===false)return true;
  if(!rules||typeof rules!=='object'||Array.isArray(rules)
    ||(rules as Record<string,unknown>)['codex/cloud-*']!==false)return false;
  // Preserve historical stops. A positive wildcard can override the negative
  // rule in Vercel; unknown pattern overlap therefore fails closed.
  return Object.entries(rules).every(([pattern,state])=>typeof state==='boolean'
    &&(!state||(/^[A-Za-z0-9._/-]+$/.test(pattern)&&!pattern.startsWith('codex/cloud-'))));
}
export function checkCloudBudget(runs: CloudRun[], currentId: number, attempt: number) {
  if (attempt !== 1 || !Number.isSafeInteger(currentId) || currentId <= 0 || !Array.isArray(runs)
    || runs.length > 500 || new Set(runs.map(r => r.id)).size !== runs.length
    || runs.some(r => !Number.isSafeInteger(r.id) || r.id <= 0 || r.attempt !== 1 || typeof r.reserved !== 'boolean')
    || !runs.some(r => r.id === currentId && r.reserved)) throw Error('cloud_budget_unverified');
  const reserved = runs.filter(r => r.reserved).length * CLOUD_DEVELOPMENT.reservationMicrousd;
  if (reserved > CLOUD_DEVELOPMENT.monthlyMicrousd) throw Error('cloud_monthly_budget_exhausted');
  return { reservedMicrousd: reserved, remainingMicrousd: CLOUD_DEVELOPMENT.monthlyMicrousd - reserved };
}

export function cloudSourceAllowed(file: string) {
  return /^src\/autopilot\/[A-Za-z][A-Za-z0-9]*\.ts$/.test(file)
    && !file.endsWith('.test.ts') && !file.startsWith('src/autopilot/cloudDevelopment');
}
export function cloudRegressionAllowed(file: string) {
  return /^src\/autopilot\/[A-Za-z][A-Za-z0-9]*CloudRegression\.test\.ts$/.test(file);
}
const keys = (v: unknown, expected: string[]) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...expected].sort().join(',');
export type CloudProposal = {
  status: 'change' | 'blocked' | 'no_change'; summary: string;
  edits: { path: string; before: string; after: string }[];
  regression: { path: string; source: string } | null;
};
export function validateCloudProposal(value: unknown, sources: Record<string, string>): CloudProposal {
  const p = value as CloudProposal;
  if (!keys(p, ['status','summary','edits','regression']) || !['change','blocked','no_change'].includes(p.status)
    || typeof p.summary !== 'string' || p.summary.length < 1 || p.summary.length > 500
    || !Array.isArray(p.edits) || p.edits.length > 2) throw Error('invalid_cloud_proposal');
  if (p.status !== 'change') {
    if (p.edits.length || p.regression !== null) throw Error('invalid_cloud_proposal');
    return p;
  }
  if (!p.edits.length || new Set(p.edits.map(e => e.path)).size !== p.edits.length
    || !keys(p.regression, ['path','source']) || !cloudRegressionAllowed(p.regression!.path)
    || typeof p.regression!.source !== 'string' || Buffer.byteLength(p.regression!.source) > 8000
    || !p.regression!.source.includes('node:test')) throw Error('invalid_cloud_regression');
  for (const edit of p.edits) {
    if (!keys(edit, ['path','before','after']) || !cloudSourceAllowed(edit.path)
      || typeof sources[edit.path] !== 'string' || typeof edit.before !== 'string' || edit.before.length < 8
      || typeof edit.after !== 'string' || edit.before === edit.after
      || Buffer.byteLength(edit.after) > 8000 || sources[edit.path].split(edit.before).length !== 2
      || Buffer.byteLength(sources[edit.path]) > 65536
      || Buffer.byteLength(sources[edit.path].replace(edit.before,edit.after)) > 65536)
      throw Error('cloud_edit_out_of_scope');
  }
  return p;
}
export function cloudBranch(order: string, objective: string, base: string) {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[A-Za-z0-9-]{3,100}$/.test(order) || !objective)
    throw Error('cloud_order_invalid');
  return 'codex/cloud-' + createHash('sha256').update(JSON.stringify([order, objective, base])).digest('hex').slice(0,20);
}
export function cloudRequest(instructions: string, data: object) {
  const request = {
    model: CLOUD_DEVELOPMENT.model, store: false, service_tier: 'default',
    reasoning: { effort: 'none' }, max_output_tokens: CLOUD_DEVELOPMENT.outputTokens,
    instructions, input: JSON.stringify(data), text: { format: { type: 'json_object' } },
  };
  if (Buffer.byteLength(JSON.stringify(request)) > CLOUD_DEVELOPMENT.inputBytes) throw Error('cloud_input_budget_exceeded');
  return request;
}
export function parseCloudResponse(value: unknown) {
  const r = value as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens: number; output_tokens: number } };
  if (r.status !== 'completed' || !Array.isArray(r.output)
    || r.output.some(o => o.type !== 'reasoning' && (o.type !== 'message' || !Array.isArray(o.content) || o.content.some(c => c.type !== 'output_text')))
    || !r.usage || !Number.isSafeInteger(r.usage.input_tokens) || r.usage.input_tokens < 0
    || !Number.isSafeInteger(r.usage.output_tokens) || r.usage.output_tokens < 0
    || r.usage.input_tokens > CLOUD_DEVELOPMENT.inputBytes + 4096 || r.usage.output_tokens > CLOUD_DEVELOPMENT.outputTokens)
    throw Error('cloud_response_unverified');
  const observedMicrousd = Math.ceil((r.usage.input_tokens * CLOUD_DEVELOPMENT.inputMicrousdPerMillion
    + r.usage.output_tokens * CLOUD_DEVELOPMENT.outputMicrousdPerMillion) / 1_000_000);
  if (observedMicrousd > CLOUD_DEVELOPMENT.reservationMicrousd) throw Error('cloud_response_budget_exceeded');
  return { proposal: JSON.parse(r.output.filter(o=>o.type==='message').flatMap(o => o.content!.map(c => c.text ?? '')).join('')), observedMicrousd };
}
