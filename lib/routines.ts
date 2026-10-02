import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import type { TranslationKey } from '@/lib/language';
import { supabase } from '@/lib/supabase';

export type BlockType = 'check' | 'tracking';
export type RepeatType = 'daily' | 'weekday' | 'weekend' | 'custom' | 'once';
export type SlotType = 'morning' | 'lunch' | 'evening' | 'before_sleep';

// DB에는 slot_type 정렬 기준이 없어서 행 순서가 들쭉날쭉할 수 있음 — 화면에는 항상
// 아침→점심→저녁→자기전 순서로 보이도록 fetchSlots에서 이 순서로 정렬해서 내려준다
const SLOT_ORDER: SlotType[] = ['morning', 'lunch', 'evening', 'before_sleep'];

export type Slot = {
  id: string;
  slot_type: SlotType;
  start_time: string;
  end_time: string;
  notify_enabled: boolean;
  memo_notify_enabled: boolean;
  // true(기본값)면 설정 화면에 "정확히 이 시각" 하나만 보여줌(체크형), false면 몇시~몇시 범위로 보여줌
  is_instant: boolean;
};

export type Routine = {
  id: string;
  title: string;
  block_type: BlockType;
  repeat_type: RepeatType;
  repeat_days: number[] | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  is_instant: boolean;
  scheduled_date: string | null;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
  sort_order: number;
  skip_holidays: boolean;
  category_id: number | null;
  video_id: string | null;
  hide_from_stats: boolean;
  memo: string | null;
  photo_url: string | null;
  preset_id: string | null;
  is_paused: boolean;
  slots: Slot | null;
  preset: { name: string } | null;
  created_at: string;
  deleted_at: string | null;
  // "루틴 복구" 목록에서만 치웠는지 — deleted_at과 별개, 이게 있어도 캘린더/통계 기록은 그대로 유지됨
  archived_at: string | null;
};

export type Holiday = {
  date: string;
  name: string;
};

export type RoutineCompletion = {
  id: string;
  routine_id: string;
  completed_date: string;
  tracking_value: number | null;
};

export type StreakConfig = {
  min_days: number;
  max_days: number | null;
  emoji: string;
  label: string;
};

// 슬롯 선택 칩 등에서 "아침" 옆에 같이 보여줄 시각 — 체크형이면 한 시각만, 아니면 범위로
export function slotTimeLabel(slot: Slot): string {
  if (slot.is_instant) return slot.start_time.slice(0, 5);
  return `${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}`;
}

// 로컬 알림(lib/notifications.ts)처럼 t()를 쓸 수 없는 곳에서만 이 한국어 기본값을 그대로 쓴다 —
// 화면(컴포넌트) 쪽은 아래 SLOT_LABEL_KEYS + t()로 언어별 라벨을 가져온다
export const SLOT_LABELS: Record<SlotType, string> = {
  morning: '아침',
  lunch: '점심',
  evening: '저녁',
  before_sleep: '자기전',
};

export const SLOT_LABEL_KEYS: Record<SlotType, TranslationKey> = {
  morning: 'slot.morning',
  lunch: 'slot.lunch',
  evening: 'slot.evening',
  before_sleep: 'slot.beforeSleep',
};

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// created_at/deleted_at은 UTC로 저장돼 있어서 그냥 앞 10글자만 자르면(.slice(0, 10)) 한국 새벽
// 시간대(자정~오전 9시)에 생성/삭제한 경우 실제 로컬 날짜보다 하루 이른 날짜로 잘못 읽힌다
// (예: 로컬 8/28 새벽 3시 = UTC 8/27 18시). new Date로 파싱해서 로컬 기준으로 다시 계산해야 함
function localDateOf(isoTimestamp: string): string {
  return formatLocalDate(new Date(isoTimestamp));
}

// matchesToday()는 캘린더 월간뷰(달 하나에 최대 ~42일 × 표시 중인 달들)나 통계 화면(루틴당
// 전체 기간의 모든 날짜)처럼 "루틴 여러 개 × 날짜 여러 개"를 겹겹이 순회하는 곳에서 호출되는데,
// 그때마다 매번 같은 루틴의 created_at/deleted_at을 새로 Date로 파싱하고 있었다 — 이 값은 그
// 루틴이 안 바뀌는 한 날짜와 무관하게 항상 같은 결과라 순전히 낭비되는 반복 계산이었다.
// 캘린더에서 체크 한 번 할 때마다 이 파싱이 수천 번씩 다시 일어나 애니메이션/진동/체크 반영까지
// 같이 느려 보이던 원인이었다(2026-09-30) — 루틴 객체별로 한 번만 계산해서 재사용한다
const createdAtDateCache = new WeakMap<Routine, string>();
const deletedAtDateCache = new WeakMap<Routine, string>();

function cachedLocalDateOf(routine: Routine, field: 'created_at' | 'deleted_at'): string | null {
  const cache = field === 'created_at' ? createdAtDateCache : deletedAtDateCache;
  const cached = cache.get(routine);
  if (cached !== undefined) return cached;
  const raw = routine[field];
  if (!raw) return null;
  const result = localDateOf(raw);
  cache.set(routine, result);
  return result;
}

