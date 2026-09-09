import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// 스트릭을 숫자 없이 "도형"만으로 보여주는 장식용 컴포넌트 — 로고와 같은 270도 호 자리에
// 작은 점들을 점묘법처럼 찍어서, 은은하게 숨쉬듯 밝아졌다 어두워지며 흐르는 느낌을 준다.
// 정확한 일수를 전달하는 용도가 아니라("모양만") 어디서나 크기만 바꿔서 재사용한다.
const ARC_DEGREES = 270;
const START_ANGLE_DEG = -225; // 아래쪽에 끊긴 부분이 오도록(로고와 동일한 방향)

const GRADIENT_START = { r: 0x3e, g: 0x6a, b: 0x9c }; // #3E6A9C, 아침 하늘색
const GRADIENT_END = { r: 0xff, g: 0x7f, b: 0x66 }; // #FF7F66, 노을 코랄

function lerpColor(t: number): string {
  const r = Math.round(GRADIENT_START.r + (GRADIENT_END.r - GRADIENT_START.r) * t);
  const g = Math.round(GRADIENT_START.g + (GRADIENT_END.g - GRADIENT_START.g) * t);
  const b = Math.round(GRADIENT_START.b + (GRADIENT_END.b - GRADIENT_START.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

type Props = {
  size?: number;
  dotCount?: number;
};

export function DottedStreakRing({ size = 64, dotCount = 14 }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  const radius = size / 2;
  const dotDiameter = Math.max(3, size * 0.1);
  const dotRadius = dotDiameter / 2;
  const ringRadius = radius - dotRadius - 1;

  const dots = Array.from({ length: dotCount }).map((_, i) => {
    const t = dotCount === 1 ? 0 : i / (dotCount - 1);
    const angleRad = ((START_ANGLE_DEG + t * ARC_DEGREES) * Math.PI) / 180;
    return {
      key: i,
      x: radius + ringRadius * Math.cos(angleRad) - dotRadius,
      y: radius + ringRadius * Math.sin(angleRad) - dotRadius,
      color: lerpColor(t),
    };
  });

  return (
    <Animated.View style={[styles.container, { width: size, height: size, opacity }]}>
      {dots.map((dot) => (
        <View
          key={dot.key}
          style={[
            styles.dot,
            { left: dot.x, top: dot.y, width: dotDiameter, height: dotDiameter, borderRadius: dotRadius, backgroundColor: dot.color },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  dot: {
    position: 'absolute',
  },
});
