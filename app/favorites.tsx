import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { deleteFavorite, fetchFavorites, type Favorite } from '@/lib/favorites';
import { fetchSlots, SLOT_LABELS, type Slot } from '@/lib/routines';

function favoriteSummary(favorite: Favorite, slots: Slot[]): string {
  if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
    return `${favorite.scheduled_time_start.slice(0, 5)}-${favorite.scheduled_time_end.slice(0, 5)}`;
  }
  const slot = slots.find((s) => s.id === favorite.slot_id);
  return slot ? SLOT_LABELS[slot.slot_type] : '';
}

export default function FavoritesScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();

  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [fetchedFavorites, fetchedSlots] = await Promise.all([
        fetchFavorites(userId),
        fetchSlots(userId),
      ]);
      setFavorites(fetchedFavorites);
      setSlots(fetchedSlots);
    } catch (err) {
      setErrorMessage('즐겨찾기를 불러오지 못했어요.');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  async function handleDelete(favorite: Favorite) {
    setBusyId(favorite.id);
    try {
      await deleteFavorite(favorite.id);
      setFavorites((prev) => prev.filter((f) => f.id !== favorite.id));
    } catch (err) {
      setErrorMessage('삭제에 실패했어요.');
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

  const checkFavorites = favorites.filter((f) => f.block_type === 'check');
  const trackingFavorites = favorites.filter((f) => f.block_type === 'tracking');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.addButton} onPress={() => router.push('/favorite-form')}>
        <Text style={styles.addButtonText}>+ 즐겨찾기 추가</Text>
      </Pressable>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {favorites.length === 0 && (
        <Text style={styles.emptyText}>자주 쓰는 루틴을 즐겨찾기로 저장해두면, 루틴 추가나 모음집 만들 때 바로 불러올 수 있어요.</Text>
      )}

      {checkFavorites.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>✓ 체크형</Text>
          {checkFavorites.map((favorite) => (
            <FavoriteRow
              key={favorite.id}
              favorite={favorite}
              slots={slots}
              busy={busyId === favorite.id}
              onEdit={() => router.push({ pathname: '/favorite-form', params: { id: favorite.id } })}
              onDelete={() => handleDelete(favorite)}
            />
          ))}
        </>
      )}

      {trackingFavorites.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>🔢 트래킹형</Text>
          {trackingFavorites.map((favorite) => (
            <FavoriteRow
              key={favorite.id}
              favorite={favorite}
              slots={slots}
              busy={busyId === favorite.id}
              onEdit={() => router.push({ pathname: '/favorite-form', params: { id: favorite.id } })}
              onDelete={() => handleDelete(favorite)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function FavoriteRow({
  favorite,
  slots,
  busy,
  onEdit,
  onDelete,
}: {
  favorite: Favorite;
  slots: Slot[];
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>
          {favorite.title}
          {favorite.is_required ? ' · 필수' : ''}
        </Text>
        <Text style={styles.cardMeta}>
          {favoriteSummary(favorite, slots)}
          {favorite.block_type === 'tracking' ? ` · ${favorite.tracking_unit}` : ''}
        </Text>
      </View>
      <View style={styles.cardActions}>
        <Pressable style={styles.editButton} onPress={onEdit}>
          <Text style={styles.editButtonText}>수정</Text>
        </Pressable>
        <Pressable style={styles.deleteButton} disabled={busy} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>삭제</Text>
        </Pressable>
      </View>
    </View>
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
  sectionLabel: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
  },
  cardMeta: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  editButtonText: {
    fontSize: 13,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    fontSize: 13,
    color: '#FF6B6B',
  },
});
