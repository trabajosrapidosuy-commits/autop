import test from 'node:test';
import assert from 'node:assert/strict';
import { validCamelRunDraft } from './consultationCamelRun';

const valid = {
  schema_version: '1.0',
  questions: ['¿Cuánto cuesta?'],
  services_candidates: ['orientacion'],
  knowledge_gaps: ['Tarifa no aprobada'],
  variants: {
    personalizada: 'Victoria deberá revisar el costo.',
    breve: 'Costo pendiente de confirmar.',
    orientacion: 'Se requiere evaluación inicial.',
  },
  guardian: { status: 'REQUIERE_VICTORIA', reasons: ['No hay fuentes aprobadas'] },
  action: 'BORRADOR_NO_ENVIADO',
};

test('camelRun only accepts supervised no-send drafts', () => {
  assert.equal(validCamelRunDraft(valid), true);
  assert.equal(validCamelRunDraft({ ...valid, action: 'ENVIAR' }), false);
  assert.equal(validCamelRunDraft({ ...valid, guardian: { ...valid.guardian, status: 'APTO' } }), false);
  assert.equal(validCamelRunDraft({ ...valid, variants: { ...valid.variants, breve: '' } }), false);
  assert.equal(validCamelRunDraft({ ...valid, questions: [null] }), false);
  assert.equal(validCamelRunDraft({ ...valid, schema_version: '2.0' }), false);
});

test('camelRun fails closed when activation gates are disabled', async () => {
  const { camelRunConsultationDraft } = await import('./consultationCamelRun');
  const old = process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED;
  process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED = 'false';
  try {
    await assert.rejects(
      camelRunConsultationDraft({ message: 'Consulta de prueba', service: 'orientacion' }, 'sample'),
      /CAMELRUN_NOT_ENABLED/,
    );
  } finally {
    if (old === undefined) delete process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED;
    else process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED = old;
  }
});

test('legacy consultation consent does not authorize camelRun', async () => {
  const { camelRunConsultationDraft } = await import('./consultationCamelRun');
  const old = {
    enabled: process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED,
    privacy: process.env.CONSULTATION_PRIVACY_APPROVED,
    processing: process.env.CAMELRUN_DATA_PROCESSING_APPROVED,
    key: process.env.CAMELAI_API_KEY,
  };
  process.env.CAMELRUN_CONSULTATION_DRAFTS_ENABLED = 'true';
  process.env.CONSULTATION_PRIVACY_APPROVED = 'true';
  process.env.CAMELRUN_DATA_PROCESSING_APPROVED = 'true';
  process.env.CAMELAI_API_KEY = 'synthetic-test-only';
  try {
    await assert.rejects(
      camelRunConsultationDraft({ message: 'Consulta sintética', service: 'orientacion', consentVersion: 'consultation-v1' }, 'synthetic'),
      /CAMELRUN_CONSENT_REQUIRED/,
    );
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    };
    restore('CAMELRUN_CONSULTATION_DRAFTS_ENABLED', old.enabled);
    restore('CONSULTATION_PRIVACY_APPROVED', old.privacy);
    restore('CAMELRUN_DATA_PROCESSING_APPROVED', old.processing);
    restore('CAMELAI_API_KEY', old.key);
  }
});


test('legacy remote camelRun cannot bypass PII controls or durable budget, even with opt-in', async () => {
  const { camelRunConsultationDraft } = await import('./consultationCamelRun');
  const keys = ['CAMELRUN_CONSULTATION_DRAFTS_ENABLED','CONSULTATION_PRIVACY_APPROVED',
    'CAMELRUN_DATA_PROCESSING_APPROVED','CAMELAI_API_KEY','CONSULTATION_MODEL_GATEWAY_ENABLED',
    'CONSULTATION_AI_REMOTE_AUTHORIZED','CONSULTATION_AI_DAILY_MICROUSD',
    'CONSULTATION_AI_MONTHLY_MICROUSD'] as const;
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const fetchBefore=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('unsafe network call');};
  for(const key of keys)process.env[key]='true';
  process.env.CAMELAI_API_KEY='synthetic-token';
  process.env.CONSULTATION_AI_DAILY_MICROUSD='0';
  process.env.CONSULTATION_AI_MONTHLY_MICROUSD='0';
  try {
    await assert.rejects(camelRunConsultationDraft({
      aiConsent:true,fullName:'Persona Sintetica',message:'Mi correo es sample@example.invalid y mi telefono 099 123 456; tengo un problema de salud',
      service:'orientacion'},'synthetic-private'),
      /CAMELRUN_LEGACY_DISABLED/);
    assert.equal(calls,0,'legacy route must never call provider without integrated privacy and budget');
  } finally {
    globalThis.fetch=fetchBefore;
    for(const key of keys) {
      if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
    }
  }
});
