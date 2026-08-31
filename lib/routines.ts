import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

export type BlockType = 'check' | 'tracking';
export type RepeatType = 'daily' | 'weekday' | 'weekend' | 'custom' | 'once';
export type SlotType = 'morning' | 'lunch' | 'evening' | 'before_sleep';

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

export const SLOT_LABELS: Record<SlotType, string> = {
  morning: '아침',
  lunch: '점심',
  evening: '저녁',
  before_sleep: '자기전',
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
  if (todayDate < localDateOf(routine.created_at)) return false;
  // 삭제된 루틴은 삭제된 날짜부터(그날 포함) 예정에서 빠진다 — 삭제 전 과거 날짜의 캘린더/통계
  // 기록은 그대로 유지되어야 하므로, 삭제됐다고 전체 기간에서 통째로 빠지면 안 됨
  if (routine.deleted_at && todayDate >= localDateOf(routine.deleted_at)) return false;

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

  const [{ data: routines, error: routinesError }, holiday] = await Promise.all([
    supabase.from('routines').select('*, slots(*)').eq('user_id', userId).is('deleted_at', null),
    fetchTodayHoliday(),
  ]);

  if (routinesError) throw routinesError;

  const allIds = (routines ?? []).map((r) => r.id);

  // 건너뛴 날짜와 완료기록 둘 다 "전체 루틴 id" 기준으로만 필요해서(오늘 예정 여부 필터링 전),
  // 서로 의존관계가 없어 병렬로 같이 요청한다 — 예전엔 건너뛴 날짜부터 받아서 오늘 예정 목록을
  // 추린 뒤에야 완료기록을 요청해서 왕복이 하나 더 걸렸음(첫 로딩 체감 속도에 영향)
  const [{ data: skipRows, error: skipError }, { data: completionRows, error: completionsError }] =
    allIds.length > 0
      ? await Promise.all([
          supabase
            .from('routine_skip_dates')
            .select('routine_id')
            .eq('skip_date', todayDate)
            .in('routine_id', allIds),
          supabase.from('routine_completions').select('*').in('routine_id', allIds).eq('completed_date', todayDate),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
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
  existingCompletionId: string | null
): Promise<RoutineCompletion | null> {
  if (existingCompletionId) {
    const { error } = await supabase
      .from('routine_completions')
      .delete()
      .eq('id', existingCompletionId);
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from('routine_completions')
    .insert({ routine_id: routineId, completed_date: formatLocalDate(new Date()) })
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
  return data ?? [];
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

export type MonthData = {
  routines: Routine[];
  completionsByRoutine: Map<string, Map<string, RoutineCompletion>>;
  skipDatesByRoutine: Map<string, Set<string>>;
  holidayDates: Set<string>;
};

async function fetchRangeData(userId: string, rangeStart: string, rangeEnd: string): Promise<MonthData> {
  // 삭제된 루틴도 같이 가져온다 — 삭제 전 과거 날짜는 여전히 그 루틴이 예정돼 있었던 게 맞으므로.
  // matchesToday()가 deleted_at을 보고 날짜별로 알아서 걸러준다
  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*, slots(*)')
    .eq('user_id', userId);
  if (routinesError) throw routinesError;

  const ids = (routines ?? []).map((r) => r.id);
  const [{ data: completionRows, error: completionsError }, { data: skipRows, error: skipError }, { data: holidayRows, error: holidayError }] =
    await Promise.all([
      ids.length > 0
        ? supabase
            .from('routine_completions')
            .select('*')
            .in('routine_id', ids)
            .gte('completed_date', rangeStart)
            .lte('completed_date', rangeEnd)
        : Promise.resolve({ data: [], error: null }),
      ids.length > 0
        ? supabase
            .from('routine_skip_dates')
            .select('routine_id, skip_date')
            .in('routine_id', ids)
            .gte('skip_date', rangeStart)
            .lte('skip_date', rangeEnd)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('holidays').select('date').gte('date', rangeStart).lte('date', rangeEnd),
    ]);
  if (completionsError) throw completionsError;
  if (skipError) throw skipError;
  if (holidayError) throw holidayError;

  const completionsByRoutine = new Map<string, Map<string, RoutineCompletion>>();
  for (const row of completionRows ?? []) {
    if (!completionsByRoutine.has(row.routine_id)) completionsByRoutine.set(row.routine_id, new Map());
    completionsByRoutine.get(row.routine_id)!.set(row.completed_date, row);
  }
  const skipDatesByRoutine = new Map<string, Set<string>>();
  for (const row of skipRows ?? []) {
    if (!skipDatesByRoutine.has(row.routine_id)) skipDatesByRoutine.set(row.routine_id, new Set());
    skipDatesByRoutine.get(row.routine_id)!.add(row.skip_date);
  }
  const holidayDates = new Set((holidayRows ?? []).map((row) => row.date));

  return { routines: (routines ?? []) as Routine[], completionsByRoutine, skipDatesByRoutine, holidayDates };
}

export async function fetchMonthData(userId: string, year: number, month: number): Promise<MonthData> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = formatLocalDate(new Date(year, month, 0));
  return fetchRangeData(userId, monthStart, monthEnd);
}

// weekStartStr(일요일 등 주 시작일)부터 6일 뒤까지 한 주치 데이터
export async function fetchWeekData(userId: string, weekStartStr: string): Promise<MonthData> {
  const start = new Date(`${weekStartStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return fetchRangeData(userId, weekStartStr, formatLocalDate(end));
}

export function routinesForDate(dateStr: string, month: MonthData): DayRoutine[] {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  const isHoliday = month.holidayDates.has(dateStr);

  return sortRoutines(
    month.routines.filter((r) => {
      if (month.skipDatesByRoutine.get(r.id)?.has(dateStr)) return false;
      return matchesToday(r, dateStr, dow, isHoliday);
    })
  ).map((routine) => ({
    routine,
    completion: month.completionsByRoutine.get(routine.id)?.get(dateStr) ?? null,
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
  value: number
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

  const { data, error } = await supabase
    .from('routine_completions')
    .insert({
      routine_id: routineId,
      completed_date: formatLocalDate(new Date()),
      tracking_value: value,
    })
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

export async function fetchStats(userId: string): Promise<StatsSummary> {
  const todayDate = formatLocalDate(new Date());

  // 삭제된 루틴도 같이 가져온다 — 삭제 전 과거 날짜의 수행률/스트릭은 여전히 유효한 기록이므로.
  // matchesToday()가 deleted_at을 보고 날짜별로 알아서 걸러준다
  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*, slots(*)')
    .eq('user_id', userId);
  if (routinesError) throw routinesError;

  const all = (routines ?? []) as Routine[];
  const active = all.filter((r) => r.deleted_at === null);
  const ids = all.map((r) => r.id);

  const [
    { data: completionRows, error: completionsError },
    { data: skipRows, error: skipError },
    { data: holidayRows, error: holidayError },
  ] = await Promise.all([
    ids.length > 0
      ? supabase.from('routine_completions').select('routine_id, completed_date').in('routine_id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length > 0
      ? supabase.from('routine_skip_dates').select('routine_id, skip_date').in('routine_id', ids)
      : Promise.resolve({ data: [], error: null }),
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
    for (let i = 0; i < days; i++) {
      const cursor = new Date(`${todayDate}T00:00:00`);
      cursor.setDate(cursor.getDate() - i);
      const dateStr = formatLocalDate(cursor);
      const dow = cursor.getDay();
      const isHoliday = holidayDates.has(dateStr);
      for (const routine of visibleIncludingDeleted) {
        const skipDates = skipByRoutine.get(routine.id) ?? new Set();
        if (skipDates.has(dateStr)) continue;
        if (!matchesToday(routine, dateStr, dow, isHoliday)) continue;
        scheduled++;
        if (completedByRoutine.get(routine.id)?.has(dateStr)) completed++;
      }
    }
    return { scheduled, completed };
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
