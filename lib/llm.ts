import { supabase } from './supabase';
import { parseRoutineInput, type ParsedRoutineDraft } from './parse-routine-input';
import { parseRoutineInputEn } from './parse-routine-input-en';
import { formatLocalDate } from './routines';
import type { Language } from './language';

const KOREAN_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

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

// AI 호출 자체가 실패한 상태(네트워크/타임아웃/동시 사용자 몰림 등, 한도초과와는 다름).
// "AI로 정확하게 분석"을 직접 눌러서 실패한 경우에만 UI에 안내를 띄우는 용도라, 그 자리에서
// 바로 쓸 수 있게 이미 계산해둔 정규식 결과(regexDraft)를 같이 들고 다닌다(2026-09-27)
export class LlmUnavailableError extends Error {
  regexDraft: ParsedRoutineDraft;
  constructor(regexDraft: ParsedRoutineDraft) {
    super('llm_unavailable');
    this.name = 'LlmUnavailableError';
    this.regexDraft = regexDraft;
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
  // AI는 "오늘"이 언제인지 모르기 때문에, "사흘 뒤"/"다음주 금요일" 같은 상대 날짜를 계산하려면
  // 기준이 되는 오늘 날짜를 직접 알려줘야 한다(2026-10-06). 서버(Edge Function)는 UTC라
  // 한국 기준 "오늘"과 어긋날 수 있어서, 이미 로컬 기준으로 정확히 계산하는 클라이언트 쪽에서
  // 구해 같이 보낸다
  const today = new Date();
  const todayDate = formatLocalDate(today);
  const todayWeekday = KOREAN_WEEKDAY[today.getDay()];
  const { data, error } = await supabase.functions.invoke('parse-routine', {
    body: { text, todayDate, todayWeekday },
  });
  if (error) {
    // "사용자 몰림"으로 뭉뚱그리기 전에 실제 원인을 알아야 해서(2026-09-27), Edge Function이
    // 반환한 본문(상태코드+detail)까지 최대한 읽어서 콘솔에 남긴다 — FunctionsHttpError는
    // error.context가 그 응답의 Response 객체다(네트워크 자체가 끊긴 FunctionsFetchError는
    // context에 본문이 없어서 이 시도가 조용히 실패하고 아래 catch로 빠짐)
    try {
      const context = (error as { context?: Response }).context;
      const body = await context?.clone().json();
      console.error('[parse-routine] 호출 실패', { name: error.name, status: context?.status, body });
    } catch {
      console.error('[parse-routine] 호출 실패(본문 읽기 불가)', error);
    }
    throw error;
  }
  if (data?.quotaExceeded) throw new QuotaExceededError(data.limit ?? 0);
  const d = data?.draft;
  if (!d) throw new Error('LLM 응답에 draft가 없습니다.');

  const scheduledTime: string | null = d.scheduledTime ?? null;
  const VALID_SLOT_TYPES = ['morning', 'lunch', 'evening', 'before_sleep'];
  // scheduledTime이 있으면 정확한 시각/시각체크 모드로 들어가서 슬롯을 안 쓰니 항상 null로 둔다
  const slotType: ParsedRoutineDraft['slotType'] =
    !scheduledTime && VALID_SLOT_TYPES.includes(d.slotType) ? d.slotType : null;
  // "YYYY-MM-DD" 형식인지, 그리고 오늘보다 이전 날짜로 잘못 계산되지 않았는지만 가볍게
  // 확인한다(AI가 날짜 계산을 틀렸을 때 과거 날짜 루틴이 조용히 만들어지는 걸 막는 안전장치) —
  // 형식이 안 맞거나 과거면 그냥 null로 버리고, 사용자가 폼에서 직접 날짜를 고르면 된다
  const scheduledDateRaw = typeof d.scheduledDate === 'string' ? d.scheduledDate : null;
  const scheduledDate =
    scheduledDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDateRaw) && scheduledDateRaw >= todayDate
      ? scheduledDateRaw
      : null;
  // 날짜가 구체적으로 있으면 "그날 1회성"이 확실하므로, AI가 repeatType을 다르게(예: daily) 잘못
  // 채웠더라도 once로 강제한다
  const repeatType: ParsedRoutineDraft['repeatType'] = scheduledDate ? 'once' : d.repeatType ?? 'once';

  const draft: ParsedRoutineDraft = {
    title: (d.title ?? text).toString().trim(),
    repeatType,
    repeatDays: repeatType === 'custom' ? (d.repeatDays ?? null) : null,
    scheduledTime,
    slotType,
    scheduledDate,
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
//
// ⚠️ 사용자가 몰려서 AI 호출 자체가 실패할 때의 처리를 분리했다(2026-09-27):
// - 자동 경로(forceLlm=false, 문장이 애매해서 자동으로 AI까지 넘어간 경우)는 사용자가 AI를
//   콕 집어 요청한 게 아니므로, 실패해도 조용히 정규식 결과로 대체해서 그냥 진행한다(에러 화면 X)
// - "AI로 정확하게 분석"을 직접 누른 경우(forceLlm=true)는 사용자가 명시적으로 AI 결과를
//   기대한 거라, 대신 정규식으로 조용히 바꿔치기하면 안 되고 LlmUnavailableError를 던져서
//   화면이 "지금 사용자가 많아 잠시 어려워요" 안내 + 재시도/정규식으로 진행 선택지를 보여주게 한다
export async function parseRoutine(text: string, forceLlm = false, language: Language = 'ko'): Promise<ParseResult> {
  const regex = language === 'en' ? parseRoutineInputEn(text) : parseRoutineInput(text);
  if (!forceLlm && !regex.needsLlmFallback) {
    return { draft: regex, source: 'regex' };
  }
  try {
    const { draft, remaining } = await parseWithLlm(text);
    return { draft, source: 'llm', quotaRemaining: remaining };
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    if (!forceLlm) return { draft: regex, source: 'regex' };
    throw new LlmUnavailableError(regex);
  }
}
