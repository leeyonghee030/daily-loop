import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { ACCENT_PRESETS, ACCENT_LABEL_KEYS, useAccentColorSetting } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useFontPresets, useKoreanFontSetting } from '@/lib/korean-font';
import { useTranslation, type Language } from '@/lib/language';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accentColor: accent, setAccentColor } = useAccentColorSetting();
  const { presetId: fontPresetId, setPresetId: setFontPresetId } = useKoreanFontSetting();
  const fontPresets = useFontPresets();
  const { language, setLanguage, t } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showThemeDesc, setShowThemeDesc] = useState(false);
  const [showFontDesc, setShowFontDesc] = useState(false);

  const LANGUAGE_OPTIONS: { id: Language; label: string }[] = [
    { id: 'ko', label: t('settings.languageKorean') },
    { id: 'en', label: t('settings.languageEnglish') },
  ];

  return (
    <View style={styles.container}>
      {/* iOS 설정 앱처럼, 관련 항목을 하나의 둥근 카드 안에 얇은 구분선으로 묶어서 보여준다.
          그룹 제목·설명은 항상 카드 "위"에 함께 둔다(카드 아래에 따로 떼어두면 붕 떠보여서) */}
      <ShadowCard style={styles.groupOuter} contentStyle={styles.group}>
        <AnimatedPressable style={styles.row} onPress={() => router.push('/slot-settings')}>
          <View style={styles.rowLeft}>
            <Ionicons name="time-outline" size={22} color={textMuted} style={styles.rowIcon} />
            <Text style={styles.rowLabel}>{t('settings.timeSettings')}</Text>
          </View>
          <Text style={styles.rowChevron}>›</Text>
        </AnimatedPressable>
      </ShadowCard>

      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeader}>{t('settings.themeColor')}</Text>
        <AnimatedPressable onPress={() => setShowThemeDesc((v) => !v)} hitSlop={8}>
          <Text style={styles.groupHeaderInfoIcon}>ⓘ</Text>
        </AnimatedPressable>
      </View>
      {showThemeDesc && <Text style={styles.groupHeaderDesc}>{t('settings.themeColorDesc')}</Text>}
      <ShadowCard style={styles.groupOuter} contentStyle={styles.group}>
        <View style={styles.groupPadding}>
          <View style={styles.accentSwatchRow}>
            {ACCENT_PRESETS.map((preset) => (
              <AnimatedPressable
                key={preset.id}
                style={styles.accentSwatchItem}
                onPress={() => setAccentColor(preset.color)}>
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
      </ShadowCard>

      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeader}>{t('settings.font')}</Text>
        <AnimatedPressable onPress={() => setShowFontDesc((v) => !v)} hitSlop={8}>
          <Text style={styles.groupHeaderInfoIcon}>ⓘ</Text>
        </AnimatedPressable>
      </View>
      {showFontDesc && <Text style={styles.groupHeaderDesc}>{t('settings.fontDesc')}</Text>}
      <ShadowCard style={styles.groupOuter} contentStyle={styles.group}>
        <View style={styles.groupPadding}>
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
      </ShadowCard>

      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeader}>{t('settings.language')}</Text>
      </View>
      <ShadowCard style={styles.groupOuter} contentStyle={styles.group}>
        <View style={styles.groupPadding}>
          <View style={styles.fontOptionRow}>
            {LANGUAGE_OPTIONS.map((option) => (
              <AnimatedPressable
                key={option.id}
                style={[styles.fontOptionButton, option.id === language && styles.fontOptionButtonActive]}
                onPress={() => setLanguage(option.id)}>
                <Text style={[styles.fontOptionText, option.id === language && styles.fontOptionTextActive]}>
                  {option.label}
                </Text>
              </AnimatedPressable>
            ))}
          </View>
        </View>
      </ShadowCard>

      {/* 이메일/로그아웃은 카드 없이, 위쪽 얇은 선으로만 구분된 한 줄에 양 끝 정렬로
          화면 맨 아래에 고정. 이메일이 길어도 2줄로 안 늘어나고 1줄로 잘리게 함 */}
      <View style={styles.accountSection}>
        <View style={styles.accountBlock}>
          <Text style={styles.accountEmail} numberOfLines={1} ellipsizeMode="tail">
            {session?.user.email}
          </Text>
          <AnimatedPressable onPress={() => setShowSignOutConfirm(true)}>
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </AnimatedPressable>
        </View>
      </View>

      <Modal
        visible={showSignOutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignOutConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowSignOutConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('settings.signOutConfirmTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('settings.signOutConfirmDesc')}</Text>
            <View style={styles.confirmButtonRow}>
              <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowSignOutConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.confirmSignOutButton}
                onPress={() => {
                  setShowSignOutConfirm(false);
                  supabase.auth.signOut();
                }}>
                <Text style={styles.confirmSignOutText}>{t('settings.signOut')}</Text>
              </AnimatedPressable>
            </View>
          </ShadowCard>
        </RNView>
      </Modal>
    </View>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 20,
      paddingBottom: 44,
    },
    // 이메일/로그아웃을 위 그룹들과 무관하게 항상 화면 맨 아래에 붙인다
    accountSection: {
      marginTop: 'auto',
      paddingBottom: 10,
    },
    // 카드 없이 위쪽 얇은 선으로만 구분한 블록 — 이메일/로그아웃이 각자 한 블록씩.
    // 위아래 여백을 같게 둬서 줄 안에서 세로 중심이 맞도록 함(기기 하단 뒤로가기 버튼과도 거리 확보)
    accountBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    accountEmail: {
      flex: 1,
      fontSize: 13,
      opacity: 0.6,
    },
    // 그룹(카드) 위에 놓는 소제목. 설명 문구는 항상 보이지 않고, 옆 ⓘ 아이콘을 눌러야 펼쳐짐
    groupHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    groupHeader: {
      fontSize: 16,
      fontWeight: '700',
    },
    groupHeaderInfoIcon: {
      fontSize: 14,
      color: textMuted,
    },
    groupHeaderDesc: {
      fontSize: 13,
      opacity: 0.6,
      marginBottom: 10,
      lineHeight: 18,
    },
    groupOuter: {
      marginBottom: 24,
    },
    group: {
      padding: 0,
    },
    groupPadding: {
      padding: 16,
    },
    // 그룹 안의 한 행 — 슬롯시간 설정/이메일/로그아웃이 전부 이 스타일을 공유하고, 행 사이는
    // divider로만 구분한다(iOS 설정 앱처럼 카드 하나 안에 여러 행이 얇은 선으로만 나뉨)
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    // 아이콘 폰트 자체의 여백 때문에 alignItems:center만으로는 글자와 세로 중심이 살짝
    // 안 맞아서, 아주 조금 내려서 시각적으로 맞춘다
    rowIcon: {
      marginTop: 2,
    },
    rowLabel: {
      fontSize: 15,
      lineHeight: 20,
    },
    rowChevron: {
      fontSize: 20,
      opacity: 0.35,
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
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    // 선택 표시가 스와치 자체 색(특히 검정)에 묻혀 안 보이는 문제 — 스와치와 테두리 사이에
    // 흰 여백(halo)을 둬서 스와치 색과 무관하게 항상 또렷이 보이게 함
    accentSwatchRingSelected: {
      borderColor: textMuted,
      backgroundColor: '#fff',
    },
    accentSwatch: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    accentSwatchLabelBox: {
      height: 28,
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    accentSwatchLabel: {
      fontSize: 11,
      lineHeight: 14,
      opacity: 0.6,
      textAlign: 'center',
    },
    fontOptionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    fontOptionButton: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: cardRadius,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    fontOptionButtonActive: {
      borderColor: accent,
      backgroundColor: accent,
    },
    fontOptionText: {
      fontSize: 15,
      lineHeight: 20,
      textAlignVertical: 'center',
    },
    fontOptionTextActive: {
      color: '#fff',
    },
    signOutText: {
      color: '#FF6B6B',
      fontWeight: '600',
      fontSize: 13,
    },
    confirmBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
      paddingHorizontal: 32,
    },
    confirmCardOuter: {
      width: '100%',
    },
    confirmCard: {
      padding: 24,
      alignItems: 'center',
    },
    confirmTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 6,
    },
    confirmDesc: {
      fontSize: 13,
      opacity: 0.5,
      marginBottom: 20,
      textAlign: 'center',
    },
    confirmButtonRow: {
      flexDirection: 'row',
      gap: 10,
      width: '100%',
    },
    confirmCancelButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: cardRadius,
      borderWidth: 1,
      borderColor: border,
    },
    confirmCancelText: {
      fontSize: 14,
      fontWeight: '600',
      opacity: 0.6,
    },
    confirmSignOutButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: cardRadius,
      backgroundColor: accent,
    },
    confirmSignOutText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
  });
}
