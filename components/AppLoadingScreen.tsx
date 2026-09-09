import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 실제 앱 아이콘(assets/images/icon.png)에서 픽셀을 직접 샘플링해 얻은 값으로 재현한다.
// 간격은 위쪽(약 262.5도에서 시작해 시계방향으로 290도), 색은 호의 양쪽 끝이 둘 다 옅은
// 하늘색이고 호의 중간(약 50~56%) 지점에서 코랄이 정점을 찍는 대칭 구조.
// 배경은 이 실제 색 그대로 고정. 그 위를 도는 하이라이트는 시작점→끝점까지 링 전체를
// 계속 돌되(범위를 임의로 자르지 않음), 지금 위치의 실제 색을 살짝 밝힌 색으로 스스로
// 바뀌면서 움직인다 — 파란 구간을 지날 땐 원래 색과 거의 비슷해 눈에 안 띄고, 코랄이
// 정점을 찍는 구간을 지날 때만 자연스럽게 밝아진다.
// 하이라이트의 폭 방향으로 여러 얇은 조각을 이어붙이고 각 조각의 투명도만 종 모양
// 곡선(가운데 진하고 양끝은 옅게)으로 배치해 앞뒤 끝이 부드럽게 사라지게 한다 —
// 조각들은 서로 겹치지 않고 이어붙는 것이라 반투명을 겹쳤을 때처럼 알파가 누적돼
// 하얗게 뭉치는 문제가 없다(objectBoundingBox 그라데이션은 원 전체 기준이라 이렇게
// 짧은 호 하나에는 제대로 안 먹혀서 대신 이 방식을 쓴다).
// 네이티브 스플래시(정지된 아이콘, 흰 배경)가 사라지는 순간 이 화면이 이어받기 때문에,
// 배경은 다크모드와 무관하게 항상 흰색으로 고정해야 전환이 끊겨 보이지 않는다.
const SIZE = 96;
const STROKE_WIDTH = 20;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_DEGREES = 290; // 아이콘에서 실측한 값
const ARC_LENGTH = CIRCUMFERENCE * (ARC_DEGREES / 360);
const START_ANGLE_DEG = 262.5; // 아이콘에서 실측한 시작각
const HIGHLIGHT_WIDTH = ARC_LENGTH * 0.22;
const HIGHLIGHT_LIGHTEN = 0.16; // 아이콘 원색에 가깝게, 살짝만 밝힘
const HIGHLIGHT_SUBSEGS = 13; // 하이라이트 폭을 이만큼 잘게 나눠 종 모양 투명도를 입힌다

// 아이콘에서 실측한 색 — 호 길이 기준 0%/25%/50%/75%/100% 지점의 실제 색
// 양 끝(0%/100%)은 실측 당시 둥근 캡 끝부분이라 배경 흰색과 살짝 섞여있었던 값이라,
// 한쪽만 튀어 보이지 않도록 같은 값으로 맞춰 대칭시킨다
const COLOR_STOPS: { t: number; r: number; g: number; b: number }[] = [
  { t: 0, r: 0xb9, g: 0xd0, b: 0xe7 },
  { t: 0.25, r: 0x83, g: 0x98, b: 0xc3 },
  { t: 0.5, r: 0xd1, g: 0x90, b: 0x7d },
  { t: 0.75, r: 0x8f, g: 0x85, b: 0xb1 },
  { t: 1, r: 0xb9, g: 0xd0, b: 0xe7 },
];

