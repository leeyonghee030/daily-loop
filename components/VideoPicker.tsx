import { useMemo } from 'react';
import { Modal, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { CategoryVideoGrid } from '@/components/CategoryVideoGrid';
import { Text, View } from '@/components/Themed';
import { useAccentColor } from '@/lib/accent-color';
import { useTranslation } from '@/lib/language';
import type { Video } from '@/lib/videos';

export function VideoPicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (video: Video) => void;
}) {
  const accent = useAccentColor();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <RNView style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Ionicons name="film-outline" size={16} color={accent} />
              <Text style={styles.title}>{t('videoPicker.title')}</Text>
            </View>
            <AnimatedPressable onPress={onClose}>
              <Text style={styles.closeText}>{t('today.close')}</Text>
            </AnimatedPressable>
          </View>

          <CategoryVideoGrid
            onSelectVideo={(video) => {
              onSelect(video);
              onClose();
            }}
          />
        </View>
      </RNView>
    </Modal>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      height: '75%',
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
  });
}
