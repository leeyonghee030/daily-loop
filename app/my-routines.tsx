import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet } from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  fetchAllRoutines,
  softDeleteRoutine,
  updateSortOrder,
  SLOT_LABELS,
  type RepeatType,
  type Routine,
} from '@/lib/routines';

type FilterValue = RepeatType | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'daily', label: '매일' },
  { value: 'weekday', label: '평일' },
  { value: 'weekend', label: '주말' },
  { value: 'custom', label: '특정 요일' },
  { value: 'once', label: '1회성' },
];

const REPEAT_LABELS: Record<RepeatType, string> = {
  daily: '매일',
  weekday: '평일',
  weekend: '주말',
  custom: '특정 요일',
  once: '1회성',
};

function timeLabel(routine: Routine): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '시간 미지정';
}

export default function MyRoutinesScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const data = await fetchAllRoutines(userId);
      setRoutines(data);
    } catch {
      setErrorMessage('루틴을 불러오지 못했어요.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = filter === 'all' ? routines : routines.filter((r) => r.repeat_type === filter);

  // 필터된 부분만 새 순서로 바뀌고, 필터에 안 걸린 나머지 루틴은 원래 위치 그대로 유지
  function handleDragEnd(newFilteredOrder: Routine[]) {
    const filteredIds = new Set(filtered.map((r) => r.id));
    let cursor = 0;
    const merged = routines.map((r) => (filteredIds.has(r.id) ? newFilteredOrder[cursor++] : r));
    setRoutines(merged);
    updateSortOrder(merged.map((r) => r.id)).catch(() => load());
  }

  function handleDelete(routine: Routine) {
    Alert.alert('루틴을 삭제할까요?', `"${routine.title}"에 해당하는 모든 예정이 삭제돼요. 완료 기록은 남아있어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteRoutine(routine.id);
            setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
          } catch {
            setErrorMessage('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>내 루틴</Text>
        <Text style={styles.subtitle}>오늘 예정 여부와 상관없이 전체 루틴을 보고 수정할 수 있어요</Text>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
        data={FILTERS}
        keyExtractor={(item) => item.value}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
            onPress={() => setFilter(item.value)}>
            <Text style={[styles.filterChipText, filter === item.value && styles.filterChipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {filtered.length > 1 && <Text style={styles.dragHint}>≡ 를 길게 눌러 순서를 바꿀 수 있어요</Text>}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <DraggableFlatList
          key={filter}
          style={styles.list}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          data={filtered}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data }) => handleDragEnd(data)}
          ListEmptyComponent={<Text style={styles.emptyText}>해당하는 루틴이 없어요</Text>}
          renderItem={({ item, drag, isActive }: RenderItemParams<Routine>) => (
            <View style={[styles.row, isActive && styles.rowActive]}>
              <Text style={styles.dragHandle}>≡</Text>
              <Pressable
                style={styles.rowMain}
                onPress={() => router.push({ pathname: '/routine-form', params: { id: item.id } })}
                onLongPress={drag}
                disabled={isActive}>
                <Text style={styles.rowTitle}>
                  {item.title}
                  {item.is_required ? ' · 필수' : ''}
                </Text>
                <Text style={styles.rowMeta}>
                  {REPEAT_LABELS[item.repeat_type]} · {timeLabel(item)}
                </Text>
              </Pressable>
              <Pressable style={styles.deleteButton} onPress={() => handleDelete(item)} hitSlop={8}>
                <Text style={styles.deleteButtonText}>삭제</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
    lineHeight: 16,
  },
  filterRow: {
    flexGrow: 0,
    marginBottom: 12,
  },
  filterRowContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: '#7C5CFC',
  },
  filterChipText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  dragHint: {
    fontSize: 11,
    opacity: 0.45,
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  error: {
    color: '#FF6B6B',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowMeta: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
  },
  rowActive: {
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
  },
  dragHandle: {
    fontSize: 18,
    opacity: 0.35,
    paddingHorizontal: 4,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: {
    fontSize: 12,
    color: '#FF6B6B',
    fontWeight: '600',
  },
});
