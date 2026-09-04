import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { ACCENT_PRESETS, useAccentColorSetting } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { KOREAN_FONT_PRESETS, useKoreanFontSetting } from '@/lib/korean-font';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accentColor: accent, setAccentColor } = useAccentColorSetting();
  const { presetId: fontPresetId, setPresetId: setFontPresetId } = useKoreanFontSetting();
  const styles = useMemo(() => createStyles(accent), [accent]);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  return (
    <View style={styles.container}>
      <ShadowCard style={styles.navBoxOuter} contentStyle={styles.navBox}>
        <Pressable style={styles.navBoxPressable} onPress={() => router.push('/slot-settings')}>
          <View style={styles.navBoxLeft}>
            <Ionicons name="time-outline" size={22} color={textMuted} style={{ marginTop: 3 }} />
            <Text style={styles.navBoxText}>슬롯시간 설정</Text>
          </View>
          <Text style={styles.navBoxChevron}>›</Text>
        </Pressable>
      </ShadowCard>

      <Text style={styles.sectionTitle}>테마 색</Text>
      <Text style={styles.sectionDesc}>테마색을 변경할 수 있어요</Text>
      <View style={styles.accentSwatchRow}>
        {ACCENT_PRESETS.map((preset) => (
          <Pressable key={preset.id} style={styles.accentSwatchItem} onPress={() => setAccentColor(preset.color)}>
            <View style={[styles.accentSwatchRing, preset.color === accent && styles.accentSwatchRingSelected]}>
              <View style={[styles.accentSwatch, { backgroundColor: preset.color }]} />
            </View>
            <Text style={styles.accentSwatchLabel}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>폰트</Text>
      <Text style={styles.sectionDesc}>루틴 제목 등에 쓰이는 폰트를 바꿀 수 있어요</Text>
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

      <View style={styles.accountRow}>
        <Text style={styles.accountEmail}>{session?.user.email}</Text>
        <Pressable onPress={() => setShowSignOutConfirm(true)}>
          <Text style={styles.signOutText}>로그아웃</Text>
        </Pressable>
      </View>

      <Modal
        visible={showSignOutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignOutConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSignOutConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>로그아웃 하시겠어요?</Text>
            <Text style={styles.confirmDesc}>다시 로그인해서 계속 사용할 수 있어요</Text>
            <View style={styles.confirmButtonRow}>
              <Pressable style={styles.confirmCancelButton} onPress={() => setShowSignOutConfirm(false)}>
                <Text style={styles.confirmCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={styles.confirmSignOutButton}
                onPress={() => {
                  setShowSignOutConfirm(false);
                  supabase.auth.signOut();
                }}>
                <Text style={styles.confirmSignOutText}>로그아웃</Text>
              </Pressable>
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
      paddingTop: 24,
      paddingBottom: 44,
    },
    navBoxOuter: {
      marginBottom: 24,
    },
    navBox: {
      padding: 0,
    },
    navBoxPressable: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    navBoxLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    navBoxText: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '700',
    },
    navBoxChevron: {
      fontSize: 20,
      opacity: 0.35,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 6,
    },
    sectionDesc: {
      fontSize: 13,
      opacity: 0.6,
      marginBottom: 16,
      lineHeight: 18,
    },
    accentSwatchRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      marginBottom: 24,
    },
    accentSwatchItem: {
      alignItems: 'center',
      gap: 6,
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
    accentSwatchLabel: {
      fontSize: 11,
      opacity: 0.6,
    },
    fontOptionRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 24,
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
    accountRow: {
      marginTop: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    accountEmail: {
      fontSize: 13,
      opacity: 0.6,
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
