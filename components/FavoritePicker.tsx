import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, View } from '@/components/Themed';
import { accent, border } from '@/constants/theme';
import type { Favorite } from '@/lib/favorites';
import { SLOT_LABELS, type Slot } from '@/lib/routines';

function favoriteSummary(favorite: Favorite, slots: Slot[]): string {
  if (favorite.is_instant && favorite.scheduled_time_start) {
    return favorite.scheduled_time_start.slice(0, 5);
  }
  if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
    return `${favorite.scheduled_time_start.slice(0, 5)}-${favorite.scheduled_time_end.slice(0, 5)}`;
  }
  const slot = slots.find((s) => s.id === favorite.slot_id);
  return slot ? SLOT_LABELS[slot.slot_type] : '';
}

export function FavoritePicker({
  visible,
  onClose,
  favorites,
  slots,
  renderActions,
}: {
  visible: boolean;
  onClose: () => void;
  favorites: Favorite[];
  slots: Slot[];
  renderActions: (favorite: Favorite) => ReactNode;
}) {
  const router = useRouter();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <RNView style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>⭐ 즐겨찾기</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list}>
            {favorites.length === 0 && (
              <Text style={styles.emptyText}>저장된 즐겨찾기가 없어요. 아래 "즐겨찾기 관리"에서 만들어보세요.</Text>
            )}
            {favorites.map((favorite) => (
              <View key={favorite.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{favorite.title}</Text>
                  <Text style={styles.rowMeta}>
                    {favoriteSummary(favorite, slots)}
                    {favorite.block_type === 'tracking' ? ` · ${favorite.tracking_unit}` : ''}
                    {favorite.is_required ? ' · 필수' : ''}
                  </Text>
                </View>
                <View style={styles.rowActions}>{renderActions(favorite)}</View>
              </View>
            ))}
          </ScrollView>

          <Pressable
            style={styles.manageButton}
            onPress={() => {
              onClose();
              router.push('/favorites');
            }}>
            <Text style={styles.manageButtonText}>즐겨찾기 관리</Text>
          </Pressable>
        </View>
      </RNView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeText: {
    color: accent,
    fontSize: 14,
  },
  list: {
    marginBottom: 12,
  },
  emptyText: {
    opacity: 0.5,
    textAlign: 'center',
    marginVertical: 24,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: border,
    gap: 10,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowMeta: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 6,
  },
  manageButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  manageButtonText: {
    color: accent,
    fontSize: 13,
  },
});
