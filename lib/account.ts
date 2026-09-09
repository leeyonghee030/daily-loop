import { supabase } from './supabase';

// 회원탈퇴 — Edge Function이 auth.users를 지우면 public.users 이하 모든 데이터가
// on delete cascade로 함께 삭제된다. 성공 후 로컬 세션도 정리해 로그인 화면으로 보낸다.
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  await supabase.auth.signOut();
}