function matchesToday(
  routine: Routine,
  todayDate: string,
  todayDow: number,
  isHoliday: boolean
): boolean {
  if (routine.is_paused) return false;
  if (routine.skip_holidays && isHoliday) return false;
  // 이 루틴이 생기기 전 날짜는 예정될 수 없다 — 안 그러면 오늘 막 만든 루틴이 생성일보다
  // 훨씬 전(심하면 몇 달~몇 년 전) 과거 날짜에도 전부 예정됐던 것처럼 계산됨
  const createdDate = cachedLocalDateOf(routine, 'created_at');
  if (createdDate !== null && todayDate < createdDate) return false;
  // 삭제된 루틴은 삭제된 날짜부터(그날 포함) 예정에서 빠진다 — 삭제 전 과거 날짜의 캘린더/통계
  // 기록은 그대로 유지되어야 하므로, 삭제됐다고 전체 기간에서 통째로 빠지면 안 됨
  const deletedDate = routine.deleted_at ? cachedLocalDateOf(routine, 'deleted_at') : null;
  if (deletedDate !== null && todayDate >= deletedDate) return false;

  switch (routine.repeat_type) {
    case 'daily':
      return true;
    case 'weekday':
      return todayDow >= 1 && todayDow <= 5;
    case 'weekend':
      return todayDow === 0 || todayDow === 6;
    case 'custom':
      return (routine.repeat_days ?? []).includes(todayDow);
    case 'once':
      return routine.scheduled_date === todayDate;
  }
}

// 통계 화면의 평일/주말 카테고리 탭에서, 이 루틴이 그 카테고리에 해당하는지 판정.
// 매일(daily)은 둘 다 해당, 커스텀(custom)/1회성(once)은 실제 요일을 따져서 판정한다
export function routineMatchesDayCategory(routine: Routine, category: 'weekday' | 'weekend'): boolean {
  const targetDows = category === 'weekday' ? [1, 2, 3, 4, 5] : [0, 6];
  if (routine.repeat_type === 'daily') return true;
  if (routine.repeat_type === category) return true;
  if (routine.repeat_type === 'custom') return (routine.repeat_days ?? []).some((d) => targetDows.includes(d));
  if (routine.repeat_type === 'once' && routine.scheduled_date) {
    const dow = new Date(`${routine.scheduled_date}T00:00:00`).getDay();
    return targetDows.includes(dow);
  }
  return false;
}

