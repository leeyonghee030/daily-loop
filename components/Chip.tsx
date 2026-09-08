import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text } from '@/components/Themed';
import { border } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const accent = useAccentColor();
  const styles = useMemo(() => createStyles(accent), [accent]);
  return (
    <AnimatedPressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </AnimatedPressable>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    chip: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    chipSelected: {
      backgroundColor: accent,
      borderColor: accent,
    },
    chipText: {
      fontSize: 14,
    },
    chipTextSelected: {
      color: '#fff',
    },
  });
}
