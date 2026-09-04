import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fontKorean as ROUNDED_FONT } from '@/constants/theme';

export type KoreanFontPreset = { id: string; label: string; fontFamily: string | undefined; sizeAdjust: number };

// 화면 곳곳에서 fontFamily/fontSize를 같이 받아 쓰기 위한 값 — sizeAdjust는 기존 fontSize에
// 그대로 더해서 쓴다(기본 폰트가 동글 폰트보다 커 보여서 음수로 보정)
export type KoreanFontValue = { fontFamily: string | undefined; sizeAdjust: number };

// 루틴 제목 등 한글 표시에 쓰는 폰트를 처음 기본으로 쓰던 시스템 폰트와, 지금까지 적용해온
// 동글 폰트 중에서 고를 수 있게 함(2026-09, 우선 2개만). 기본 폰트가 동글 폰트보다 체감상
// 커 보인다는 피드백으로 기본 폰트만 3px 작게 보정
export const KOREAN_FONT_PRESETS: KoreanFontPreset[] = [
  { id: 'default', label: '기본 폰트', fontFamily: undefined, sizeAdjust: -3 },
  { id: 'rounded', label: '동글 폰트', fontFamily: ROUNDED_FONT, sizeAdjust: 0 },
];

// 지금까지 적용돼 있던 동글 폰트를 그대로 기본값으로 유지
const DEFAULT_PRESET_ID = 'rounded';
const STORAGE_KEY = 'app_korean_font_preset';

function presetById(id: string): KoreanFontPreset {
  return KOREAN_FONT_PRESETS.find((p) => p.id === id) ?? KOREAN_FONT_PRESETS[0];
}

type KoreanFontContextValue = KoreanFontValue & {
  presetId: string;
  setPresetId: (id: string) => void;
};

function contextValueFor(presetId: string, setPresetId: (id: string) => void): KoreanFontContextValue {
  const preset = presetById(presetId);
  return { fontFamily: preset.fontFamily, sizeAdjust: preset.sizeAdjust, presetId, setPresetId };
}

const KoreanFontContext = createContext<KoreanFontContextValue>(contextValueFor(DEFAULT_PRESET_ID, () => {}));

export function KoreanFontProvider({ children }: { children: ReactNode }) {
  const [presetId, setPresetIdState] = useState(DEFAULT_PRESET_ID);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) setPresetIdState(saved);
    })();
  }, []);

  function setPresetId(id: string) {
    setPresetIdState(id);
    AsyncStorage.setItem(STORAGE_KEY, id);
  }

  const value = useMemo(() => contextValueFor(presetId, setPresetId), [presetId]);

  return <KoreanFontContext.Provider value={value}>{children}</KoreanFontContext.Provider>;
}

// 화면 대부분이 이 값을 그대로 style factory에 넘겨 fontFamily/fontSize를 같이 계산하는 데 쓴다.
// Provider의 value가 presetId 기준으로 이미 메모돼 있으므로 그 객체를 그대로 반환해
// useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]) 쪽 deps가 안정적으로 유지되게 한다
export function useKoreanFont(): KoreanFontValue {
  return useContext(KoreanFontContext);
}

export function useKoreanFontSetting(): KoreanFontContextValue {
  return useContext(KoreanFontContext);
}
