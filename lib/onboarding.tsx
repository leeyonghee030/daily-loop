import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const ONBOARDING_SEEN_KEY = 'onboarding_seen';

type OnboardingContextValue = {
  // null = 아직 저장소에서 안 읽음(app/_layout.tsx가 이 동안 라우팅 판단을 미룬다)
  seen: boolean | null;
  markSeen: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  seen: null,
  markSeen: async () => {},
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY).then((value) => setSeen(value === '1'));
  }, []);

  async function markSeen() {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    setSeen(true);
  }

  const value = useMemo(() => ({ seen, markSeen }), [seen]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext);
}
