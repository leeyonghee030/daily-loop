import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';

// 그룹 5개(헤드라인/테마색/폰트/언어/버튼)를 화면 높이 기준 고정 비율 위치에 절대 배치한다.
// (여백을 남는 공간 분배(space-between) 방식으로 했더니 실제 콘텐츠 높이에 따라 간격이
// 거의 0이 되어 화면 중간에 뭉쳐 보이는 문제가 있어서, 콘텐츠 길이와 무관하게 항상
// 일정한 위치에 오도록 절대 위치 방식으로 변경)
// 요소들이 전반적으로 커서 촌스러워 보인다는 피드백으로 폰트/스와치/버튼 크기를 전체적으로
// 줄이고, 그만큼 화면이 허전해지지 않도록 시작~끝 구간은 오히려 더 넓게 잡음(위아래로 더
// 길게 펼쳐서 여백으로 보이게). 헤드라인 바로 아래 보조설명이 영어에서 2줄로 늘어나도
// 테마색 섹션과 안 겹치도록, 헤드라인→테마색 사이 간격만 다른 구간보다 넉넉하게 둠
const SCREEN_HEIGHT = Dimensions.get('window').height;
// 테마색 박스는 2줄(제목+스와치)이라 폰트/언어 박스(1줄, 구조 동일)보다 실제 높이가 크다 —
// 이 셋을 그냥 화면 비율로 균등하게 나누면 실제 콘텐츠 높이 차이 때문에 박스 사이 여백이
// 서로 다르게 보이는 문제가 있어서(테마색↔폰트 사이는 좁고 폰트↔언어 사이는 넓어 보이는 등),
// 아래 두 상수(대략의 실제 높이)로 테마색→폰트→언어→버튼 사이 간격을 계산해서 셋 다 똑같이 맞춘다
const THEME_CONTENT_HEIGHT = 100;
const ROW_CONTENT_HEIGHT = 72;
const HEADLINE_TOP = SCREEN_HEIGHT * 0.2;
const THEME_TOP = SCREEN_HEIGHT * 0.37 - 5;
const BUTTON_TOP = SCREEN_HEIGHT * 0.8;
const GAP = (BUTTON_TOP - THEME_TOP - THEME_CONTENT_HEIGHT - ROW_CONTENT_HEIGHT * 2) / 3;
const FONT_TOP = THEME_TOP + THEME_CONTENT_HEIGHT + GAP - 4;
const LANGUAGE_TOP = FONT_TOP + ROW_CONTENT_HEIGHT + GAP;

const GROUP_TOP = {
  headline: HEADLINE_TOP,
  theme: THEME_TOP - 3,
  font: FONT_TOP - 3,
  language: LANGUAGE_TOP - 3,
  button: BUTTON_TOP + 10,
};

import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { ACCENT_PRESETS, ACCENT_LABEL_KEYS, useAccentColorSetting } from '@/lib/accent-color';
import { getFontPresets, useKoreanFontSetting } from '@/lib/korean-font';
import { translate, useTranslation, type Language, type TranslationKey } from '@/lib/language';
import { useOnboarding } from '@/lib/onboarding';

const LANGUAGE_OPTIONS: { id: Language; labelKey: 'settings.languageKorean' | 'settings.languageEnglish' }[] = [
  { id: 'ko', labelKey: 'settings.languageKorean' },
  { id: 'en', labelKey: 'settings.languageEnglish' },
];

