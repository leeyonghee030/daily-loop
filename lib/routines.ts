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
  slots: Slot | null;
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
