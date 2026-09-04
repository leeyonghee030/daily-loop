import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CategoryVideoGrid } from '@/components/CategoryVideoGrid';
import { Text, View } from '@/components/Themed';
import { useAccentColor } from '@/lib/accent-color';
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
  const styles = useMemo(() => createStyles(accent), [accent]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <RNView style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Ionicons name="film-outline" size={16} color={accent} />
              <Text style={styles.title}>영상 연결</Text>
            </View>
            <Pressable onPress={onClose}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
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
