import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { border } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import type { Favorite } from '@/lib/favorites';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { SLOT_LABEL_KEYS, type Slot } from '@/lib/routines';

function favoriteSummary(favorite: Favorite, slots: Slot[], t: (key: TranslationKey) => string): string {
  if (favorite.is_instant && favorite.scheduled_time_start) {
    return favorite.scheduled_time_start.slice(0, 5);
  }
  if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
    return `${favorite.scheduled_time_start.slice(0, 5)}-${favorite.scheduled_time_end.slice(0, 5)}`;
  }
  const slot = slots.find((s) => s.id === favorite.slot_id);
  return slot ? t(SLOT_LABEL_KEYS[slot.slot_type]) : '';
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
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <RNView style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Ionicons name="star-outline" size={16} color={accent} />
              <Text style={styles.title}>{t('favoritePicker.title')}</Text>
            </View>
            <AnimatedPressable onPress={onClose}>
              <Text style={styles.closeText}>{t('today.close')}</Text>
            </AnimatedPressable>
          </View>

          <ScrollView style={styles.list}>
            {favorites.length === 0 && <Text style={styles.emptyText}>{t('favoritePicker.empty')}</Text>}
            {favorites.map((favorite) => (
              <View key={favorite.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{favorite.title}</Text>
                  <Text style={styles.rowMeta}>
                    {favoriteSummary(favorite, slots, t)}
                    {favorite.block_type === 'tracking' ? ` · ${favorite.tracking_unit}` : ''}
                    {favorite.is_required ? t('myRoutines.requiredSuffix') : ''}
                  </Text>
                </View>
                <View style={styles.rowActions}>{renderActions(favorite)}</View>
              </View>
            ))}
          </ScrollView>

          <AnimatedPressable
            style={styles.manageButton}
            onPress={() => {
              onClose();
              router.push('/favorites');
            }}>
            <Text style={styles.manageButtonText}>{t('favoritePicker.manage')}</Text>
          </AnimatedPressable>
        </View>
      </RNView>
    </Modal>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    fontSize: 15 + fontKorean.sizeAdjust,
    lineHeight: 20 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
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
}
