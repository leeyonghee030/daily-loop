import { supabase } from '@/lib/supabase';

export type MemoColor = 'yellow' | 'red' | 'mint' | 'blue' | 'purple';

export const MEMO_COLOR_ORDER: MemoColor[] = ['yellow', 'red', 'mint', 'blue', 'purple'];

// 원래 채도 높은 원색이었는데(0.45 알파), 배경 흰색과 어울리게 흰색을 더 섞고
// 알파도 낮춰 은은한 파스텔 톤으로 조정함(2026-09-03, 흰색 비중을 더 올려 재조정)
export const MEMO_COLORS: Record<MemoColor, { bg: string; border: string; label: string }> = {
  yellow: { bg: 'rgba(251, 232, 163, 0.22)', border: '#F0DBA8', label: '노랑' },
  red: { bg: 'rgba(255, 196, 196, 0.22)', border: '#F0BABA', label: '빨강' },
  mint: { bg: 'rgba(178, 229, 217, 0.22)', border: '#A9D8CA', label: '민트' },
  blue: { bg: 'rgba(189, 209, 249, 0.22)', border: '#B4C6EA', label: '파랑' },
  purple: { bg: 'rgba(215, 202, 249, 0.22)', border: '#CCBEE9', label: '보라' },
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
