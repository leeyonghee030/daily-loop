import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet } from 'react-native';

// 그룹 4개(헤드라인/테마색/폰트/버튼)를 화면 높이 기준 고정 비율 위치에 절대 배치한다.
// (여백을 남는 공간 분배(space-between) 방식으로 했더니 실제 콘텐츠 높이에 따라 간격이
// 거의 0이 되어 화면 중간에 뭉쳐 보이는 문제가 있어서, 콘텐츠 길이와 무관하게 항상
// 일정한 위치에 오도록 절대 위치 방식으로 변경)
// 구간을 너무 넓히면(예: 15~85%) 그룹 자체는 작은데 사이 간격만 커져서 "듬성듬성 떠있는
// 섬" 처럼 보였음 — 구간은 25~78% 정도로 완만하게 두고, 대신 그룹 내부(스와치 크기,
// 줄간격, 버튼 패딩 등)를 키워서 콘텐츠 자체의 시각적 무게를 늘리는 방향으로 해결
const SCREEN_HEIGHT = Dimensions.get('window').height;
const GROUP_TOP = {
  headline: SCREEN_HEIGHT * 0.22,
  theme: SCREEN_HEIGHT * 0.42,
  font: SCREEN_HEIGHT * 0.62,
  button: SCREEN_HEIGHT * 0.82,
};

import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { ACCENT_PRESETS, useAccentColorSetting } from '@/lib/accent-color';
import { KOREAN_FONT_PRESETS, useKoreanFontSetting } from '@/lib/korean-font';
import { useOnboarding } from '@/lib/onboarding';

// 최초 진입 시 주색/폰트를 고르게 하는 온보딩 화면. "시작하기"를 눌러야 최초 1회 본 것으로
// 기록되고(app/_layout.tsx가 이 플래그로 재진입 여부 판단), 중간에 앱을 나가면 다음에 다시 뜬다.
// 선택은 로컬 상태로만 미리보기하고, "시작하기"를 눌러야만 실제(전역/저장소)로 반영한다
// — 안 그러면 스와치를 눌러보기만 하고 확정 없이 나가도 그 색/폰트가 저장돼버림
export default function OnboardingScreen() {
  const router = useRouter();
  const { accentColor: defaultAccent, setAccentColor: persistAccentColor } = useAccentColorSetting();
  const { presetId: defaultFontPresetId, setPresetId: persistFontPresetId } = useKoreanFontSetting();
  const { markSeen } = useOnboarding();
  const [accent, setAccent] = useState(defaultAccent);
  const [fontPresetId, setFontPresetId] = useState(defaultFontPresetId);
  const styles = useMemo(() => createStyles(accent), [accent]);

  async function handleStart() {
    persistAccentColor(accent);
    persistFontPresetId(fontPresetId);
    await markSeen();
    router.replace('/(tabs)');
  }

  return (
    <View style={styles.container}>
      <View style={[styles.absoluteGroup, { top: GROUP_TOP.headline }]}>
        <Text style={styles.headline}>나만의 느낌으로{'\n'}시작해볼까요?</Text>
        <Text style={styles.subhead}>주색과 폰트는 설정에서 언제든 다시 바꿀 수 있어요</Text>
      </View>

      <View style={[styles.absoluteGroup, { top: GROUP_TOP.theme }]}>
        <Text style={styles.sectionTitle}>테마 색</Text>
        <View style={styles.accentSwatchRow}>
          {ACCENT_PRESETS.map((preset) => (
            <Pressable key={preset.id} style={styles.accentSwatchItem} onPress={() => setAccent(preset.color)}>
              <View style={[styles.accentSwatchRing, preset.color === accent && styles.accentSwatchRingSelected]}>
                <View style={[styles.accentSwatch, { backgroundColor: preset.color }]} />
              </View>
              <Text style={styles.accentSwatchLabel}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.absoluteGroup, { top: GROUP_TOP.font }]}>
        <Text style={styles.sectionTitle}>폰트</Text>
        <View style={styles.fontOptionRow}>
          {KOREAN_FONT_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              style={[styles.fontOptionButton, preset.id === fontPresetId && styles.fontOptionButtonActive]}
              onPress={() => setFontPresetId(preset.id)}>
              <Text
                style={[
                  styles.fontOptionText,
                  { fontFamily: preset.fontFamily },
                  preset.id === fontPresetId && styles.fontOptionTextActive,
                ]}>
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        style={[styles.startButton, styles.absoluteGroup, { top: GROUP_TOP.button }]}
        onPress={handleStart}>
        <Text style={styles.startButtonText}>시작하기</Text>
      </Pressable>
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
      fontSize: 26,
      fontWeight: '700',
      lineHeight: 36,
      marginBottom: 12,
    },
    subhead: {
      fontSize: 14,
      lineHeight: 20,
      opacity: 0.55,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 16,
    },
    accentSwatchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    accentSwatchItem: {
      alignItems: 'center',
      gap: 8,
    },
    accentSwatchRing: {
      width: 56,
      height: 56,
      borderRadius: 28,
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
      width: 46,
      height: 46,
      borderRadius: 23,
    },
    accentSwatchLabel: {
      fontSize: 12,
      opacity: 0.6,
    },
    fontOptionRow: {
      flexDirection: 'row',
      gap: 14,
    },
    fontOptionButton: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: cardRadius,
      paddingHorizontal: 22,
      paddingVertical: 16,
    },
    fontOptionButtonActive: {
      borderColor: accent,
      backgroundColor: accent,
    },
    fontOptionText: {
      fontSize: 16,
      lineHeight: 22,
      textAlignVertical: 'center',
    },
    fontOptionTextActive: {
      color: '#fff',
    },
    startButton: {
      backgroundColor: accent,
      borderRadius: cardRadius,
      paddingVertical: 18,
      alignItems: 'center',
    },
    startButtonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '700',
    },
  });
}
