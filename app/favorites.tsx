import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { deleteFavorite, fetchFavorites, type Favorite } from '@/lib/favorites';
import { fetchSlots, SLOT_LABEL_KEYS, type Slot } from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

function favoriteSummary(favorite: Favorite, slots: Slot[], t: (key: TranslationKey) => string): string {
  if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
    return `${favorite.scheduled_time_start.slice(0, 5)}-${favorite.scheduled_time_end.slice(0, 5)}`;
  }
  const slot = slots.find((s) => s.id === favorite.slot_id);
  return slot ? t(SLOT_LABEL_KEYS[slot.slot_type]) : '';
}

export default function FavoritesScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  // 즐겨찾기/모음집 폼 등 여러 화면이 fetchSlots(userId)를 똑같이 부르므로, 쿼리 키를
  // 'slots'로 통일해서 어느 화면에서 먼저 받아오든 서로 캐시를 공유하게 한다
  const favoritesQueryKey = ['favorites', userId] as const;
  const slotsQueryKey = ['slots', userId] as const;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const favoritesQuery = useQuery({
    queryKey: favoritesQueryKey,
    queryFn: () => fetchFavorites(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(favoritesQuery.refetch, !!userId);

  const slotsQuery = useQuery({
    queryKey: slotsQueryKey,
    queryFn: () => fetchSlots(userId!),
    enabled: !!userId,
  });

  const favorites = favoritesQuery.data ?? [];
  const slots = slotsQuery.data ?? [];

  const deleteFavoriteMutation = useMutation({
    mutationFn: (favorite: Favorite) => deleteFavorite(favorite.id),
    onSuccess: (_result, favorite) => {
      queryClient.setQueryData(favoritesQueryKey, (old?: Favorite[]) =>
        old ? old.filter((f) => f.id !== favorite.id) : old
      );
    },
    onError: () => setErrorMessage(t('favorites.errorDelete')),
  });

  async function handleDelete(favorite: Favorite) {
    setBusyId(favorite.id);
    try {
      await deleteFavoriteMutation.mutateAsync(favorite);
    } catch {
      // onError에서 이미 에러 메시지를 채움
    } finally {
      setBusyId(null);
    }
  }

  if (favoritesQuery.isLoading || slotsQuery.isLoading) {
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
      <AnimatedPressable style={styles.addButton} onPress={() => router.push('/favorite-form')}>
        <Text style={styles.addButtonText}>{t('favorites.addFavorite')}</Text>
      </AnimatedPressable>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {favorites.length === 0 && <Text style={styles.emptyText}>{t('favorites.empty')}</Text>}

      {checkFavorites.length > 0 && (
        <>
          <View style={styles.sectionLabelRow}>
            <Ionicons name="checkmark-circle-outline" size={13} color={textMuted} />
            <Text style={styles.sectionLabel}>{t('favorites.sectionCheck')}</Text>
          </View>
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
          <View style={styles.sectionLabelRow}>
            <Ionicons name="stats-chart-outline" size={13} color={textMuted} />
            <Text style={styles.sectionLabel}>{t('favorites.sectionTracking')}</Text>
          </View>
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
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  return (
    <ShadowCard style={styles.cardOuter} contentStyle={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>
          {favorite.title}
          {favorite.is_required ? t('myRoutines.requiredSuffix') : ''}
        </Text>
        <Text style={styles.cardMeta}>
          {favoriteSummary(favorite, slots, t)}
          {favorite.block_type === 'tracking' ? ` · ${favorite.tracking_unit}` : ''}
        </Text>
      </View>
      <View style={styles.cardActions}>
        <AnimatedPressable style={styles.editButton} onPress={onEdit}>
          <Text style={styles.editButtonText}>{t('presets.edit')}</Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.deleteButton} disabled={busy} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>{t('myRoutines.delete')}</Text>
        </AnimatedPressable>
      </View>
    </ShadowCard>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
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
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    opacity: 0.6,
  },
  cardOuter: {
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    gap: 10,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15 + fontKorean.sizeAdjust,
    lineHeight: 20 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
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
    borderColor: border,
    borderRadius: cardRadius,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  editButtonText: {
    fontSize: 13,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: cardRadius,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    fontSize: 13,
    color: '#FF6B6B',
  },
  });
}
