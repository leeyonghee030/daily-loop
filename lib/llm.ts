import { supabase } from './supabase';
import { parseRoutineInput, type ParsedRoutineDraft } from './parse-routine-input';

// 파싱 결과가 어디서 나왔는지 (4-8 ② 배지용): 'regex'=규칙 기반 처리, 'llm'=AI 분석
export type ParseSource = 'regex' | 'llm';

export type ParseResult = {
  draft: ParsedRoutineDraft;
  source: ParseSource;
  quotaRemaining?: number; // llm 경로일 때만: 소진 후 남은 횟수
};

export type LlmQuota = { limit: number; used: number; remaining: number };

// 무료 호출 한도를 모두 쓴 상태. UI는 이걸 잡아서 "요금제 안내"(4-13)를 띄운다.
export class QuotaExceededError extends Error {
  limit: number;
  constructor(limit: number) {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
    this.limit = limit;
  }
}

// 남은 LLM 호출 횟수 조회 (배너/입력화면 표시용)
export async function fetchLlmQuota(): Promise<LlmQuota | null> {
  const { data, error } = await supabase.rpc('get_llm_quota');
  if (error || !data) return null;
  return data as LlmQuota;
}

// LLM(Edge Function) 호출 → 초안 JSON을 ParsedRoutineDraft 형태로 정규화.
async function parseWithLlm(text: string): Promise<{ draft: ParsedRoutineDraft; remaining: number }> {
  const { data, error } = await supabase.functions.invoke('parse-routine', {
    body: { text },
  });
  if (error) throw error;
  if (data?.quotaExceeded) throw new QuotaExceededError(data.limit ?? 0);
  const d = data?.draft;
  if (!d) throw new Error('LLM 응답에 draft가 없습니다.');

  const repeatType: ParsedRoutineDraft['repeatType'] = d.repeatType ?? 'once';
  const scheduledTime: string | null = d.scheduledTime ?? null;

  const draft: ParsedRoutineDraft = {
    title: (d.title ?? text).toString().trim(),
    repeatType,
    repeatDays: repeatType === 'custom' ? (d.repeatDays ?? null) : null,
    scheduledTime,
    isRequired: !!d.isRequired,
    blockType: d.blockType === 'tracking' ? 'tracking' : 'check',
    trackingUnit: d.blockType === 'tracking' ? (d.trackingUnit ?? null) : null,
    // 아래 3개는 정규식 파서용 플래그. LLM 경로에선 결과값으로부터 역산해 채운다.
    matchedRepeat: repeatType !== 'once',
    matchedTime: scheduledTime !== null,
    needsLlmFallback: false,
  };
  return { draft, remaining: data?.quota?.remaining ?? 0 };
}

// 하이브리드 파싱 (기획서 4-8):
//   1) 정규식/키워드 사전으로 먼저 시도 → 성공하면 LLM 호출 안 함(횟수 차감 X)
//   2) 애매한 경우(needsLlmFallback)만 Edge Function으로 LLM 호출
// forceLlm: 사용자가 "AI로 정확하게 분석" 버튼을 눌렀을 때 — 정규식 결과와 무관하게 무조건 LLM 호출
export async function parseRoutine(text: string, forceLlm = false): Promise<ParseResult> {
  const regex = parseRoutineInput(text);
  if (!forceLlm && !regex.needsLlmFallback) {
    return { draft: regex, source: 'regex' };
  }
  const { draft, remaining } = await parseWithLlm(text);
  return { draft, source: 'llm', quotaRemaining: remaining };
}
