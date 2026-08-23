import type { BlockType, RepeatType } from '@/lib/routines';

export type ParsedRoutineDraft = {
  title: string;
  repeatType: RepeatType;
  repeatDays: number[] | null;
  scheduledTime: string | null;
  isRequired: boolean;
  blockType: BlockType;
  trackingUnit: string | null;
  matchedRepeat: boolean;
  matchedTime: boolean;
  needsLlmFallback: boolean;
};

const DAY_CHAR_TO_DOW: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

const TRACKING_UNITS = ['잔', '개', '페이지', '권', '회', 'km', '분', '시간', '초', '장', '바퀴'];

// 제목 정제 시 걸러낼, 매칭 표현을 지우고 나면 홀로 남는 조사/부사 토큰
const TITLE_STOPWORDS = new Set([
  '에', '에는', '마다', '로', '으로', '부터', '까지', '에서', '씩', '좀', '만',
  '오늘', '내일', '모레', '어제',
]);

// 문장 끝에 붙는 "앱한테 시키는 말"(루틴 내용이 아니라 추가 동작 자체, + 하기/해서 등 어미) — 제목에서 제외
const META_COMMAND_SUFFIX =
  /(추가|등록|저장|만들어|넣어)(해줘|해주세요|할래|하기|해서|하고|해줄래|한다|했다)?\s*$/;

// 문장 끝에 붙는 "~해야 하는 거/할래/하고싶어" 같은 의도 표현 — 루틴 내용이 아니라 말투라 제목에서 제외
const INTENT_FILLER_SUFFIX =
  /(가야되는거|가야하는거|가야할거|해야되는거|해야하는거|해야할거|하는거|할거|해야지|하고싶어|하고싶다|할래|해볼까|할까|가서)\s*$/;

// 문장 끝의 "확인/체크"(+ 하기/해서 등 어미) — 이 앱은 루틴 자체가 확인·체크하는 기능이라 군더더기로 본다
const CHECK_VERB_SUFFIX = /(확인|체크)(하기|해서|하고|하며|하자|할래|해줘|해주세요|해줄래|한다|했다)?\s*$/;

const TITLE_TRAILING_FILLERS = [META_COMMAND_SUFFIX, INTENT_FILLER_SUFFIX, CHECK_VERB_SUFFIX];

function parseRepeat(
  text: string
): { repeatType: RepeatType; repeatDays: number[] | null; matched: boolean; matchedText: string | null } {
  const daily = text.match(/매일|항상/);
  if (daily) return { repeatType: 'daily', repeatDays: null, matched: true, matchedText: daily[0] };

  const weekday = text.match(/평일|주중/);
  if (weekday) return { repeatType: 'weekday', repeatDays: null, matched: true, matchedText: weekday[0] };

  const weekend = text.match(/주말/);
  if (weekend) return { repeatType: 'weekend', repeatDays: null, matched: true, matchedText: weekend[0] };

  const weeklySingle = text.match(/매주\s*([월화수목금토일])요일/);
  if (weeklySingle) {
    return {
      repeatType: 'custom',
      repeatDays: [DAY_CHAR_TO_DOW[weeklySingle[1]]],
      matched: true,
      matchedText: weeklySingle[0],
    };
  }

  const combo = text.match(/[월화수목금토일]{2,}/);
  if (combo) {
    const days = [...new Set(combo[0].split('').map((ch) => DAY_CHAR_TO_DOW[ch]))].sort();
    return { repeatType: 'custom', repeatDays: days, matched: true, matchedText: combo[0] };
  }

  return { repeatType: 'once', repeatDays: null, matched: false, matchedText: null };
}

function parseTime(text: string): { scheduledTime: string | null; matched: boolean; matchedText: string | null } {
  const noon = text.match(/정오|한낮/);
  if (noon) return { scheduledTime: '12:00', matched: true, matchedText: noon[0] };

  const midnight = text.match(/자정|한밤중/);
  if (midnight) return { scheduledTime: '00:00', matched: true, matchedText: midnight[0] };

  const match = text.match(/(아침|오전|새벽|저녁|오후|밤)?\s*(\d{1,2})(?:시|:)(?:\s*(\d{1,2})분?)?/);
  if (!match) return { scheduledTime: null, matched: false, matchedText: null };

  const [, period, hourStr, minuteStr] = match;
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (hour > 23 || minute > 59) return { scheduledTime: null, matched: false, matchedText: null };

  if ((period === '저녁' || period === '오후' || period === '밤') && hour < 12) hour += 12;

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return { scheduledTime: `${hh}:${mm}`, matched: true, matchedText: match[0] };
}

function parseRequired(text: string): { isRequired: boolean; matchedText: string | null } {
  const match = text.match(/꼭|반드시|필수로|무조건/);
  return { isRequired: !!match, matchedText: match ? match[0] : null };
}

function parseTracking(
  text: string
): { blockType: BlockType; trackingUnit: string | null; matchedText: string | null } {
  const unitPattern = TRACKING_UNITS.join('|');
  const match = text.match(new RegExp(`\\d+(?:\\.\\d+)?\\s*(${unitPattern})`));
  if (match) return { blockType: 'tracking', trackingUnit: match[1], matchedText: match[0] };

  const countWord = text.match(/갯수|개수|횟수|몇\s*(번|개|회|차례)/);
  if (countWord) return { blockType: 'tracking', trackingUnit: '회', matchedText: countWord[0] };

  return { blockType: 'check', trackingUnit: null, matchedText: null };
}

// 같은 표현이 문장에 중복으로 들어가면(예: "항상 매일") 처음 매칭된 것 하나만 지워지므로,
// 반복/필수/트래킹 키워드는 몇 번 나오든 전부 지운다
const GLOBAL_STRIP_WORDS =
  /매일|항상|평일|주중|주말|꼭|반드시|필수로|무조건|갯수|개수|횟수|했는지|하는지|했나|했는가|한지/g;

// 매칭에 쓰인 표현(반복/시간/필수/트래킹)을 원문에서 지우고, 남은 조사만 정리해 제목을 만든다.
function buildTitle(text: string, matchedTexts: (string | null)[]): string {
  let title = text;
  for (const matched of matchedTexts) {
    if (!matched) continue;
    title = title.replace(matched, ' ');
  }
  title = title.replace(GLOBAL_STRIP_WORDS, ' ');

  const cleaned = title
    .split(/\s+/)
    .filter((token) => token.length > 0 && !TITLE_STOPWORDS.has(token))
    .join(' ')
    .trim();

  // 꼬리표가 겹쳐 붙어있을 수 있어(예: "가야되는거 추가해줘") 더 이상 안 줄어들 때까지 반복해서 벗겨낸다.
  let result = cleaned;
  let prev: string;
  do {
    prev = result;
    for (const pattern of TITLE_TRAILING_FILLERS) {
      result = result.replace(pattern, '').trim();
    }
  } while (result !== prev && result.length > 0);

  return result || cleaned || text.trim();
}

export function parseRoutineInput(text: string): ParsedRoutineDraft {
  const { repeatType, repeatDays, matched: matchedRepeat, matchedText: repeatMatch } = parseRepeat(text);
  const { scheduledTime, matched: matchedTime, matchedText: timeMatch } = parseTime(text);
  const { isRequired, matchedText: requiredMatch } = parseRequired(text);
  const { blockType, trackingUnit, matchedText: trackingMatch } = parseTracking(text);

  const needsLlmFallback = !matchedRepeat && !matchedTime && !isRequired && blockType === 'check';
  const title = buildTitle(text, [repeatMatch, timeMatch, requiredMatch, trackingMatch]);

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
