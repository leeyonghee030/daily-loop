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
