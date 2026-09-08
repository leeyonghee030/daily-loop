import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fontEnglishRounded, fontKorean } from '@/constants/theme';
import { useTranslation, type Language, type TranslationKey } from '@/lib/language';

export type KoreanFontPreset = { id: string; labelKey: TranslationKey; fontFamily: string | undefined; sizeAdjust: number };

// 화면 곳곳에서 fontFamily/fontSize를 같이 받아 쓰기 위한 값 — sizeAdjust는 기존 fontSize에
// 그대로 더해서 쓴다(기본 폰트가 동글 폰트보다 커 보여서 음수로 보정)
export type KoreanFontValue = { fontFamily: string | undefined; sizeAdjust: number };

// 제목 등에 쓰는 폰트를 시스템 기본 폰트와 동글 폰트 중에서 고를 수 있게 함(2026-09, 우선 2개만).
// 기본 폰트가 동글 폰트보다 체감상 커 보인다는 피드백으로 기본 폰트만 3px 작게 보정.
// "동글" 프리셋의 실제 폰트는 앱 언어에 따라 달라진다 — Cute Font는 한글에 맞춰 고른 폰트라
// 영어 화면에서는 Fredoka(영문 전용 둥근 폰트)를 대신 쓴다(getFontPresets 참고). Fredoka가
// Cute Font보다 실제 렌더링 크기가 살짝 커 보여서 영어 쪽만 2px 축소
export function getFontPresets(language: Language): KoreanFontPreset[] {
  return [
    { id: 'default', labelKey: 'font.default', fontFamily: undefined, sizeAdjust: -3 },
    {
      id: 'rounded',
      labelKey: 'font.rounded',
      fontFamily: language === 'en' ? fontEnglishRounded : fontKorean,
      sizeAdjust: language === 'en' ? -2 : 0,
    },
  ];
}

// 지금까지 적용돼 있던 동글 폰트를 그대로 기본값으로 유지
const DEFAULT_PRESET_ID = 'rounded';
const STORAGE_KEY = 'app_korean_font_preset';

function presetById(id: string, language: Language): KoreanFontPreset {
  const presets = getFontPresets(language);
  return presets.find((p) => p.id === id) ?? presets[0];
}

type KoreanFontContextValue = KoreanFontValue & {
  presetId: string;
  setPresetId: (id: string) => void;
};

function contextValueFor(presetId: string, setPresetId: (id: string) => void, language: Language): KoreanFontContextValue {
  const preset = presetById(presetId, language);
  return { fontFamily: preset.fontFamily, sizeAdjust: preset.sizeAdjust, presetId, setPresetId };
}

const KoreanFontContext = createContext<KoreanFontContextValue>(contextValueFor(DEFAULT_PRESET_ID, () => {}, 'ko'));

export function KoreanFontProvider({ children }: { children: ReactNode }) {
  const { language } = useTranslation();
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

  const value = useMemo(() => contextValueFor(presetId, setPresetId, language), [presetId, language]);

  return <KoreanFontContext.Provider value={value}>{children}</KoreanFontContext.Provider>;
}

// 설정/온보딩 화면의 폰트 선택 칩용 — 현재 앱 언어에 맞는 프리셋 목록(라벨 키 포함)을 돌려준다
export function useFontPresets(): KoreanFontPreset[] {
  const { language } = useTranslation();
  return useMemo(() => getFontPresets(language), [language]);
}

// 화면 대부분이 이 값을 그대로 style factory에 넘겨 fontFamily/fontSize를 같이 계산하는 데 쓴다.
// Provider의 value가 presetId 기준으로 이미 메모돼 있으므로 그 객체를 그대로 반환해
// useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]) 쪽 deps가 안정적으로 유지되게 한다.
// useDeferredValue로 감싸서, 설정 화면에서 폰트를 고르는 동안 화면 뒤에 쌓여있는 다른 무거운
// 화면들의 리렌더링을 낮은 우선순위로 미룬다(accent-color.tsx의 useAccentColor와 동일한 이유)
export function useKoreanFont(): KoreanFontValue {
  const value = useContext(KoreanFontContext);
  return useDeferredValue(value);
}

export function useKoreanFontSetting(): KoreanFontContextValue {
  return useContext(KoreanFontContext);
}
