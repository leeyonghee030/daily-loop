import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// 앱 로고(270도 호 + 아침 하늘색→노을 코랄 그라데이션 링)를 그대로 다시 그린다.
// 링 자체는 스플래시 아이콘과 똑같이 고정해두고, 그 안의 그라데이션 색만 좌우로
// 흐르듯 움직여서 "돌아가는 스피너"가 아니라 "은은하게 빛나는" 느낌을 준다.
// 네이티브 스플래시(정지된 아이콘, 흰 배경)가 사라지는 순간 이 화면이 이어받기 때문에,
// 배경은 다크모드와 무관하게 항상 흰색으로 고정해야 전환이 끊겨 보이지 않는다.
const SIZE = 96;
const STROKE_WIDTH = 10;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 270 / 360;

export function AppLoadingScreen() {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shift, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(shift, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shift]);

  const x1 = shift.interpolate({ inputRange: [0, 1], outputRange: ['-20%', '80%'] });
  const x2 = shift.interpolate({ inputRange: [0, 1], outputRange: ['20%', '120%'] });

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <AnimatedLinearGradient id="loadingGrad" x1={x1} y1="0%" x2={x2} y2="100%">
            <Stop offset="0%" stopColor="#3E6A9C" />
            <Stop offset="100%" stopColor="#FF7F66" />
          </AnimatedLinearGradient>
        </Defs>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke="url(#loadingGrad)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
});