export async function fetchTodayHoliday(): Promise<Holiday | null> {
  const todayDate = formatLocalDate(new Date());
  const { data, error } = await supabase
    .from('holidays')
    .select('date, name')
    .eq('date', todayDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function effectiveTime(routine: Routine): string {
  return routine.scheduled_time_start ?? routine.slots?.start_time ?? '99:99:99';
}

// 타임라인 뷰 등에서 재사용: 루틴의 시작/종료 시각(정확한 시각 없으면 슬롯 시간대)
export function effectiveTimeRange(routine: Routine): { start: string; end: string } | null {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return { start: routine.scheduled_time_start, end: routine.scheduled_time_end };
  }
  if (routine.slots) {
    return { start: routine.slots.start_time, end: routine.slots.end_time };
  }
  return null;
}

function sortRoutines(routines: Routine[]): Routine[] {
  return [...routines].sort((a, b) => {
    const ta = effectiveTime(a);
    const tb = effectiveTime(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

export async function fetchTodayRoutines(userId: string): Promise<{
  routines: Routine[];
  completions: RoutineCompletion[];
  holiday: Holiday | null;
}> {
  const today = new Date();
  const todayDate = formatLocalDate(today);
  const todayDow = today.getDay();

  // ⚠️ 예전엔 루틴 목록을 먼저 받아 그 id로 건너뛴날짜/완료기록을 .in(routine_id, ids)로
  // 필터링했는데(왕복 2번, 오늘 탭 첫 로딩에 그대로 영향), 그 필터는 RLS 정책(그 루틴이 내
  // 것인지 exists 서브쿼리로 확인)이 이미 걸러주고 있어서 불필요했다(2026-09-30, 캘린더
  // fetchRangeData/fetchStats와 같은 문제 — lib/routines.ts 상단 fetchRangeData 주석 참고).
  // 네 가지 전부 한 Promise.all로 병렬 요청한다
  const [
    { data: routines, error: routinesError },
    holiday,
    { data: skipRows, error: skipError },
    { data: completionRows, error: completionsError },
  ] = await Promise.all([
    supabase.from('routines').select('*, slots(*)').eq('user_id', userId).is('deleted_at', null),
    fetchTodayHoliday(),
    supabase.from('routine_skip_dates').select('routine_id').eq('skip_date', todayDate),
    supabase.from('routine_completions').select('*').eq('completed_date', todayDate),
  ]);
  if (routinesError) throw routinesError;
  if (skipError) throw skipError;
  if (completionsError) throw completionsError;
  const skippedIds = new Set((skipRows ?? []).map((row) => row.routine_id));

  const isHoliday = Boolean(holiday);
  const todays = sortRoutines(
    (routines ?? []).filter(
      (r) => !skippedIds.has(r.id) && matchesToday(r as Routine, todayDate, todayDow, isHoliday)
    )
  );

  const todayIdSet = new Set(todays.map((r) => r.id));
  const completions = (completionRows ?? []).filter((c) => todayIdSet.has(c.routine_id));

  return { routines: todays, completions, holiday };
}

// 사진일기의 "루틴 고르기"용 — fetchTodayRoutines와 로직은 같지만 실제 오늘이 아니라
// 임의의 날짜(dateStr) 기준으로 그날 예정이었던 루틴을 가져온다(과거 날짜의 일기도 작성 가능하므로)
export async function fetchRoutinesForDate(
  userId: string,
  dateStr: string
): Promise<{ routines: Routine[]; completions: RoutineCompletion[] }> {
  const dow = new Date(`${dateStr}T00:00:00`).getDay();

  // fetchTodayRoutines와 같은 이유로 병렬화 — 위 주석 참고
  const [
    { data: routines, error: routinesError },
    { data: holidayRow },
    { data: skipRows, error: skipError },
    { data: completionRows, error: completionsError },
  ] = await Promise.all([
    supabase.from('routines').select('*, slots(*)').eq('user_id', userId).is('deleted_at', null),
    supabase.from('holidays').select('date').eq('date', dateStr).maybeSingle(),
    supabase.from('routine_skip_dates').select('routine_id').eq('skip_date', dateStr),
    supabase.from('routine_completions').select('*').eq('completed_date', dateStr),
  ]);
  if (routinesError) throw routinesError;
  if (skipError) throw skipError;
  if (completionsError) throw completionsError;
  const skippedIds = new Set((skipRows ?? []).map((row) => row.routine_id));

  const isHoliday = Boolean(holidayRow);
  const matched = sortRoutines(
    (routines ?? []).filter((r) => !skippedIds.has(r.id) && matchesToday(r as Routine, dateStr, dow, isHoliday))
  );

  const matchedIdSet = new Set(matched.map((r) => r.id));
  const completions = (completionRows ?? []).filter((c) => matchedIdSet.has(c.routine_id));

  return { routines: matched, completions };
}

// "내 루틴" 전체보기 화면용 — 오늘 예정 여부와 무관하게 삭제되지 않은 루틴 전체.
// 시간순이 아니라 sort_order 기준(사용자가 직접 드래그로 바꾸는 순서)으로 정렬한다.
export async function fetchAllRoutines(userId: string): Promise<Routine[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*, slots(*), preset:routine_presets(name)')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error) throw error;
  return ((data ?? []) as Routine[]).sort((a, b) => a.sort_order - b.sort_order);
}

// 모음집(preset) 단위 일괄 액션 — 그 모음집에서 만들어진(=preset_id가 같은) 루틴 전체에 적용
export async function pauseRoutinesByPreset(presetId: string, paused: boolean): Promise<void> {
  const { error } = await supabase
    .from('routines')
    .update({ is_paused: paused })
    .eq('preset_id', presetId)
    .is('deleted_at', null);
  if (error) throw error;
}

// 모음집 자체를 삭제할 때 같이 호출 — 그 모음집으로 만들어진 루틴도 함께 삭제(완료 기록은 보존)
export async function softDeleteRoutinesByPreset(presetId: string): Promise<void> {
  const { error } = await supabase
    .from('routines')
    .update({ deleted_at: new Date().toISOString() })
    .eq('preset_id', presetId)
    .is('deleted_at', null);
  if (error) throw error;
}

// 드래그 정렬 결과 저장 — sort_order를 새 순서(0,1,2...)로 일괄 반영
export async function updateSortOrder(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) => supabase.from('routines').update({ sort_order: index }).eq('id', id))
  );
}

export async function skipRoutineToday(routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_skip_dates')
    .insert({ routine_id: routineId, skip_date: formatLocalDate(new Date()) });
  if (error) throw error;
}

// 오늘 탭에서 스와이프로 "오늘 삭제"(건너뛰기) 된 루틴 id 목록 — "내 루틴" 화면에서
// 오늘만 빠진 루틴을 표시하고 다시 되돌릴 수 있게 하기 위함. RLS가 본인 루틴으로 자동 스코프함
export async function fetchSkippedRoutineIds(date: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('routine_skip_dates').select('routine_id').eq('skip_date', date);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.routine_id));
}

// "오늘 삭제"(건너뛰기)를 되돌린다 — 반복 규칙 자체는 안 건드리고 그날 건너뛴 기록만 지운다
export async function unskipRoutine(routineId: string, date: string): Promise<void> {
  const { error } = await supabase
    .from('routine_skip_dates')
    .delete()
    .eq('routine_id', routineId)
    .eq('skip_date', date);
  if (error) throw error;
}

