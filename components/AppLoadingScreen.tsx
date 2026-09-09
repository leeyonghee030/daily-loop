import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 앱 로고와 같은 270도 파란 링은 고정해두고, 그 링의 경로 위로 짧은 주황색 구간만
// 처음부터 끝까지 훑고 지나간 뒤(파란 링을 벗어나지 않고 그 안에서만 움직임) 사라졌다가
// 다시 처음으로 돌아가는 클래식 로딩 스피너 느낌.
// 네이티브 스플래시(정지된 아이콘, 흰 배경)가 사라지는 순간 이 화면이 이어받기 때문에,
// 배경은 다크모드와 무관하게 항상 흰색으로 고정해야 전환이 끊겨 보이지 않는다.
const SIZE = 96;
const STROKE_WIDTH = 10;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 270 / 360;
const ARC_LENGTH = CIRCUMFERENCE * ARC_RATIO;
const RUNNER_LENGTH = ARC_LENGTH * 0.26; // 파란 링 길이 대비 주황 구간 비율
const TRAVEL_RANGE = ARC_LENGTH - RUNNER_LENGTH; // 주황 구간이 파란 링을 벗어나지 않는 최대 이동 거리

export function AppLoadingScreen() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // strokeDashoffset은 transform/opacity가 아니라 네이티브 드라이버 대상이 아니다
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const runnerOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -TRAVEL_RANGE] });

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        {/* 고정된 파란 270도 링 */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke="#3E6A9C"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          fill="none"
        />
        {/* 그 링 경로 위에서만 앞으로 훑고 지나가는 짧은 주황 구간 */}
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke="#FF7F66"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${RUNNER_LENGTH} ${CIRCUMFERENCE}`}
          strokeDashoffset={runnerOffset}
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