// 최초 진입 시 주색/폰트/언어를 고르게 하는 온보딩 화면. "시작하기"를 눌러야 최초 1회 본 것으로
// 기록되고(app/_layout.tsx가 이 플래그로 재진입 여부 판단), 중간에 앱을 나가면 다음에 다시 뜬다.
// 선택은 로컬 상태로만 미리보기하고, "시작하기"를 눌러야만 실제(전역/저장소)로 반영한다
// — 안 그러면 스와치를 눌러보기만 하고 확정 없이 나가도 그 색/폰트/언어가 저장돼버림.
// 언어는 이 화면 자체의 문구(헤드라인/섹션 제목 등)도 실시간 미리보기 대상이라, 전역
// useTranslation()의 t 대신 로컬로 고른 언어를 직접 넣어 조회하는 자체 t를 쓴다
export default function OnboardingScreen() {
  const router = useRouter();
  const { accentColor: defaultAccent, setAccentColor: persistAccentColor } = useAccentColorSetting();
  const { presetId: defaultFontPresetId, setPresetId: persistFontPresetId } = useKoreanFontSetting();
  const { language: defaultLanguage, setLanguage: persistLanguage } = useTranslation();
  const [accent, setAccent] = useState(defaultAccent);
  const [fontPresetId, setFontPresetId] = useState(defaultFontPresetId);
  const [previewLanguage, setPreviewLanguage] = useState<Language>(defaultLanguage);
  const fontPresets = useMemo(() => getFontPresets(previewLanguage), [previewLanguage]);
  const { markSeen } = useOnboarding();
  const t = useMemo(() => (key: TranslationKey) => translate(previewLanguage, key), [previewLanguage]);
  const styles = useMemo(() => createStyles(accent), [accent]);

  async function handleStart() {
    persistAccentColor(accent);
    persistFontPresetId(fontPresetId);
    persistLanguage(previewLanguage);
    await markSeen();
    router.replace('/(tabs)');
  }

  return (
    <View style={styles.container}>
      <View style={[styles.absoluteGroup, { top: GROUP_TOP.headline }]}>
        <Text style={styles.headline}>
          {t('onboarding.headlineLine1')}
          {'\n'}
          {t('onboarding.headlineLine2')}
        </Text>
        <Text style={styles.subhead}>{t('onboarding.subhead')}</Text>
      </View>

      <View style={[styles.absoluteGroup, { top: GROUP_TOP.theme }]}>
        <Text style={styles.sectionTitle}>{t('onboarding.themeColor')}</Text>
        <View style={styles.accentSwatchRow}>
          {ACCENT_PRESETS.map((preset) => (
            <AnimatedPressable key={preset.id} style={styles.accentSwatchItem} onPress={() => setAccent(preset.color)}>
              <View style={[styles.accentSwatchRing, preset.color === accent && styles.accentSwatchRingSelected]}>
                <View style={[styles.accentSwatch, { backgroundColor: preset.color }]} />
              </View>
              <View style={styles.accentSwatchLabelBox}>
                <Text style={styles.accentSwatchLabel} numberOfLines={2}>
                  {t(ACCENT_LABEL_KEYS[preset.id])}
                </Text>
              </View>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View style={[styles.absoluteGroup, { top: GROUP_TOP.font }]}>
        <Text style={styles.sectionTitle}>{t('onboarding.font')}</Text>
        <View style={styles.fontOptionRow}>
          {fontPresets.map((preset) => (
            <AnimatedPressable
              key={preset.id}
              style={[styles.fontOptionButton, preset.id === fontPresetId && styles.fontOptionButtonActive]}
              onPress={() => setFontPresetId(preset.id)}>
              <Text
                style={[
                  styles.fontOptionText,
                  { fontFamily: preset.fontFamily },
                  preset.id === fontPresetId && styles.fontOptionTextActive,
                ]}>
                {t(preset.labelKey)}
              </Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View style={[styles.absoluteGroup, { top: GROUP_TOP.language }]}>
        <Text style={styles.sectionTitle}>{t('onboarding.language')}</Text>
        <View style={styles.fontOptionRow}>
          {LANGUAGE_OPTIONS.map((option) => (
            <AnimatedPressable
              key={option.id}
              style={[styles.fontOptionButton, option.id === previewLanguage && styles.fontOptionButtonActive]}
              onPress={() => setPreviewLanguage(option.id)}>
              <Text style={[styles.fontOptionText, option.id === previewLanguage && styles.fontOptionTextActive]}>
                {t(option.labelKey)}
              </Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <AnimatedPressable
        style={[styles.startButton, styles.absoluteGroup, { top: GROUP_TOP.button }]}
        onPress={handleStart}>
        <Text style={styles.startButtonText}>{t('onboarding.start')}</Text>
      </AnimatedPressable>
    </View>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    absoluteGroup: {
      position: 'absolute',
      left: 24,
      right: 24,
    },
    headline: {
      fontSize: 23,
      fontWeight: '700',
      lineHeight: 30,
      marginBottom: 9,
    },
    subhead: {
      fontSize: 13,
      lineHeight: 18,
      opacity: 0.55,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 12,
    },
    accentSwatchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    accentSwatchItem: {
      width: 60,
      alignItems: 'center',
      gap: 1,
    },
    accentSwatchRing: {
      width: 47,
      height: 47,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    accentSwatchRingSelected: {
      borderColor: textMuted,
      backgroundColor: '#fff',
    },
    accentSwatch: {
      width: 37,
      height: 37,
      borderRadius: 19,
    },
    accentSwatchLabelBox: {
      height: 26,
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    accentSwatchLabel: {
      fontSize: 11,
      lineHeight: 13,
      opacity: 0.6,
      textAlign: 'center',
    },
    fontOptionRow: {
      flexDirection: 'row',
      gap: 12,
    },
    fontOptionButton: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: cardRadius,
      paddingHorizontal: 24,
      paddingVertical: 12,
    },
    fontOptionButtonActive: {
      borderColor: accent,
      backgroundColor: accent,
    },
    fontOptionText: {
      fontSize: 14,
      lineHeight: 19,
      textAlignVertical: 'center',
    },
    fontOptionTextActive: {
      color: '#fff',
    },
    startButton: {
      backgroundColor: accent,
      borderRadius: cardRadius,
      paddingVertical: 16,
      alignItems: 'center',
    },
    startButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