export async function fetchStreakConfigs(): Promise<StreakConfig[]> {
  const { data, error } = await supabase
    .from('streak_emoji_configs')
    .select('min_days, max_days, emoji, label')
    .order('min_days', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function emojiForStreak(days: number, configs: StreakConfig[]): string | null {
  const tier = configs.find((c) => days >= c.min_days && (c.max_days === null || days <= c.max_days));
  return tier?.emoji ?? null;
}

function computeStreakForRoutine(
  routine: Routine,
  todayDate: string,
  completedDates: Set<string>,
  skipDates: Set<string>,
  holidayDates: Set<string>
): number {
  let streak = 0;
  const cursor = new Date(`${todayDate}T00:00:00`);
  for (let i = 0; i < 400; i++) {
    const dateStr = formatLocalDate(cursor);
    const dow = cursor.getDay();
    const isHoliday = holidayDates.has(dateStr);
    const scheduled = !skipDates.has(dateStr) && matchesToday(routine, dateStr, dow, isHoliday);
    if (scheduled) {
      if (completedDates.has(dateStr)) {
        streak++;
      } else if (dateStr !== todayDate) {
        break;
      }
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function fetchStreaks(
  routines: Routine[],
  todayDate: string
): Promise<Record<string, number>> {
  const repeatables = routines.filter((r) => r.repeat_type !== 'once');
  if (repeatables.length === 0) return {};

  const ids = repeatables.map((r) => r.id);
  const [{ data: completionRows, error: completionsError }, { data: skipRows, error: skipError }, { data: holidayRows, error: holidayError }] =
    await Promise.all([
      supabase
        .from('routine_completions')
        .select('routine_id, completed_date')
        .in('routine_id', ids)
        .lte('completed_date', todayDate),
      supabase.from('routine_skip_dates').select('routine_id, skip_date').in('routine_id', ids),
      supabase.from('holidays').select('date'),
    ]);
  if (completionsError) throw completionsError;
  if (skipError) throw skipError;
  if (holidayError) throw holidayError;

  const completedByRoutine = new Map<string, Set<string>>();
  for (const row of completionRows ?? []) {
    if (!completedByRoutine.has(row.routine_id)) completedByRoutine.set(row.routine_id, new Set());
    completedByRoutine.get(row.routine_id)!.add(row.completed_date);
  }
  const skipByRoutine = new Map<string, Set<string>>();
  for (const row of skipRows ?? []) {
    if (!skipByRoutine.has(row.routine_id)) skipByRoutine.set(row.routine_id, new Set());
    skipByRoutine.get(row.routine_id)!.add(row.skip_date);
  }
  const holidayDates = new Set((holidayRows ?? []).map((row) => row.date));

  const result: Record<string, number> = {};
  for (const routine of repeatables) {
    result[routine.id] = computeStreakForRoutine(
      routine,
      todayDate,
      completedByRoutine.get(routine.id) ?? new Set(),
      skipByRoutine.get(routine.id) ?? new Set(),
      holidayDates
    );
  }
  return result;
}

export async function toggleCheckCompletion(
  routineId: string,
  existingCompletionId: string | null,
  // 캘린더에서 지난 날짜(깜빡하고 못 한 날)를 나중에 체크할 수 있게 날짜를 받는다 —
  // 안 넘기면(오늘 탭 등 기존 호출부) 그대로 오늘 날짜로 동작
  date: string = formatLocalDate(new Date())
): Promise<RoutineCompletion | null> {
  if (existingCompletionId) {
    // id가 아니라 (routine_id, completed_date)로 지운다 — 낙관적 업데이트 중엔 이 id가 서버가
    // 아직 안 준 임시값("optimistic-...")일 수 있어서, 그 값 그대로 id 컬럼(uuid)에 넣어
    // 삭제를 시도하면 형식 오류로 실패해 "체크가 안 풀리는" 버그로 이어졌다(2026-09-27, 일괄
    // 체크 후 빠르게 해제할 때 다발적으로 재현). (routine_id, completed_date)는 유니크 제약이라
    // 항상 최대 한 행만 가리키므로 실제 완료기록의 진짜 id를 몰라도 안전하게 지울 수 있다
    const { error } = await supabase
      .from('routine_completions')
      .delete()
      .eq('routine_id', routineId)
      .eq('completed_date', date);
    if (error) throw error;
    return null;
  }

  // 화면 갱신이 한 박자 늦게 보이는 동안(낙관적 업데이트가 렌더에 반영되기 전) 사용자가
  // "체크가 안 된 줄 알고" 같은 루틴을 다시 눌러서, 같은 (routine_id, completed_date)로
  // insert가 두 번 나가는 경우가 있었다 — 유니크 제약 위반으로 두 번째 요청이 실패해
  // "체크 처리에 실패했어요" 에러가 뜨던 버그(2026-09-28). insert 대신 upsert를 써서, 이미
  // 그 행이 있으면(방금 내 요청이든 다른 기기든) 에러 없이 있는 행을 그대로 반환하게 한다
  const { data, error } = await supabase
    .from('routine_completions')
    .upsert({ routine_id: routineId, completed_date: date }, { onConflict: 'routine_id,completed_date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export type RoutineInput = {
  title: string;
  block_type: BlockType;
  repeat_type: RepeatType;
  repeat_days: number[] | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  is_instant: boolean;
  scheduled_date: string | null;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
  skip_holidays: boolean;
  category_id: number | null;
  video_id: string | null;
  memo: string | null;
  photo_url: string | null;
};

export async function fetchSlots(userId: string): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('id, slot_type, start_time, end_time, notify_enabled, memo_notify_enabled, is_instant')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).slice().sort((a, b) => SLOT_ORDER.indexOf(a.slot_type) - SLOT_ORDER.indexOf(b.slot_type));
}

export async function updateSlot(
  slotId: string,
  input: {
    start_time: string;
    end_time: string;
    notify_enabled: boolean;
    memo_notify_enabled: boolean;
    is_instant: boolean;
  }
): Promise<Slot> {
  const { data, error } = await supabase
    .from('slots')
    .update(input)
    .eq('id', slotId)
    .select('id, slot_type, start_time, end_time, notify_enabled, memo_notify_enabled, is_instant')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchRoutineById(routineId: string): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .select('*, slots(*)')
    .eq('id', routineId)
    .single();
  if (error) throw error;
  return data;
}

// 루틴 사진 업로드 — localUri(expo-image-picker 결과)를 routine-photos 버킷의 내 폴더에 저장하고 공개 URL을 돌려줌
export async function uploadRoutinePhoto(userId: string, localUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('routine-photos')
    .upload(path, decode(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('routine-photos').getPublicUrl(path);
  return data.publicUrl;
}

export async function createRoutine(userId: string, input: RoutineInput): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .insert({ user_id: userId, ...input })
    .select('*, slots(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoutine(routineId: string, input: RoutineInput): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .update(input)
    .eq('id', routineId)
    .select('*, slots(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteRoutine(routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routines')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', routineId);
  if (error) throw error;
}

// "내 루틴"에서 여러 개 선택해서 한 번에 삭제할 때 사용
export async function softDeleteRoutines(routineIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('routines')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', routineIds);
  if (error) throw error;
}

// "루틴 복구" 화면용 — deleted_at이 있는(소프트 삭제된) 루틴만
export async function fetchDeletedRoutines(userId: string): Promise<Routine[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*, slots(*), preset:routine_presets(name)')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .is('archived_at', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// "루틴 복구" 목록에서만 치운다 — deleted_at/완료기록은 안 건드려서 캘린더·통계 기록은 그대로 유지됨.
// 완전삭제와 달리 데이터를 없애는 게 아니라 그냥 목록을 정리하는 용도라 되돌릴 수 없다는 경고가 필요 없음
export async function archiveRoutines(routineIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('routines')
    .update({ archived_at: new Date().toISOString() })
    .in('id', routineIds);
  if (error) throw error;
}

// 삭제돼 있던 기간(삭제일~복구 전날)을 "건너뛴 날짜"로 채워 넣는다 — 안 그러면 복구 직후
// matchesToday()가 그 기간도 "계속 살아있었는데 체크를 안 한 것"으로 계산해서 스트릭이 끊기고
// 전체 수행률이 떨어짐(기존에 있던 "특정 날짜 건너뛰기" 기능을 재사용)
async function backfillSkipDatesForGap(routineId: string, deletedAtISO: string): Promise<void> {
  const cursor = new Date(`${localDateOf(deletedAtISO)}T00:00:00`);
  const todayDate = new Date(`${formatLocalDate(new Date())}T00:00:00`);
  const rows: { routine_id: string; skip_date: string }[] = [];
  while (cursor < todayDate) {
    rows.push({ routine_id: routineId, skip_date: formatLocalDate(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('routine_skip_dates')
    .upsert(rows, { onConflict: 'routine_id,skip_date', ignoreDuplicates: true });
  if (error) throw error;
}

export async function restoreRoutine(routineId: string): Promise<void> {
  const { data: routine, error: fetchError } = await supabase
    .from('routines')
    .select('deleted_at')
    .eq('id', routineId)
    .single();
  if (fetchError) throw fetchError;
  if (routine.deleted_at) {
    await backfillSkipDatesForGap(routineId, routine.deleted_at);
  }

  const { error } = await supabase.from('routines').update({ deleted_at: null }).eq('id', routineId);
  if (error) throw error;
}

// 모음집을 통째로 복구할 때, 그 모음집으로 만들어진(소프트 삭제된) 루틴도 같이 되살림
export async function restoreRoutinesByPreset(presetId: string): Promise<void> {
  const { data: routines, error: fetchError } = await supabase
    .from('routines')
    .select('id, deleted_at')
    .eq('preset_id', presetId)
    .not('deleted_at', 'is', null);
  if (fetchError) throw fetchError;

  await Promise.all(
    (routines ?? []).map((r) => (r.deleted_at ? backfillSkipDatesForGap(r.id, r.deleted_at) : Promise.resolve()))
  );

  const { error } = await supabase
    .from('routines')
    .update({ deleted_at: null })
    .eq('preset_id', presetId)
    .not('deleted_at', 'is', null);
  if (error) throw error;
}

export type DayStatus = 'done' | 'partial' | 'missed_required';

export type DayRoutine = {
  routine: Routine;
  completion: RoutineCompletion | null;
};

// Map/Set이 아니라 일반 객체로 두는 이유: react-query의 오프라인 캐시(AsyncStorage)가
// JSON.stringify를 거치는데 Map/Set은 직렬화하면 빈 객체가 되어버려서 캘린더가 앱을 열 때마다
// 캐시 없이 매번 새로 불러와야 했음(2026-09-16). 일반 객체는 JSON으로 안전하게 오가므로
// 다른 화면처럼 마지막 값을 즉시 보여주고 뒤에서 조용히 갱신하는 캐시 재사용이 가능해짐.
export type MonthData = {
  routines: Routine[];
  completionsByRoutine: Record<string, Record<string, RoutineCompletion>>;
  skipDatesByRoutine: Record<string, Record<string, true>>;
  holidayDates: Record<string, true>;
};

// 캘린더 전용 — 삭제된 루틴도 같이 가져온다(삭제 전 과거 날짜는 여전히 그 루틴이 예정돼 있었던
// 게 맞으므로, matchesToday()가 deleted_at을 보고 날짜별로 알아서 걸러준다). 달이 바뀌어도
// 이 목록 자체는 거의 그대로라, calendar.tsx에서 한 번만 받아 세션 내내 재사용한다
export async function fetchAllRoutinesForCalendar(userId: string): Promise<Routine[]> {
  const { data, error } = await supabase.from('routines').select('*, slots(*)').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as Routine[];
}

// routines를 안 넘기면(예: notifications.ts처럼 세션 캐시가 없는 1회성 호출) 직접 받아온다 —
// calendar.tsx는 매번 fetchAllRoutinesForCalendar로 캐시된 목록을 넘겨서 이 fetch를 건너뛴다.
// ⚠️ 완료기록/건너뛴 날짜 조회는 원래 routine id 목록(ids)으로 .in() 필터를 걸었는데, 사실 이
// 필터가 없어도 RLS 정책(그 루틴이 내 것인지 exists 서브쿼리로 확인)이 이미 내 것만 돌려주므로
// 불필요한 조건이었다 — 그런데도 이 ids를 만들려고 "루틴 목록이 다 올 때까지" 기다린 뒤에야
// 완료기록/건너뛴 날짜/공휴일을 순차로 받아오고 있어서, 캘린더 첫 진입이 왕복 2번(약 2초)
// 걸렸다(2026-09-30). ids 필터를 없애고 네 가지(루틴/완료기록/건너뛴 날짜/공휴일)를 전부 한
// Promise.all로 동시에 요청하도록 바꿔서 왕복 1번 수준으로 단축한다
async function fetchRangeData(userId: string, rangeStart: string, rangeEnd: string, routines?: Routine[]): Promise<MonthData> {
  const [resolvedRoutines, { data: completionRows, error: completionsError }, { data: skipRows, error: skipError }, { data: holidayRows, error: holidayError }] =
    await Promise.all([
      routines ? Promise.resolve(routines) : fetchAllRoutinesForCalendar(userId),
      supabase
        .from('routine_completions')
        .select('*')
        .gte('completed_date', rangeStart)
        .lte('completed_date', rangeEnd),
      supabase
        .from('routine_skip_dates')
        .select('routine_id, skip_date')
        .gte('skip_date', rangeStart)
        .lte('skip_date', rangeEnd),
      supabase
        .from('holidays')
        .select('date')
        .gte('date', rangeStart)
        .lte('date', rangeEnd),
    ]);
  if (completionsError) throw completionsError;
  if (skipError) throw skipError;
  if (holidayError) throw holidayError;

  const completionsByRoutine: Record<string, Record<string, RoutineCompletion>> = {};
  for (const row of completionRows ?? []) {
    (completionsByRoutine[row.routine_id] ??= {})[row.completed_date] = row;
  }
  const skipDatesByRoutine: Record<string, Record<string, true>> = {};
  for (const row of skipRows ?? []) {
    (skipDatesByRoutine[row.routine_id] ??= {})[row.skip_date] = true;
  }
  const holidayDates: Record<string, true> = {};
  for (const row of holidayRows ?? []) holidayDates[row.date] = true;

  return { routines: resolvedRoutines, completionsByRoutine, skipDatesByRoutine, holidayDates };
}

export async function fetchMonthData(userId: string, year: number, month: number, routines?: Routine[]): Promise<MonthData> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = formatLocalDate(new Date(year, month, 0));
  return fetchRangeData(userId, monthStart, monthEnd, routines);
}

// weekStartStr(일요일 등 주 시작일)부터 6일 뒤까지 한 주치 데이터
export async function fetchWeekData(userId: string, weekStartStr: string, routines?: Routine[]): Promise<MonthData> {
  const start = new Date(`${weekStartStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return fetchRangeData(userId, weekStartStr, formatLocalDate(end), routines);
}

// 캘린더 월간뷰는 체크 한 번에 날짜 ~126개(현재±1개월)치를 이 함수로 다시 계산하는데, 그중
// "이 날짜에 어떤 루틴이 예정돼 있나"(필터+정렬)는 완료기록(체크)과는 완전히 무관한 계산이다 —
// 체크를 해도 그 루틴이 그 날짜에 예정돼 있다는 사실 자체는 안 바뀌니까. 그런데도 체크할 때마다
// 매번 다시 필터링+정렬하고 있었다(2026-09-30) — monthAccum은 체크 시 completionsByRoutine만
// 새 참조로 바뀌고 routines/skipDatesByRoutine/holidayDates는 그대로 같은 참조를 유지하므로,
// 이 세 값이 안 바뀐 동안은 날짜별 "예정된 루틴 목록"을 캐시해서 재사용하고, 완료기록만 그 위에
// 매번 새로 얹는다(완료기록 조회는 단순 객체 조회라 원래도 저렴함)
let scheduleCache: {
  routines: Routine[];
  skipDatesByRoutine: MonthData['skipDatesByRoutine'];
  holidayDates: MonthData['holidayDates'];
  byDate: Map<string, Routine[]>;
} | null = null;

function scheduledRoutinesForDate(dateStr: string, month: MonthData): Routine[] {
  if (
    !scheduleCache ||
    scheduleCache.routines !== month.routines ||
    scheduleCache.skipDatesByRoutine !== month.skipDatesByRoutine ||
    scheduleCache.holidayDates !== month.holidayDates
  ) {
    scheduleCache = {
      routines: month.routines,
      skipDatesByRoutine: month.skipDatesByRoutine,
      holidayDates: month.holidayDates,
      byDate: new Map(),
    };
  }
  const cached = scheduleCache.byDate.get(dateStr);
  if (cached) return cached;

  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  const isHoliday = !!month.holidayDates[dateStr];
  const scheduled = sortRoutines(
    month.routines.filter((r) => {
      if (month.skipDatesByRoutine[r.id]?.[dateStr]) return false;
      return matchesToday(r, dateStr, dow, isHoliday);
    })
  );
  scheduleCache.byDate.set(dateStr, scheduled);
  return scheduled;
}

export function routinesForDate(dateStr: string, month: MonthData): DayRoutine[] {
  return scheduledRoutinesForDate(dateStr, month).map((routine) => ({
    routine,
    completion: month.completionsByRoutine[routine.id]?.[dateStr] ?? null,
  }));
}

export function computeDayStatus(dateStr: string, month: MonthData): DayStatus | null {
  const scheduled = routinesForDate(dateStr, month);
  if (scheduled.length === 0) return null;

  const missedRequired = scheduled.some((s) => s.routine.is_required && !s.completion);
  if (missedRequired) return 'missed_required';

  const allDone = scheduled.every((s) => s.completion !== null);
  return allDone ? 'done' : 'partial';
}

export async function saveTrackingValue(
  routineId: string,
  existingCompletionId: string | null,
  value: number,
  // toggleCheckCompletion과 동일 — 캘린더에서 지난 날짜 기록을 넣을 수 있게 날짜를 받는다
  date: string = formatLocalDate(new Date())
): Promise<RoutineCompletion> {
  if (existingCompletionId) {
    const { data, error } = await supabase
      .from('routine_completions')
      .update({ tracking_value: value })
      .eq('id', existingCompletionId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // toggleCheckCompletion과 같은 이유(위 주석 참고)로 insert 대신 upsert — 중복 저장 시도가
  // 유니크 제약 위반으로 실패하는 대신, 있는 행의 값을 최신 값으로 갱신한다
  const { data, error } = await supabase
    .from('routine_completions')
    .upsert(
      { routine_id: routineId, completed_date: date, tracking_value: value },
      { onConflict: 'routine_id,completed_date' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export type RoutineStats = {
  routine: Routine;
  currentStreak: number;
  bestStreak: number;
  scheduledCount: number;
  completedCount: number;
};

export type PeriodSummary = {
  scheduled: number;
  completed: number;
  weekday: { scheduled: number; completed: number };
  weekend: { scheduled: number; completed: number };
};

export type StatsSummary = {
  weekly: PeriodSummary;
  monthly: PeriodSummary;
  routines: RoutineStats[];
  hiddenRoutines: RoutineStats[];
  // 지금까지 있었던 모든 루틴(삭제된 것 포함) 통틀어 가장 길었던 스트릭 하나 — 루틴을 지워도
  // 이 기록 자체는 안 사라지게, 최고기록처럼 남겨둔다(나중에 캘린더 등에서 노출 예정)
  bestStreakEver: number;
};

function computeLifetimeStats(
  routine: Routine,
  createdDate: string,
  todayDate: string,
  completedDates: Set<string>,
  skipDates: Set<string>,
  holidayDates: Set<string>
): { bestStreak: number; scheduledCount: number; completedCount: number } {
  let running = 0;
  let best = 0;
  let scheduledCount = 0;
  let completedCount = 0;
  const cursor = new Date(`${createdDate}T00:00:00`);
  const end = new Date(`${todayDate}T00:00:00`);
  while (cursor <= end) {
    const dateStr = formatLocalDate(cursor);
    const dow = cursor.getDay();
    const isHoliday = holidayDates.has(dateStr);
    const scheduled = !skipDates.has(dateStr) && matchesToday(routine, dateStr, dow, isHoliday);
    if (scheduled) {
      scheduledCount++;
      if (completedDates.has(dateStr)) {
        completedCount++;
        running++;
        if (running > best) best = running;
      } else {
        running = 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { bestStreak: best, scheduledCount, completedCount };
}

// ⚠️ fetchRangeData와 같은 이유(2026-09-30, lib/routines.ts 상단 fetchRangeData 주석 참고)로
// 여기도 "루틴 목록부터 다 받고 나서 그 id로 완료기록/건너뛴날짜를 필터링" 순서였는데, 그
// .in(routine_id, ids) 필터는 RLS가 이미 알아서 걸러줘서 불필요했다 — 통계 탭/스트릭 배지가
// 캘린더와 동시에 로딩될 때 이 순차 대기가 전체 체감 로딩을 같이 늘리고 있었다. 네 가지를
// 전부 한 Promise.all로 병렬 요청하도록 바꾼다
export async function fetchStats(userId: string): Promise<StatsSummary> {
  const todayDate = formatLocalDate(new Date());

  // 삭제된 루틴도 같이 가져온다 — 삭제 전 과거 날짜의 수행률/스트릭은 여전히 유효한 기록이므로.
  // matchesToday()가 deleted_at을 보고 날짜별로 알아서 걸러준다
  const [
    { data: routines, error: routinesError },
    { data: completionRows, error: completionsError },
    { data: skipRows, error: skipError },
    { data: holidayRows, error: holidayError },
  ] = await Promise.all([
    supabase.from('routines').select('*, slots(*)').eq('user_id', userId),
    supabase.from('routine_completions').select('routine_id, completed_date'),
    supabase.from('routine_skip_dates').select('routine_id, skip_date'),
    supabase.from('holidays').select('date'),
  ]);
  if (routinesError) throw routinesError;
  if (completionsError) throw completionsError;
  if (skipError) throw skipError;
  if (holidayError) throw holidayError;

  const all = (routines ?? []) as Routine[];
  const active = all.filter((r) => r.deleted_at === null);

  const completedByRoutine = new Map<string, Set<string>>();
  for (const row of completionRows ?? []) {
    if (!completedByRoutine.has(row.routine_id)) completedByRoutine.set(row.routine_id, new Set());
    completedByRoutine.get(row.routine_id)!.add(row.completed_date);
  }
  const skipByRoutine = new Map<string, Set<string>>();
  for (const row of skipRows ?? []) {
    if (!skipByRoutine.has(row.routine_id)) skipByRoutine.set(row.routine_id, new Set());
    skipByRoutine.get(row.routine_id)!.add(row.skip_date);
  }
  const holidayDates = new Set((holidayRows ?? []).map((row) => row.date));

  function buildRoutineStats(routine: Routine): RoutineStats {
    const completedDates = completedByRoutine.get(routine.id) ?? new Set();
    const skipDates = skipByRoutine.get(routine.id) ?? new Set();
    const createdDate = localDateOf(routine.created_at);
    const { bestStreak, scheduledCount, completedCount } = computeLifetimeStats(
      routine,
      createdDate,
      todayDate,
      completedDates,
      skipDates,
      holidayDates
    );
    const currentStreak = computeStreakForRoutine(routine, todayDate, completedDates, skipDates, holidayDates);
    return { routine, currentStreak, bestStreak, scheduledCount, completedCount };
  }

  // 루틴별 카드는 지금 살아있는 루틴만(삭제된 건 더 이상 손댈 수 없으니 카드로 안 보여줌).
  // 대신 아래 전체 요약(이번주/이번달)엔 최근 삭제된 루틴도 삭제 전 날짜까지는 포함시킨다
  const visible = active.filter((r) => !r.hide_from_stats);
  const hidden = active.filter((r) => r.hide_from_stats);
  const visibleIncludingDeleted = all.filter((r) => !r.hide_from_stats);
  const routineStats = visible.map(buildRoutineStats);
  const hiddenRoutineStats = hidden.map(buildRoutineStats);
  // 삭제된 루틴은 카드로는 안 보여주지만, 그 루틴이 세운 최고 스트릭은 전체 역대 기록 계산에 포함한다
  const deletedStats = all.filter((r) => r.deleted_at !== null).map(buildRoutineStats);
  const bestStreakEver = [...routineStats, ...hiddenRoutineStats, ...deletedStats].reduce(
    (max, s) => Math.max(max, s.bestStreak),
    0
  );

  function computePeriodSummary(days: number): PeriodSummary {
    let scheduled = 0;
    let completed = 0;
    const weekday = { scheduled: 0, completed: 0 };
    const weekend = { scheduled: 0, completed: 0 };
    for (let i = 0; i < days; i++) {
      const cursor = new Date(`${todayDate}T00:00:00`);
      cursor.setDate(cursor.getDate() - i);
      const dateStr = formatLocalDate(cursor);
      const dow = cursor.getDay();
      const isHoliday = holidayDates.has(dateStr);
      const bucket = dow === 0 || dow === 6 ? weekend : weekday;
      for (const routine of visibleIncludingDeleted) {
        const skipDates = skipByRoutine.get(routine.id) ?? new Set();
        if (skipDates.has(dateStr)) continue;
        if (!matchesToday(routine, dateStr, dow, isHoliday)) continue;
        const isCompleted = completedByRoutine.get(routine.id)?.has(dateStr) ?? false;
        scheduled++;
        bucket.scheduled++;
        if (isCompleted) {
          completed++;
          bucket.completed++;
        }
      }
    }
    return { scheduled, completed, weekday, weekend };
  }

  return {
    weekly: computePeriodSummary(7),
    monthly: computePeriodSummary(30),
    routines: routineStats,
    hiddenRoutines: hiddenRoutineStats,
    bestStreakEver,
  };
}

export async function setHideFromStats(routineId: string, hide: boolean): Promise<void> {
  const { error } = await supabase.from('routines').update({ hide_from_stats: hide }).eq('id', routineId);
  if (error) throw error;
}
