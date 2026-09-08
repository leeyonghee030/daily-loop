import type { ParsedRoutineDraft } from '@/lib/parse-routine-input';
import type { BlockType, RepeatType } from '@/lib/routines';

// 영어 버전 정규식 파서. 한국어판(parse-routine-input.ts)과 목적·범위는 동일 —
// AI 호출 없이 "요일/시간/필수/카운트" 정도의 확실한 패턴만 규칙 기반으로 처리하고,
// 애매하면 needsLlmFallback을 세워 AI로 넘긴다. 이 앱의 루틴 스키마가 애초에 지원하지
// 않는 것들(지속시간, 시작~끝 범위, 하루 여러 번, 요일 CRUD 의도 분류, 알림 오프셋,
// 이벤트 기반 트리거, 세션 간 정정 대화, 타임존/DST 등)은 정규식 여부와 무관하게 처음부터
// 대상 밖 — 그런 문장은 needsLlmFallback으로 AI에게 넘기거나(모호성이 있으면), AI도 못 담는
// 개념이면(예: 하루 두 번 다른 시각) 사용자가 두 개의 루틴으로 나눠 입력해야 한다.

const DAY_TOKEN =
  "sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?";

const DAY_NAME_TO_DOW: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function normalizeDayToken(tok: string): number {
  return DAY_NAME_TO_DOW[tok.toLowerCase()];
}

// 문장에 흔한 줄임말을 매칭용으로만 표준 표현으로 미리 치환한다(제목 "내용"에 해당하는
// 행동 단어 줄임말(bfast 등)은 안 건드림 — 한국어판도 매칭 키워드만 정규화하지 제목 내용
// 자체를 바꾸지는 않는 것과 동일한 원칙)
const ABBREVIATION_MAP: [RegExp, string][] = [
  [/\bwkdays?\b/gi, 'weekdays'],
  [/\bwknds?\b/gi, 'weekends'],
  [/\btmrw?\b/gi, 'tomorrow'],
  [/\bmins?\b/gi, 'minutes'],
  [/\bhrs?\b/gi, 'hours'],
  [/\bsecs?\b/gi, 'seconds'],
];

function normalizeAbbreviations(text: string): string {
  let out = text;
  for (const [re, replacement] of ABBREVIATION_MAP) out = out.replace(re, replacement);
  return out;
}

const NUMBER_WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUMBER_WORD_ALT = Object.keys(NUMBER_WORD_TO_NUM).join('|');

