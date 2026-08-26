import { supabase } from '@/lib/supabase';

export type Diary = {
  id: string;
  entry_date: string;
  content: string;
  updated_at: string;
};

export async function fetchDiary(userId: string, date: string): Promise<Diary | null> {
  const { data, error } = await supabase
    .from('diaries')
    .select('id, entry_date, content, updated_at')
    .eq('user_id', userId)
    .eq('entry_date', date)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveDiary(
  userId: string,
  date: string,
  content: string,
  existingId: string | null
): Promise<Diary> {
  if (existingId) {
    const { data, error } = await supabase
      .from('diaries')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', existingId)
      .select('id, entry_date, content, updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('diaries')
    .insert({ user_id: userId, entry_date: date, content })
    .select('id, entry_date, content, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDiary(diaryId: string): Promise<void> {
  const { error } = await supabase
    .from('diaries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', diaryId);
  if (error) throw error;
}

// 캘린더에 일기 쓴 날짜 표시용 — 그 범위 안에서 일기가 있는 날짜만 반환
export async function fetchDiaryDatesInRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('diaries')
    .select('entry_date')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate);
  if (error) throw error;
  return (data ?? []).map((d) => d.entry_date);
}
