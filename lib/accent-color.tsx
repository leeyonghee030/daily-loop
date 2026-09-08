import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';

import { accent as DEFAULT_ACCENT } from '@/constants/theme';
import type { TranslationKey } from '@/lib/language';

export type AccentPreset = { id: string; label: string; color: string };

// 서브색/폰트색/배경색은 그대로 두고, 앱 전체에서 포인트로 쓰는 "주색"(구름색)만
// 사용자가 고를 수 있게 하는 프리셋 목록(2026-09)
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'cloud', label: '구름색', color: DEFAULT_ACCENT },
  { id: 'black', label: '검정', color: '#4A4A4A' },
  { id: 'yellow', label: '은은한 노랑', color: '#ECD99E' },
  { id: 'sage', label: '세이지 그린', color: '#93C2A8' },
  { id: 'rose', label: '로즈', color: '#E1BDCB' },
];

export const ACCENT_LABEL_KEYS: Record<string, TranslationKey> = {
  cloud: 'accentColor.cloud',
  black: 'accentColor.black',
  yellow: 'accentColor.yellow',
  sage: 'accentColor.sage',
  rose: 'accentColor.rose',
};

const STORAGE_KEY = 'app_accent_color';

type AccentColorContextValue = {
  accentColor: string;
  setAccentColor: (color: string) => void;
};

const AccentColorContext = createContext<AccentColorContextValue>({
  accentColor: DEFAULT_ACCENT,
  setAccentColor: () => {},
});

export function AccentColorProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) setAccentColorState(saved);
    })();
  }, []);

  function setAccentColor(color: string) {
    setAccentColorState(color);
    AsyncStorage.setItem(STORAGE_KEY, color);
  }

  const value = useMemo(() => ({ accentColor, setAccentColor }), [accentColor]);

  return <AccentColorContext.Provider value={value}>{children}</AccentColorContext.Provider>;
}

// 화면 대부분이 "accent"라는 이름으로 색을 바로 쓰던 기존 관례를 유지하기 위해,
// 색 값만 돌려주는 훅(변경 함수가 필요한 곳은 useAccentColorSetting을 따로 씀).
// useDeferredValue로 감싸서, 설정 화면에서 색을 고르는 동안 화면 뒤에 쌓여있는 다른 무거운
// 화면들(오늘 탭 타임라인 등)의 리렌더링을 낮은 우선순위로 미룬다 — 그 화면들은 실제로 안
// 보이고 있으니 한 박자 늦게 갱신돼도 문제없고, 대신 지금 만지고 있는 설정 화면은 안 밀림
export function useAccentColor(): string {
  const { accentColor } = useContext(AccentColorContext);
  return useDeferredValue(accentColor);
}

export function useAccentColorSetting(): AccentColorContextValue {
  return useContext(AccentColorContext);
}
