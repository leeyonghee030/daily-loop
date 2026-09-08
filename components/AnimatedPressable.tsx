import { useRef } from 'react';
import { Animated, Easing, Pressable, type GestureResponderEvent, type PressableProps } from 'react-native';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

// iOS 네이티브 버튼처럼 누르는 순간 살짝 작아지고(스케일) 투명해졌다가(투명도), 떼면 원래대로
// 튕겨 돌아오는 눌림 피드백. Pressable을 감싸는 별도 View를 두지 않고 Pressable 자체를 애니메이션
// 컴포넌트로 만들어서, style에 준 flex 등 레이아웃 속성이 기존 Pressable과 동일하게 적용된다.
// 스케일은 직선적인 timing 대신 spring을 써서 딱딱 끊기지 않고 탄력있게 움직이게 한다.
export function AnimatedPressable({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  function handlePressIn(e: GestureResponderEvent) {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 4 }),
      Animated.timing(opacity, { toValue: 0.7, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    onPressIn?.(e);
  }

  function handlePressOut(e: GestureResponderEvent) {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    onPressOut?.(e);
  }

  return (
    <AnimatedPressableBase
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style as object, { transform: [{ scale }], opacity }]}
      {...props}
    />
  );
}
