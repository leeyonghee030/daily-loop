import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type OnboardingContextValue = {
  // null = 아직 한 번도 확인된 적 없음(서버 응답 대기 중, 또는 오프라인이라 캐시도 없음)
  // — app/_layout.tsx가 이 동안 라우팅 판단을 미룬다
  seen: boolean | null;
  markSeen: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  seen: null,
  markSeen: async () => {},
});

// 계정(users.onboarding_completed)에 저장 — 기기/앱 재설치와 무관하게 같은 계정이면
// 다시 로그인해도 온보딩을 또 보지 않는다.
// react-query로 조회해서 마지막으로 성공한 값을 오프라인 캐시(AsyncStorage)에 같이 보존한다 —
// 예전엔 직접 supabase를 호출해서 네트워크가 끊기면 무조건 false(온보딩 안 함)로 떨어졌는데,
// 그러면 로그인은 이미 돼 있는 기존 유저도 비행기모드에서 앱을 열면 신규가입처럼 온보딩
// 화면(테마색/언어 고르기)으로 튕겨나가는 버그가 있었음(2026-10-06) — 이제 오프라인이면 마지막
// 조회 성공 시점의 값을 그대로 쓴다(한 번도 성공한 적 없는 최초 설치+오프라인만 예외, 이 경우는
// 어차피 로그인 자체도 네트워크가 필요해서 발생하지 않음)
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['onboarding-completed', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('onboarding_completed')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      // 세션은 있는데(userId 있음) 그 id로 users 행이 없는 경우 — 이미 탈퇴된 계정의 로그인
      // 토큰이 기기에 그대로 남아있는 상태다(탈퇴 트리거로 공급계정 행 자체가 cascade로
      // 지워졌지만, Supabase 토큰은 만료 전까지 로컬에선 여전히 "유효"해 보인다). 이걸 그냥
      // "온보딩 미완료"(false)로 취급하면 온보딩 화면만 영원히 반복해서 보여주는 루프에 빠진다
      // (2026-10-07) — 로컬 세션을 정리해서 로그인 화면으로 돌려보낸다
      if (!data) {
        await supabase.auth.signOut({ scope: 'local' });
        return false;
      }
      return data.onboarding_completed ?? false;
    },
    enabled: !!userId,
  });

  const seen = userId ? query.data ?? null : null;

  async function markSeen() {
    if (!userId) return;
    await supabase.from('users').update({ onboarding_completed: true }).eq('id', userId);
    queryClient.setQueryData(['onboarding-completed', userId], true);
  }

  const value = useMemo(() => ({ seen, markSeen }), [seen, userId]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext);
}
