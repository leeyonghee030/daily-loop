import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { useToast } from '@/components/Toast';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useAuth } from '@/lib/auth-context';
import { applyPreset, deletePreset, fetchPresets, type RoutinePreset } from '@/lib/presets';
import { pauseRoutinesByPreset, softDeleteRoutinesByPreset } from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

const REPEAT_LABELS: Record<string, string> = {
  daily: '매일',
  weekday: '평일',
  weekend: '주말',
  custom: '특정 요일',
};

export default function PresetsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  const presetsQueryKey = ['presets', userId] as const;

  const [busyId, setBusyId] = useState<string | null>(null);
  const { show: showToast, toastNode } = useToast();

  const presetsQuery = useQuery({
    queryKey: presetsQueryKey,
    queryFn: () => fetchPresets(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(presetsQuery.refetch);
  const presets = presetsQuery.data ?? [];
  const errorMessage = presetsQuery.isError ? '모음집을 불러오지 못했어요.' : null;

  const applyMutation = useMutation({
    mutationFn: (preset: RoutinePreset) => applyPreset(userId!, preset.id),
    onSuccess: (count, preset) => {
      showToast(`"${preset.name}" 모음집의 루틴 ${count}개를 오늘 목록에 반영했어요.`);
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
      // "내 루틴" 화면의 전체 루틴 목록도 방금 새로 생긴 루틴을 반영하도록 같이 갱신한다 —
      // 안 그러면 그 화면이 이미 메모리에 살아있는 상태에서 focus 재조회 타이밍을 놓쳤을 때
      // 방금 적용한 루틴이 안 보이거나 개수가 어긋나 보일 수 있음
      queryClient.invalidateQueries({ queryKey: ['all-routines', userId] });
    },
    onError: () => showToast('적용에 실패했어요. 다시 시도해주세요.'),
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
    onError: () => showToast('삭제에 실패했어요. 다시 시도해주세요.'),
  });

  const bulkPauseMutation = useMutation({
    mutationFn: ({ preset, paused }: { preset: RoutinePreset; paused: boolean }) =>
      pauseRoutinesByPreset(preset.id, paused),
    onSuccess: (_result, { preset, paused }) => {
      showToast(
        paused
          ? `"${preset.name}"에서 만든 루틴을 모두 일시정지했어요.`
          : `"${preset.name}"에서 만든 루틴을 모두 다시 활성화했어요.`
      );
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
      queryClient.invalidateQueries({ queryKey: ['all-routines', userId] });
    },
    onError: () => showToast('처리에 실패했어요. 다시 시도해주세요.'),
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

  function handleDelete(preset: RoutinePreset) {
    Alert.alert(
      '모음집을 삭제할까요?',
      `"${preset.name}" 모음집과, 여기서 만들어진 루틴이 전부 삭제돼요. "내 루틴 → 루틴 복구"에서 2주 안에 되돌릴 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            setBusyId(preset.id);
            try {
              await deleteMutation.mutateAsync(preset);
            } catch {
              // onError에서 이미 토스트를 띄움
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
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
        <Pressable style={styles.addButton} onPress={() => router.push('/preset-form')}>
          <Text style={styles.addButtonText}>+ 새 모음집 만들기</Text>
        </Pressable>

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        {presets.length === 0 && (
          <Text style={styles.emptyText}>아직 만든 모음집이 없어요. 평일 일정, 주말, 학원처럼 자주 쓰는 루틴 묶음을 만들어보세요.</Text>
        )}

        {presets.map((preset) => (
          <ShadowCard key={preset.id} style={styles.cardOuter} contentStyle={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{preset.name}</Text>
              <Text style={styles.cardMeta}>
                {REPEAT_LABELS[preset.repeat_type]}
                {preset.skip_holidays ? ' · 공휴일 제외' : ''}
              </Text>
            </View>

            <View style={styles.cardActions}>
              <Pressable
                style={styles.applyButton}
                disabled={busyId === preset.id}
                onPress={() => handleApply(preset)}>
                <Text style={styles.applyButtonText}>오늘 목록에 적용</Text>
              </Pressable>
              <Pressable
                style={styles.editButton}
                onPress={() => router.push({ pathname: '/preset-form', params: { id: preset.id } })}>
                <Text style={styles.editButtonText}>수정</Text>
              </Pressable>
              <Pressable
                style={styles.deleteButton}
                disabled={busyId === preset.id}
                onPress={() => handleDelete(preset)}>
                <Text style={styles.deleteButtonText}>삭제</Text>
              </Pressable>
            </View>

            <Text style={styles.bulkSectionLabel}>이 모음집으로 만든 루틴 일괄 관리</Text>
            <View style={styles.cardActions}>
              <Pressable
                style={styles.bulkButton}
                disabled={busyId === preset.id}
                onPress={() => handleBulkPause(preset, true)}>
                <Text style={styles.bulkButtonText}>전체 비활성화</Text>
              </Pressable>
              <Pressable
                style={styles.bulkButton}
                disabled={busyId === preset.id}
                onPress={() => handleBulkPause(preset, false)}>
                <Text style={styles.bulkButtonText}>전체 활성화</Text>
              </Pressable>
            </View>
          </ShadowCard>
        ))}
      </ScrollView>
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
    marginBottom: 16,
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
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: cardRadius,
    paddingVertical: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  deleteButtonText: {
    fontSize: 13,
    color: '#FF6B6B',
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
  });
}
