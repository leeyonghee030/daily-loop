import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type OnboardingContextValue = {
  // null = 아직 서버에서 안 읽음(app/_layout.tsx가 이 동안 라우팅 판단을 미룬다)
  seen: boolean | null;
  markSeen: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  seen: null,
  markSeen: async () => {},
});

// 계정(users.onboarding_completed)에 저장 — 기기/앱 재설치와 무관하게 같은 계정이면
// 다시 로그인해도 온보딩을 또 보지 않는다
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) {
      setSeen(null);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('onboarding_completed')
          .eq('id', userId)
          .maybeSingle();
        if (error) console.error('온보딩 상태 조회 실패:', error);
        setSeen(data?.onboarding_completed ?? false);
      } catch (error) {
        console.error('온보딩 상태 조회 실패:', error);
        setSeen(false);
      }
    })();
  }, [userId]);

  async function markSeen() {
    if (!userId) return;
    await supabase.from('users').update({ onboarding_completed: true }).eq('id', userId);
    setSeen(true);
  }

  const value = useMemo(() => ({ seen, markSeen }), [seen, userId]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext);
}
