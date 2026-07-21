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

function parseRepeat(text: string): { repeatType: RepeatType; repeatDays: number[] | null; matched: boolean } {
  if (/매일/.test(text)) return { repeatType: 'daily', repeatDays: null, matched: true };
  if (/평일|주중/.test(text)) return { repeatType: 'weekday', repeatDays: null, matched: true };
  if (/주말/.test(text)) return { repeatType: 'weekend', repeatDays: null, matched: true };

  const weeklySingle = text.match(/매주\s*([월화수목금토일])요일/);
  if (weeklySingle) {
    return { repeatType: 'custom', repeatDays: [DAY_CHAR_TO_DOW[weeklySingle[1]]], matched: true };
  }

  const combo = text.match(/[월화수목금토일]{2,}/);
  if (combo) {
    const days = [...new Set(combo[0].split('').map((ch) => DAY_CHAR_TO_DOW[ch]))].sort();
    return { repeatType: 'custom', repeatDays: days, matched: true };
  }

  return { repeatType: 'once', repeatDays: null, matched: false };
}

function parseTime(text: string): { scheduledTime: string | null; matched: boolean } {
  const match = text.match(/(아침|오전|저녁|오후)?\s*(\d{1,2})(?:시|:)(?:\s*(\d{1,2})분?)?/);
  if (!match) return { scheduledTime: null, matched: false };

  const [, period, hourStr, minuteStr] = match;
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (hour > 23 || minute > 59) return { scheduledTime: null, matched: false };

  if ((period === '저녁' || period === '오후') && hour < 12) hour += 12;

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return { scheduledTime: `${hh}:${mm}`, matched: true };
}

function parseRequired(text: string): boolean {
  return /꼭|반드시|필수로|무조건/.test(text);
}

function parseTracking(text: string): { blockType: BlockType; trackingUnit: string | null } {
  const unitPattern = TRACKING_UNITS.join('|');
  const match = text.match(new RegExp(`\\d+(?:\\.\\d+)?\\s*(${unitPattern})`));
  if (match) return { blockType: 'tracking', trackingUnit: match[1] };
  return { blockType: 'check', trackingUnit: null };
}

export function parseRoutineInput(text: string): ParsedRoutineDraft {
  const { repeatType, repeatDays, matched: matchedRepeat } = parseRepeat(text);
  const { scheduledTime, matched: matchedTime } = parseTime(text);
  const isRequired = parseRequired(text);
  const { blockType, trackingUnit } = parseTracking(text);

  const needsLlmFallback = !matchedRepeat && !matchedTime && !isRequired && blockType === 'check';

  return {
    title: text.trim(),
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
