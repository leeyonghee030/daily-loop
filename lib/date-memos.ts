import { supabase } from '@/lib/supabase';

export type MemoColor = 'yellow' | 'red' | 'mint' | 'blue' | 'purple';

export const MEMO_COLOR_ORDER: MemoColor[] = ['yellow', 'red', 'mint', 'blue', 'purple'];

export const MEMO_COLORS: Record<MemoColor, { bg: string; border: string; label: string }> = {
  yellow: { bg: 'rgba(255, 214, 92, 0.45)', border: '#F5C518', label: '노랑' },
  red: { bg: 'rgba(255, 138, 128, 0.45)', border: '#FF6B6B', label: '빨강' },
  mint: { bg: 'rgba(112, 214, 190, 0.45)', border: '#3FBF9F', label: '민트' },
  blue: { bg: 'rgba(130, 177, 255, 0.45)', border: '#5B8DEF', label: '파랑' },
  purple: { bg: 'rgba(196, 168, 255, 0.45)', border: '#9B7BEF', label: '보라' },
};

export type DateMemo = {
  id: string;
  memo_date: string;
  content: string;
  color: MemoColor;
};

export async function fetchMemosInRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<DateMemo[]> {
  const { data, error } = await supabase
    .from('date_memos')
    .select('id, memo_date, content, color')
    .eq('user_id', userId)
    .gte('memo_date', startDate)
    .lte('memo_date', endDate)
    .order('memo_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createMemo(
  userId: string,
  date: string,
  content: string,
  color: MemoColor
): Promise<DateMemo> {
  const { data, error } = await supabase
    .from('date_memos')
    .insert({ user_id: userId, memo_date: date, content, color })
    .select('id, memo_date, content, color')
    .single();
  if (error) throw error;
  return data;
}

export async function updateMemo(memoId: string, content: string, color: MemoColor): Promise<DateMemo> {
  const { data, error } = await supabase
    .from('date_memos')
    .update({ content, color })
    .eq('id', memoId)
    .select('id, memo_date, content, color')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMemo(memoId: string): Promise<void> {
  const { error } = await supabase.from('date_memos').delete().eq('id', memoId);
  if (error) throw error;
}
