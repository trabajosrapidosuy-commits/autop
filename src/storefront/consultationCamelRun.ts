// camelRun processes one isolated, stateless request. Never reuse the conversational
// supervisor across client records: its persistent history could mix private cases.
const PROMPT = `Sos un agente de borradores de Victoriosas, supervisado por Victoria.
Analizá todas las preguntas e intenciones. No uses web ni memoria de otras consultas.
No inventes precios, turnos, resultados, protocolos, diagnósticos ni promesas.
Sin evidencia aprobada explícita, marcá REQUIERE_VICTORIA y no afirmes que
se realizó una derivación, envío o reserva. Respondé en español uruguayo.
Devolvé SOLO JSON con:
{"schema_version":"1.0","questions":[],"services_candidates":[],
"knowledge_gaps":[],"variants":{"personalizada":"","breve":"","orientacion":""},
"guardian":{"status":"REQUIERE_VICTORIA","reasons":[]},"action":"BORRADOR_NO_ENVIADO"}.
La revisión semántica no sustituye controles deterministas ni autorización de envío.`;

export type AIDraft = {
  schema_version: string; questions: string[]; services_candidates: string[];
  knowledge_gaps: string[];
  variants: { personalizada: string; breve: string; orientacion: string };
  guardian: { status: string; reasons: string[] };
  action: string;
};

export function validCamelRunDraft(result: any): result is AIDraft {
  return result && result.schema_version === '1.0' &&
    Array.isArray(result.questions) && Array.isArray(result.services_candidates) &&
    Array.isArray(result.knowledge_gaps) &&
    result.questions.every((q: unknown) => typeof q === 'string') &&
    result.services_candidates.every((q: unknown) => typeof q === 'string') &&
    result.knowledge_gaps.every((q: unknown) => typeof q === 'string') &&
    result.variants && ['personalizada','breve','orientacion'].every(k =>
      typeof result.variants[k] === 'string' && result.variants[k].length > 0 && result.variants[k].length < 4000) &&
    result.guardian && result.guardian.status === 'REQUIERE_VICTORIA' &&
    Array.isArray(result.guardian.reasons) &&
    result.guardian.reasons.every((q: unknown) => typeof q === 'string') && result.action === 'BORRADOR_NO_ENVIADO';
}

/**
 * Legacy direct-vendor transport is intentionally disabled. It bypassed
 * the current consultation intelligence privacy-risk filter and durable
 * spend reservation; its own opt-in cannot authorize raw customer text.
 * The admin endpoint fails closed until migrated to the approved gateway.
 */
export async function camelRunConsultationDraft(input: unknown, requestId: string): Promise<AIDraft> {
  void requestId;
  if (process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED !== 'true'
    || process.env.CONSULTATION_PRIVACY_APPROVED !== 'true'
    || process.env.CAMELRUN_DATA_PROCESSING_APPROVED !== 'true') throw Error('CAMELRUN_NOT_ENABLED');
  if (!process.env.CAMELAI_API_KEY) throw Error('CAMELRUN_NOT_CONFIGURED');
  const record = input as Record<string,unknown> | null;
  if (record?.aiConsent !== true) throw Error('CAMELRUN_CONSENT_REQUIRED');
  if (typeof record.message !== 'string' || !record.message.trim()) throw Error('CAMELRUN_INVALID_INPUT');
  // Even valid opt-in and flags do not override missing minimization + durable budget.
  throw Error('CAMELRUN_LEGACY_DISABLED');
}