function colorAt(t: number, lighten = 0): { r: number; g: number; b: number } {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const local = (t - a.t) / (b.t - a.t);
      const r = a.r + (b.r - a.r) * local;
      const g = a.g + (b.g - a.g) * local;
      const bl = a.b + (b.b - a.b) * local;
      return {
        r: Math.round(r + (255 - r) * lighten),
        g: Math.round(g + (255 - g) * lighten),
        b: Math.round(bl + (255 - bl) * lighten),
      };
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  return { r: last.r, g: last.g, b: last.b };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 호를 아주 짧은 조각으로 나눠 각 조각에 그 위치의 실측 색을 입힌다(경로를 따르는
// 그라데이션 효과). 조각 수를 넉넉히 잡아서 이음새(각진 경계)가 안 보이게 한다
const SEGMENT_COUNT = 200;

// 양 끝을 원형 캡(단색 반원이든, 원형 그라데이션 점이든)으로 마감하면 결국 "덧붙인 점"
// 처럼 보여 옆 그라데이션과 이질감이 생긴다 — 대신 끝으로 갈수록 두께 자체를 점점
// 가늘게 좁혀서 자연스러운 뾰족한 끝으로 사라지게 한다(붓이 떼어지는 느낌). 색은 그대로
// 그 위치의 실측 값이라 이질감이 생길 여지 자체가 없다.
const TAPER_FRACTION = 0.12; // 양 끝 이 비율(호 길이 기준)만큼 두께가 점점 얇아짐
const TAPER_MIN_WIDTH_FRAC = 0.06; // 맨 끝에서도 완전히 0은 아니게 최소 두께 유지

export function AppLoadingScreen() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // strokeDashoffset/색은 transform이 아니라 네이티브 드라이버 대상이 아니다.
    // 왕복(ping-pong)이 아니라 시작점에서 끝점까지 한 방향으로 계속 흐르다 끝나면
    // 처음으로 순간이동하는 톱니파(sawtooth) 방식
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: false })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const segments = useMemo(() => {
    const segLen = ARC_LENGTH / SEGMENT_COUNT;
    return Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
      const t = (i + 0.5) / SEGMENT_COUNT;
      let widthFactor = 1;
      if (t < TAPER_FRACTION) {
        widthFactor = t / TAPER_FRACTION;
      } else if (t > 1 - TAPER_FRACTION) {
        widthFactor = (1 - t) / TAPER_FRACTION;
      }
      return {
        key: i,
        offset: -(i * segLen),
        length: segLen,
        color: toHex(colorAt(t)),
        strokeWidth: STROKE_WIDTH * Math.max(widthFactor, TAPER_MIN_WIDTH_FRAC),
      };
    });
  }, []);

  // 하이라이트 색 — 지금 위치(t)의 실제 색을 살짝 밝힌 색으로, 위치와 함께 계속 바뀐다.
  // 모든 조각이 같은 순간엔 같은 색을 공유한다(조각마다 다른 건 투명도뿐)
  const highlightColor = progress.interpolate({
    inputRange: COLOR_STOPS.map((s) => s.t),
    outputRange: COLOR_STOPS.map((s) => toHex(colorAt(s.t, HIGHLIGHT_LIGHTEN))),
  });

  // 시작점/끝점에서 순간이동하는 게 안 보이도록 그 찰나에만 살짝 옅어진다
  const edgeFade = progress.interpolate({
    inputRange: [0, 0.03, 0.97, 1],
    outputRange: [0, 1, 1, 0],
  });

  const subSegWidth = HIGHLIGHT_WIDTH / HIGHLIGHT_SUBSEGS;
  const highlightSubSegs = Array.from({ length: HIGHLIGHT_SUBSEGS }).map((_, j) => {
    // 조각 중심이 하이라이트 폭 안에서 어디쯤인지(0~1) — 종 모양 투명도 계산용
    const localT = (j + 0.5) / HIGHLIGHT_SUBSEGS;
    const opacityMult = Math.sin(Math.PI * localT); // 가운데(0.5) 진하고 양끝(0,1) 옅음
    // 이 조각의 offset 상수항 — progress에 -ARC_LENGTH를 곱한 값만 더하면 위치가 나옴
    const constant = subSegWidth / 2 + HIGHLIGHT_WIDTH / 2 - (j + 0.5) * subSegWidth;
    const offset = progress.interpolate({ inputRange: [0, 1], outputRange: [constant, constant - ARC_LENGTH] });
    return { key: j, offset, opacityMult };
  });

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        {segments.map((seg) => (
          <Circle
            key={seg.key}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={seg.color}
            strokeWidth={seg.strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={`${seg.length + 0.6} ${CIRCUMFERENCE}`}
            strokeDashoffset={seg.offset}
            fill="none"
            transform={`rotate(${START_ANGLE_DEG} ${SIZE / 2} ${SIZE / 2})`}
          />
        ))}
        {/* 지금 위치의 실제 색을 밝힌 채로 링 전체를 도는 하이라이트 — 종 모양 투명도로
            앞뒤 끝이 부드럽게 사라져서 경계 없이 자연스럽게 나타났다 사라진다 */}
        {highlightSubSegs.map((sub) => (
          <AnimatedCircle
            key={sub.key}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={highlightColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="butt"
            strokeDasharray={`${subSegWidth + 0.6} ${CIRCUMFERENCE}`}
            strokeDashoffset={sub.offset}
            fill="none"
            opacity={Animated.multiply(edgeFade, sub.opacityMult)}
            transform={`rotate(${START_ANGLE_DEG} ${SIZE / 2} ${SIZE / 2})`}
          />
        ))}
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
