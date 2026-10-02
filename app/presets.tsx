import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { useToast } from '@/components/Toast';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { useAuth } from '@/lib/auth-context';
import { applyPreset, deletePreset, fetchPresets, type RoutinePreset } from '@/lib/presets';
import { pauseRoutinesByPreset, softDeleteRoutinesByPreset } from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

const REPEAT_LABEL_KEYS: Record<string, TranslationKey> = {
  daily: 'myRoutines.repeatDaily',
  weekday: 'myRoutines.repeatWeekday',
  weekend: 'myRoutines.repeatWeekend',
  custom: 'myRoutines.repeatCustom',
};

export default function PresetsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  const presetsQueryKey = ['presets', userId] as const;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutinePreset | null>(null);
  const { show: showToast, toastNode } = useToast();

  const presetsQuery = useQuery({
    queryKey: presetsQueryKey,
    queryFn: () => fetchPresets(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(presetsQuery.refetch, !!userId);
  const presets = presetsQuery.data ?? [];
  const errorMessage = presetsQuery.isError ? t('presets.errorLoad') : null;

  const applyMutation = useMutation({
    mutationFn: (preset: RoutinePreset) => applyPreset(userId!, preset.id),
    onSuccess: (count, preset) => {
      showToast(
        language === 'ko'
          ? `"${preset.name}" 모음집의 루틴 ${count}개를 오늘 목록에 반영했어요.`
          : `Applied ${count} routine(s) from "${preset.name}" to today's list.`
      );
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
      // "내 루틴" 화면의 전체 루틴 목록도 방금 새로 생긴 루틴을 반영하도록 같이 갱신한다 —
      // 안 그러면 그 화면이 이미 메모리에 살아있는 상태에서 focus 재조회 타이밍을 놓쳤을 때
      // 방금 적용한 루틴이 안 보이거나 개수가 어긋나 보일 수 있음
      queryClient.invalidateQueries({ queryKey: ['all-routines', userId] });
    },
    onError: () => showToast(t('presets.applyError')),
  });

  const deleteMutation = useMutation({
    mutationFn: async (preset: RoutinePreset) => {
      await softDeleteRoutinesByPreset(preset.id);
      await deletePreset(preset.id);
    },
    onSuccess: (_result, preset) => {
      queryClient.setQueryData(presetsQueryKey, (old?: RoutinePreset[]) =>
        old ? old.filter((p) => p.id !== preset.id) : old
      );
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
      queryClient.invalidateQueries({ queryKey: ['all-routines', userId] });
    },
    onError: () => showToast(t('presets.deleteError')),
  });

  const bulkPauseMutation = useMutation({
    mutationFn: ({ preset, paused }: { preset: RoutinePreset; paused: boolean }) =>
      pauseRoutinesByPreset(preset.id, paused),
    onSuccess: (_result, { preset, paused }) => {
      showToast(
        language === 'ko'
          ? paused
            ? `"${preset.name}"에서 만든 루틴을 모두 일시정지했어요.`
            : `"${preset.name}"에서 만든 루틴을 모두 다시 활성화했어요.`
          : paused
            ? `Paused all routines created from "${preset.name}".`
            : `Activated all routines created from "${preset.name}".`
      );
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
      queryClient.invalidateQueries({ queryKey: ['all-routines', userId] });
    },
    onError: () => showToast(t('presets.pauseError')),
  });

  async function handleApply(preset: RoutinePreset) {
    if (!userId) return;
    setBusyId(preset.id);
    try {
      await applyMutation.mutateAsync(preset);
    } catch {
      // onError에서 이미 토스트를 띄움
    } finally {
      setBusyId(null);
    }
  }

  // 네이티브 Alert → 다른 화면들(내 루틴/영상 카테고리/설정)과 같은 테마색 커스텀 모달로
  // 통일(2026-10-02) — 아래 deleteTarget 모달 참고
  function handleDelete(preset: RoutinePreset) {
    setDeleteTarget(preset);
  }

  async function performDelete(preset: RoutinePreset) {
    setDeleteTarget(null);
    setBusyId(preset.id);
    try {
      await deleteMutation.mutateAsync(preset);
    } catch {
      // onError에서 이미 토스트를 띄움
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkPause(preset: RoutinePreset, paused: boolean) {
    setBusyId(preset.id);
    try {
      await bulkPauseMutation.mutateAsync({ preset, paused });
    } catch {
      // onError에서 이미 토스트를 띄움
    } finally {
      setBusyId(null);
    }
  }

  if (presetsQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {toastNode}
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <AnimatedPressable style={styles.addButton} onPress={() => router.push('/preset-form')}>
          <Text style={styles.addButtonText}>{t('presets.newPreset')}</Text>
        </AnimatedPressable>

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        {presets.length === 0 && <Text style={styles.emptyText}>{t('presets.empty')}</Text>}

        {presets.map((preset) => (
          <ShadowCard key={preset.id} style={styles.cardOuter} contentStyle={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{preset.name}</Text>
              <Text style={styles.cardMeta}>
                {t(REPEAT_LABEL_KEYS[preset.repeat_type])}
                {preset.skip_holidays ? t('presets.skipHolidaysSuffix') : ''}
              </Text>
            </View>

            <View style={styles.cardActions}>
              <AnimatedPressable
                style={styles.applyButton}
                disabled={busyId === preset.id}
                onPress={() => handleApply(preset)}>
                <Text style={styles.applyButtonText}>{t('presets.applyToToday')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.editButton}
                onPress={() => router.push({ pathname: '/preset-form', params: { id: preset.id } })}>
                <Text style={styles.editButtonText}>{t('presets.edit')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.deleteButton}
                disabled={busyId === preset.id}
                onPress={() => handleDelete(preset)}>
                <Text style={styles.deleteButtonText}>{t('myRoutines.delete')}</Text>
              </AnimatedPressable>
            </View>

            <Text style={styles.bulkSectionLabel}>{t('presets.bulkManageLabel')}</Text>
            <View style={styles.cardActions}>
              <AnimatedPressable
                style={styles.bulkButton}
                disabled={busyId === preset.id}
                onPress={() => handleBulkPause(preset, true)}>
                <Text style={styles.bulkButtonText}>{t('presets.pauseAll')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.bulkButton}
                disabled={busyId === preset.id}
                onPress={() => handleBulkPause(preset, false)}>
                <Text style={styles.bulkButtonText}>{t('presets.activateAll')}</Text>
              </AnimatedPressable>
            </View>
          </ShadowCard>
        ))}
      </ScrollView>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setDeleteTarget(null)} />
          {deleteTarget && (
            <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{t('presets.deleteTitle')}</Text>
              <Text style={styles.confirmDesc}>
                {language === 'ko'
                  ? `"${deleteTarget.name}" 모음집과, 여기서 만들어진 루틴이 전부 삭제돼요. "내 루틴 → 루틴 복구"에서 2주 안에 되돌릴 수 있어요.`
                  : `"${deleteTarget.name}" and all routines created from it will be deleted. You can restore them within 2 weeks from "Routines → Routine Recovery".`}
              </Text>
              <View style={styles.confirmButtonRow}>
                <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setDeleteTarget(null)}>
                  <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.confirmDeleteButton} onPress={() => performDelete(deleteTarget)}>
                  <Text style={styles.confirmDeleteText}>{t('myRoutines.delete')}</Text>
                </AnimatedPressable>
              </View>
            </ShadowCard>
          )}
        </RNView>
      </Modal>
    </View>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  addButton: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 26,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: '#FF6B6B',
    marginBottom: 12,
  },
  emptyText: {
    opacity: 0.5,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 20,
  },
  cardOuter: {
    marginBottom: 12,
  },
  card: {
    padding: 16,
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16 + fontKorean.sizeAdjust,
    lineHeight: 21 + fontKorean.sizeAdjust,
    fontWeight: '600',
    fontFamily: fontKorean.fontFamily,
  },
  cardMeta: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 4,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  applyButton: {
    flex: 1,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 10,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  editButton: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingVertical: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 13,
  },
  // 오늘 탭 스와이프 "오늘삭제"와 같은 스타일(주색 꽉 채움)로 통일
  deleteButton: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  deleteButtonText: {
    fontSize: 13,
    color: '#fff',
  },
  bulkSectionLabel: {
    fontSize: 11,
    opacity: 0.45,
    marginTop: 14,
    marginBottom: 8,
  },
  bulkButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingVertical: 8,
    alignItems: 'center',
  },
  bulkButtonText: {
    fontSize: 12,
  },
  // 삭제 확인창 — 네이티브 Alert 대신 다른 화면들과 같은 테마색 커스텀 모달(2026-10-02)
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
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 18,
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
  confirmDeleteButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  confirmDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  });
}
