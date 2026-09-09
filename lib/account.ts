import { supabase } from './supabase';

// 회원탈퇴 — Edge Function이 auth.users를 지우면 public.users 이하 모든 데이터가
// on delete cascade로 함께 삭제된다. 성공 후 로컬 세션도 정리해 로그인 화면으로 보낸다.
// (카카오/구글 자체 로그인 세션(SSO)까지는 지우지 않는다 — 우리 쪽에 client_id가 없어
// 제대로 된 로그아웃 URL을 만들 수 없고, 어설프게 시도하면 에러 페이지만 보여주게 된다.
// 재로그인 시 그 계정의 로그인창이 생략되고 자동 통과되는 것은 정상 SSO 동작이다.)
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) {
    // functions.invoke의 error 객체는 기본 메시지("non-2xx status code")만 담고 있어서,
    // 우리 함수가 응답 본문에 실어 보낸 실제 에러 메시지를 context에서 직접 꺼낸다.
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.json();
        if (body?.error) message = body.error;
      } catch {
        // 본문을 못 읽으면 기본 메시지로 폴백
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  // 계정이 이미 서버에서 삭제된 뒤라 서버에 로그아웃을 요청하는 기본 동작(scope: 'global')은
  // 실패할 수 있다. 다음 로그인이 이전 세션/토큰을 재사용하지 않도록 로컬 세션만 확실히 지운다.
  await supabase.auth.signOut({ scope: 'local' });
}
