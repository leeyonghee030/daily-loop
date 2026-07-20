import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/Themed';

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: '#7C5CFC',
    borderColor: '#7C5CFC',
  },
  chipText: {
    fontSize: 14,
  },
  chipTextSelected: {
    color: '#fff',
  },
});
