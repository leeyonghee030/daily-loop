import { useEffect } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';

// 안드로이드 기본 Switch 대체 — 네이티브 Switch는 토글될 때 번지는 원형 터치 피드백(리플)이
// 트랙 바깥으로 삐져나와, 옆의 흰 배경에 반쪽만 걸쳐 보이는 시각 버그가 있었다(루틴 추가 화면의
// "필수"/"공휴일 제외" 토글, 2026-10-07). 사진일기 화면(photo-diary-form.tsx)에서 같은 이유로
// 이미 쓰던 트랙+손잡이 디자인(안드로이드 Switch 모양을 흉내낸 것)을 재사용 가능한 공용
// 컴포넌트로 뺐다.
const TRACK_WIDTH = 36;
const TRACK_HEIGHT = 14;
const THUMB = 22;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB;

export function CustomSwitch({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const accent = useAccentColor();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(value ? 1 : 0, { duration: 150 });
  }, [value, on]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * THUMB_TRAVEL }],
  }));

  return (
    <AnimatedPressable onPress={() => onValueChange(!value)} hitSlop={8} style={styles.touchArea}>
      <RNView style={[styles.track, { backgroundColor: value ? withAlpha(accent, 0.5) : '#ccc' }]} />
      <Animated.View style={[styles.thumb, { backgroundColor: value ? accent : '#f4f3f4' }, thumbStyle]} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    width: TRACK_WIDTH,
    height: THUMB,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignSelf: 'center',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
