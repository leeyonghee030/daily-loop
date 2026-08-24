import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { applyPreset, deletePreset, fetchPresets, type RoutinePreset } from '@/lib/presets';
import { pauseRoutinesByPreset, softDeleteRoutinesByPreset } from '@/lib/routines';

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

  const [presets, setPresets] = useState<RoutinePreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setPresets(await fetchPresets(userId));
    } catch (err) {
      setErrorMessage('모음집을 불러오지 못했어요.');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  async function handleApply(preset: RoutinePreset) {
    if (!userId) return;
    setBusyId(preset.id);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const count = await applyPreset(userId, preset.id);
      setStatusMessage(`"${preset.name}" 모음집의 루틴 ${count}개를 추가했어요.`);
    } catch (err) {
      setErrorMessage('적용에 실패했어요.');
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
            setErrorMessage(null);
            try {
              await softDeleteRoutinesByPreset(preset.id);
              await deletePreset(preset.id);
              setPresets((prev) => prev.filter((p) => p.id !== preset.id));
            } catch (err) {
              setErrorMessage('삭제에 실패했어요.');
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
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await pauseRoutinesByPreset(preset.id, paused);
      setStatusMessage(
        paused
          ? `"${preset.name}"에서 만든 루틴을 모두 일시정지했어요.`
          : `"${preset.name}"에서 만든 루틴을 모두 다시 활성화했어요.`
      );
    } catch (err) {
      setErrorMessage('처리에 실패했어요.');
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.addButton} onPress={() => router.push('/preset-form')}>
        <Text style={styles.addButtonText}>+ 새 모음집 만들기</Text>
      </Pressable>

      {statusMessage && <Text style={styles.status}>{statusMessage}</Text>}
      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {presets.length === 0 && (
        <Text style={styles.emptyText}>아직 만든 모음집이 없어요. 평일 일정, 주말, 학원처럼 자주 쓰는 루틴 묶음을 만들어보세요.</Text>
      )}

      {presets.map((preset) => (
        <View key={preset.id} style={styles.card}>
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
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  status: {
    color: '#7C5CFC',
    marginBottom: 12,
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
  card: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
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
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
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
    borderColor: '#ccc',
    borderRadius: 8,
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
    borderRadius: 8,
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
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  bulkButtonText: {
    fontSize: 12,
  },
});
