import { supabase } from '@/lib/supabase';

export type BlockType = 'check' | 'tracking';
export type RepeatType = 'daily' | 'weekday' | 'weekend' | 'custom' | 'once';
export type SlotType = 'morning' | 'lunch' | 'evening' | 'before_sleep';

export type Slot = {
  id: string;
  slot_type: SlotType;
  start_time: string;
  end_time: string;
};

export type Routine = {
  id: string;
  title: string;
  block_type: BlockType;
  repeat_type: RepeatType;
  repeat_days: number[] | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  scheduled_date: string | null;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
  sort_order: number;
  skip_holidays: boolean;
  category_id: number | null;
  video_id: string | null;
  slots: Slot | null;
  created_at: string;
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

function matchesToday(
  routine: Routine,
  todayDate: string,
  todayDow: number,
  isHoliday: boolean
): boolean {
  if (routine.skip_holidays && isHoliday) return false;

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

export function isHappeningNow(routine: Routine): boolean {
  if (!routine.scheduled_time_start || !routine.scheduled_time_end) return false;
  const nowTime = formatLocalTime(new Date());
  return nowTime >= routine.scheduled_time_start && nowTime < routine.scheduled_time_end;
}

function formatLocalTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
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
  const { data: skipRows, error: skipError } =
    allIds.length > 0
      ? await supabase
          .from('routine_skip_dates')
          .select('routine_id')
          .eq('skip_date', todayDate)
          .in('routine_id', allIds)
      : { data: [], error: null };
  if (skipError) throw skipError;
  const skippedIds = new Set((skipRows ?? []).map((row) => row.routine_id));

  const isHoliday = Boolean(holiday);
  const todays = sortRoutines(
    (routines ?? []).filter(
      (r) => !skippedIds.has(r.id) && matchesToday(r as Routine, todayDate, todayDow, isHoliday)
    )
  );

  const ids = todays.map((r) => r.id);
  if (ids.length === 0) {
    return { routines: todays, completions: [], holiday };
  }

  const { data: completions, error: completionsError } = await supabase
    .from('routine_completions')
    .select('*')
    .in('routine_id', ids)
    .eq('completed_date', todayDate);

  if (completionsError) throw completionsError;

  return { routines: todays, completions: completions ?? [], holiday };
}

export async function skipRoutineToday(routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_skip_dates')
    .insert({ routine_id: routineId, skip_date: formatLocalDate(new Date()) });
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
  scheduled_date: string | null;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
  skip_holidays: boolean;
  category_id: number | null;
  video_id: string | null;
};

export async function fetchSlots(userId: string): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('id, slot_type, start_time, end_time')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
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

export async function fetchMonthData(
  userId: string,
  year: number,
  month: number
): Promise<MonthData> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = formatLocalDate(monthEndDate);

  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*, slots(*)')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (routinesError) throw routinesError;

  const ids = (routines ?? []).map((r) => r.id);
  const [{ data: completionRows, error: completionsError }, { data: skipRows, error: skipError }, { data: holidayRows, error: holidayError }] =
    await Promise.all([
      ids.length > 0
        ? supabase
            .from('routine_completions')
            .select('*')
            .in('routine_id', ids)
            .gte('completed_date', monthStart)
            .lte('completed_date', monthEnd)
        : Promise.resolve({ data: [], error: null }),
      ids.length > 0
        ? supabase
            .from('routine_skip_dates')
            .select('routine_id, skip_date')
            .in('routine_id', ids)
            .gte('skip_date', monthStart)
            .lte('skip_date', monthEnd)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('holidays').select('date').gte('date', monthStart).lte('date', monthEnd),
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

export type StatsSummary = {
  recentScheduled: number;
  recentCompleted: number;
  routines: RoutineStats[];
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

  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*, slots(*)')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (routinesError) throw routinesError;

  const active = (routines ?? []) as Routine[];
  const ids = active.map((r) => r.id);

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

  const routineStats: RoutineStats[] = active.map((routine) => {
    const completedDates = completedByRoutine.get(routine.id) ?? new Set();
    const skipDates = skipByRoutine.get(routine.id) ?? new Set();
    const createdDate = routine.created_at.slice(0, 10);
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
  });

  let recentScheduled = 0;
  let recentCompleted = 0;
  for (let i = 0; i < 7; i++) {
    const cursor = new Date(`${todayDate}T00:00:00`);
    cursor.setDate(cursor.getDate() - i);
    const dateStr = formatLocalDate(cursor);
    const dow = cursor.getDay();
    const isHoliday = holidayDates.has(dateStr);
    for (const routine of active) {
      const skipDates = skipByRoutine.get(routine.id) ?? new Set();
      if (skipDates.has(dateStr)) continue;
      if (!matchesToday(routine, dateStr, dow, isHoliday)) continue;
      recentScheduled++;
      if (completedByRoutine.get(routine.id)?.has(dateStr)) recentCompleted++;
    }
  }

  return { recentScheduled, recentCompleted, routines: routineStats };
}