// am/pm 접미사 또는 아침/오후/저녁/밤 단어 중 하나로 시(hour)를 24시간제로 보정한다.
// 아무 단서도 없으면(둘 다 undefined) 입력된 시를 그대로 쓴다(한국어판의 "저녁/오후/밤이
// 아니면 그대로" 방식과 동일한 단순함 — 똑똑한 추론 대신 확실한 신호만 사용)
function applyPeriodOrAmpm(hour: number, minute: number, ampm?: string, period?: string): string | null {
  if (ampm) {
    const isPm = ampm.toLowerCase() === 'p';
    if (hour > 12 || minute > 59) return null;
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  } else if (period) {
    const p = period.toLowerCase();
    if (hour > 23 || minute > 59) return null;
    if ((p === 'evening' || p === 'night' || p === 'afternoon') && hour < 12) hour += 12;
  } else if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 숫자/숫자단어 시각 표현 뒤(드물게 앞)에 붙는 "am/pm" 또는 "in the morning/evening" 류를
// 옵션으로 붙여 공통 처리하기 위한 조각. 최적화 팁: 이 조각 앞에는 \b를 두지 않는다 —
// "quarter past 3pm"처럼 숫자에 am/pm이 공백 없이 바로 붙으면 숫자(단어문자)와 p(단어문자)
// 사이엔 \b가 안 잡히므로, 그 경계를 강제하면 오히려 매칭이 실패한다
const TRAILING_PERIOD = "(?:\\s*([ap])\\.?\\s?m\\.?|\\s*(?:in\\s+the\\s+)?(morning|afternoon|evening|night))?";

function parseTime(text: string): { scheduledTime: string | null; matched: boolean; matchedText: string | null } {
  const noon = text.match(/\bnoon\b|\bmidday\b/i);
  if (noon) return { scheduledTime: '12:00', matched: true, matchedText: noon[0] };

  const midnight = text.match(/\bmidnight\b/i);
  if (midnight) return { scheduledTime: '00:00', matched: true, matchedText: midnight[0] };

  // "quarter to NUMBER" (NUMBER-1시 45분) / "quarter past|after NUMBER" (NUMBER시 15분)
  let m = text.match(new RegExp(`\\bquarter\\s+to\\s+(\\d{1,2}|${NUMBER_WORD_ALT})${TRAILING_PERIOD}`, 'i'));
  if (m) {
    let hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    hour = hour === 1 ? 12 : hour - 1;
    const time = applyPeriodOrAmpm(hour, 45, m[2], m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }
  m = text.match(new RegExp(`\\bquarter\\s+(?:past|after)\\s+(\\d{1,2}|${NUMBER_WORD_ALT})${TRAILING_PERIOD}`, 'i'));
  if (m) {
    const hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    const time = applyPeriodOrAmpm(hour, 15, m[2], m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // "half past NUMBER" / 영국식 "half NUMBER"(전치사 없이도 반시) / "NUMBER thirty"
  m = text.match(new RegExp(`\\bhalf\\s+(?:past\\s+)?(\\d{1,2}|${NUMBER_WORD_ALT})${TRAILING_PERIOD}`, 'i'));
  if (m) {
    const hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    const time = applyPeriodOrAmpm(hour, 30, m[2], m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }
  m = text.match(new RegExp(`\\b(\\d{1,2}|${NUMBER_WORD_ALT})\\s+thirty\\b${TRAILING_PERIOD}`, 'i'));
  if (m) {
    const hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    const time = applyPeriodOrAmpm(hour, 30, m[2], m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // 숫자 시각 + am/pm 접미사 (가장 흔한 형태, "7:30am")
  m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?\b/i);
  if (m) {
    const time = applyPeriodOrAmpm(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // "morning/evening + (at) 숫자시각" ("every morning at 7")
  m = text.match(/\b(morning|afternoon|evening|night)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\b/i);
  if (m) {
    const time = applyPeriodOrAmpm(Number(m[2]), m[3] ? Number(m[3]) : 0, undefined, m[1]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // "at 숫자시각 (+ o'clock) + in the morning/evening" ("at 7 in the evening")
  m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(?:o'?clock)?\s*(?:in\s+the\s+)?(morning|afternoon|evening|night)\b/i);
  if (m) {
    const time = applyPeriodOrAmpm(Number(m[1]), m[2] ? Number(m[2]) : 0, undefined, m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // "NUMBER(숫자|단어) o'clock" (+ am/pm 또는 period 옵션)
  m = text.match(new RegExp(`\\b(\\d{1,2}|${NUMBER_WORD_ALT})\\s*o'?clock\\b${TRAILING_PERIOD}`, 'i'));
  if (m) {
    const hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    const time = applyPeriodOrAmpm(hour, 0, m[2], m[3]);
    if (time) return { scheduledTime: time, matched: true, matchedText: m[0] };
  }

  // 24시간제 HH:MM (am/pm 없음)
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { scheduledTime: `${m[1].padStart(2, '0')}:${m[2]}`, matched: true, matchedText: m[0] };

  // "at NUMBER"(숫자 또는 단어) 단독 — 마지막 보루, period 단서가 전혀 없으면 그 시각 그대로
  m = text.match(new RegExp(`\\bat\\s+(\\d{1,2}|${NUMBER_WORD_ALT})\\b`, 'i'));
  if (m) {
    const hour = NUMBER_WORD_TO_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    if (hour <= 23) return { scheduledTime: `${String(hour).padStart(2, '0')}:00`, matched: true, matchedText: m[0] };
  }

  return { scheduledTime: null, matched: false, matchedText: null };
}

function parseRepeat(
  text: string,
  matchedTime: boolean,
  timeMatchText: string | null
): { repeatType: RepeatType; repeatDays: number[] | null; matched: boolean; matchedText: string | null; extraMatchedText: string | null } {
  const daily = text.match(/\bevery\s*day\b|\beveryday\b|\bdaily\b/i);
  // "Monday to Friday"/"Mon-Fri" 범위 표기 — 딱 월~금 범위일 때만 weekday로 인식(그 외
  // 임의 범위, 예: "Tuesday through Thursday"는 지원 안 함, 아래 목록 매칭에 맡김)
  const weekdayRange = text.match(/\bmon(?:day)?\s*(?:-|to|through)\s*fri(?:day)?\b/i);
  const weekday = text.match(
    /\b(?:on\s+|every\s+)?weekdays?\b|\b(?:on\s+|every\s+)?workdays?\b|\b(?:on\s+|every\s+)?working\s+days?\b/i
  );

  // "except SUNDAY" / "but not FRIDAY" — 매일/평일에서 특정 요일 하나만 빼는 예외.
  // 이 앱의 반복 타입엔 "간격/예외" 개념이 없지만, custom 타입의 요일 배열로는 정확히
  // 표현 가능해서(전체 요일에서 하나만 제외) 이 경우만 규칙으로 처리한다
  const exceptMatch = text.match(new RegExp(`\\b(?:except|but not|excluding)\\s+(${DAY_TOKEN})s?\\b`, 'i'));

  if (daily || weekdayRange || weekday) {
    const baseDays = daily ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const baseMatch = (daily ? daily[0] : weekdayRange ? weekdayRange[0] : weekday![0]) as string;
    if (exceptMatch) {
      const excludeDow = normalizeDayToken(exceptMatch[1]);
      const days = baseDays.filter((d) => d !== excludeDow);
      return { repeatType: 'custom', repeatDays: days, matched: true, matchedText: baseMatch, extraMatchedText: exceptMatch[0] };
    }
    return {
      repeatType: daily ? 'daily' : 'weekday',
      repeatDays: null,
      matched: true,
      matchedText: baseMatch,
      extraMatchedText: null,
    };
  }

  // "every morning" 같이 요일 단어 없이 시간대 단어만으로 매일을 뜻하는 관용 표현.
  // 이미 시간 파서가 그 시간대 단어를 포함해 매칭했으면("morning at 7") "every"만 지우고,
  // 아니면("every evening"만 있고 시각 언급이 없으면) "every 시간대" 전체를 지운다 —
  // 그래야 두 파서의 matchedText가 서로 겹쳐서 한쪽이 사라지는 문제가 안 생긴다
  const everyPeriod = text.match(/\bevery\s+(morning|afternoon|evening|night)\b/i);
  if (everyPeriod) {
    const periodWord = everyPeriod[1];
    const alreadyInTime = matchedTime && !!timeMatchText && new RegExp(`\\b${periodWord}\\b`, 'i').test(timeMatchText);
    const matchedText = alreadyInTime ? everyPeriod[0].slice(0, everyPeriod[0].length - periodWord.length) : everyPeriod[0];
    return { repeatType: 'daily', repeatDays: null, matched: true, matchedText, extraMatchedText: null };
  }

  const weekend = text.match(/\b(?:on\s+|every\s+)?weekends?\b/i);
  if (weekend) return { repeatType: 'weekend', repeatDays: null, matched: true, matchedText: weekend[0], extraMatchedText: null };

  // 2개 이상의 요일이 몰려있으면(예: "mon/wed/fri", "mondays and wednesdays") 목록으로
  // 먼저 확인한다 — 단일 요일 패턴("every monday")보다 먼저 봐야, "on mondays and
  // wednesdays"에서 "on mondays"만 먼저 매칭되고 "wednesdays"를 놓치는 일이 없다
  const listRe = new RegExp(`\\b(${DAY_TOKEN})s?\\b`, 'gi');
  const matches = [...text.matchAll(listRe)];
  if (matches.length >= 2) {
    let clusterStart = matches[0].index!;
    let clusterEnd = matches[0].index! + matches[0][0].length;
    let cluster = [matches[0]];
    let best: { cluster: RegExpMatchArray[]; start: number; end: number } | null = null;
    for (let i = 1; i < matches.length; i++) {
      const mm = matches[i];
      const gap = mm.index! - clusterEnd;
      if (gap <= 15) {
        cluster.push(mm);
        clusterEnd = mm.index! + mm[0].length;
      } else {
        if (cluster.length >= 2 && !best) best = { cluster, start: clusterStart, end: clusterEnd };
        cluster = [mm];
        clusterStart = mm.index!;
        clusterEnd = mm.index! + mm[0].length;
      }
    }
    if (cluster.length >= 2 && !best) best = { cluster, start: clusterStart, end: clusterEnd };

    if (best) {
      const days = [...new Set(best.cluster.map((mm) => normalizeDayToken(mm[1])))].sort();
      // "every"/"on"이 목록 바로 앞에 붙어있으면 같이 지운다(예: "every monday and wednesday")
      const prefixMatch = text.slice(Math.max(0, best.start - 6), best.start).match(/(every|on)\s+$/i);
      const start = prefixMatch ? best.start - prefixMatch[0].length : best.start;
      return { repeatType: 'custom', repeatDays: days, matched: true, matchedText: text.slice(start, best.end), extraMatchedText: null };
    }
  }

  const single = text.match(new RegExp(`\\b(?:every|on)\\s+(${DAY_TOKEN})s?\\b`, 'i'));
  if (single) {
    return { repeatType: 'custom', repeatDays: [normalizeDayToken(single[1])], matched: true, matchedText: single[0], extraMatchedText: null };
  }

  return { repeatType: 'once', repeatDays: null, matched: false, matchedText: null, extraMatchedText: null };
}

function parseRequired(text: string): { isRequired: boolean; matchedText: string | null } {
  const match = text.match(/\bmust\b|\brequired\b|\bmandatory\b|\bno matter what\b/i);
  return { isRequired: !!match, matchedText: match ? match[0] : null };
}

const TRACKING_UNITS = [
  'cups?', 'times?', 'reps?', 'pages?', 'km', 'minutes?', 'mins?',
  'hours?', 'hrs?', 'seconds?', 'secs?', 'laps?', 'glass(?:es)?', 'sets?', 'rounds?',
];

function parseTracking(text: string): { blockType: BlockType; trackingUnit: string | null; matchedText: string | null } {
  const unitPattern = TRACKING_UNITS.join('|');
  // 앞의 "for"(지속시간을 나타낼 때 흔히 붙음, "study for 30 minutes"), 뒤의 "of"("8 cups of
  // water")도 같이 지워야 제목에 어색한 조사성 잔여 단어가 안 남는다
  const match = text.match(new RegExp(`(?:for\\s+)?\\d+(?:\\.\\d+)?\\s*(${unitPattern})\\b(?:\\s+of\\b)?`, 'i'));
  if (match) return { blockType: 'tracking', trackingUnit: match[1].toLowerCase(), matchedText: match[0] };

  const countWord = text.match(/\bcount\b|\bhow many times\b|\bnumber of times\b/i);
  if (countWord) return { blockType: 'tracking', trackingUnit: 'times', matchedText: countWord[0] };

  return { blockType: 'check', trackingUnit: null, matchedText: null };
}

// 부정어(don't/not/never/no longer)는 절대 여기 넣지 않는다 — 지우면 문장의 뜻이 반전되는
// 가장 위험한 실수라, "제거할 필러워드"와는 원천적으로 분리해서 관리한다
const LEADING_FILLER_PREFIX =
  /^(?:please\s+)?(?:i(?:'m| am)?\s+(?:need|want|gonna|going to|have|should|got)\s*(?:to)?\s+|remind\s+me\s+to\s+|remember\s+to\s+|don'?t\s+forget\s+to\s+|add\s+(?:a\s+)?(?:routine|reminder)\s+(?:to|for|that)\s+|let'?s\s+|i'?ll\s+)/i;

const TRAILING_FILLER_SUFFIX = /\s*(?:,?\s*\b(?:please|ok|okay|thanks|thank you)\b)+[.!]?\s*$/i;

const GLOBAL_STRIP_WORDS =
  /\bevery\s*day\b|\beveryday\b|\bdaily\b|\bweekdays?\b|\bweekends?\b|\bmust\b|\brequired\b|\bmandatory\b|\btoday\b|\btomorrow\b|\ba\s+(?:day|week|month)\b/gi;

function buildTitle(text: string, matchedTexts: (string | null)[]): string {
  let title = text;
  for (const matched of matchedTexts) {
    if (!matched) continue;
    title = title.replace(matched, ' ');
  }
  title = title.replace(GLOBAL_STRIP_WORDS, ' ');
  title = title.replace(/\s+/g, ' ').trim();
  // 시각 표현만 지워지고 딸려온 전치사 "at"/"by"가 문장 맨 앞/뒤에 혼자 남는 경우 정리
  // ("go to bed by 11pm"에서 "11pm"만 지워지면 "by"가 외따로 남는 것 방지)
  title = title.replace(/\b(?:at|by)\s*$/i, '').replace(/^\s*(?:at|by)\b\s*/i, '').trim();

  let result = title;
  let prev: string;
  do {
    prev = result;
    result = result.replace(LEADING_FILLER_PREFIX, '').replace(TRAILING_FILLER_SUFFIX, '').trim();
  } while (result !== prev && result.length > 0);

  const cleaned = result || title || text.trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function parseRoutineInputEn(rawText: string): ParsedRoutineDraft {
  const text = normalizeAbbreviations(rawText);

  const { scheduledTime, matched: matchedTime, matchedText: timeMatch } = parseTime(text);
  const {
    repeatType,
    repeatDays,
    matched: matchedRepeat,
    matchedText: repeatMatch,
    extraMatchedText: repeatExtraMatch,
  } = parseRepeat(text, matchedTime, timeMatch);
  const { isRequired, matchedText: requiredMatch } = parseRequired(text);
  const { blockType, trackingUnit, matchedText: trackingMatch } = parseTracking(text);

  const needsLlmFallback = !matchedRepeat && !matchedTime && !isRequired && blockType === 'check';
  const title = buildTitle(text, [repeatMatch, repeatExtraMatch, timeMatch, requiredMatch, trackingMatch]);

  return {
    title,
    repeatType,
    repeatDays,
    scheduledTime,
    isRequired,
    blockType,
    trackingUnit,
    matchedRepeat,
    matchedTime,
    needsLlmFallback,
  };
}
