import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

// 구글 로그인(lib/google-signin.ts)과 완전히 같은 흐름 — Supabase Auth가 카카오도 구글과
// 동일하게 정식 지원하는 OAuth 제공자라, Firebase 같은 중간 다리 없이 바로 재사용 가능하다
export async function signInWithKakao() {
  const redirectTo = Linking.createURL('/auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // account_email은 개인 개발자 앱에선 권한 자체가 없어서(비즈니스 인증 필요), 기본값대로
      // 두면 카카오가 "잘못된 요청(KOE205)"으로 거부한다 — 실제로 쓰는 동의항목만 명시한다
      scopes: 'profile_nickname',
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error('OAuth URL을 받지 못했습니다.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    return false;
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    throw new Error('로그인 응답에서 토큰을 찾지 못했습니다.');
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError) throw sessionError;

  return true;
}
