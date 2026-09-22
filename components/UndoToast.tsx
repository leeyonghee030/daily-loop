import { useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { AnimatedPressable } from './AnimatedPressable';
import { useKoreanFont } from '@/lib/korean-font';

// 삭제 확인창 대신 쓰는 "실행취소" 토스트(2026-09-22) — 곧바로 지워버리지 않고, 이 토스트가
// 떠 있는 동안(UNDO_DURATION_MS)은 실제 삭제를 미뤄둔다. 그동안 "실행취소"를 누르면 삭제가
// 아예 없었던 일이 되고(서버에 지운 적이 없으니 되돌릴 것도 없음), 그냥 두면 시간이 지나서
// onExpire가 실제 삭제를 수행한다. 연속으로 여러 개를 지우면 이전 토스트는 그 즉시
// 확정(onExpire)시키고 새 토스트로 넘어간다 — 두 개의 "실행취소"가 동시에 떠 있는 혼란을 방지
const UNDO_DURATION_MS = 4000;

type PendingUndo = {
  onUndo: () => void;
  onExpire: () => void;
  timer: ReturnType<typeof setTimeout>;
};

export function useUndoToast() {
  const koreanFont = useKoreanFont();
  const [visible, setVisible] = useState<{ message: string; accentColor: string; undoLabel: string } | null>(null);
  // ⚠️ 그림자가 있는 View(bubbleShadow) 자체의 opacity를 애니메이션하면 안드로이드에서
  // elevation(그림자)이 같이 안 옅어지고 먼저/나중에 따로 그려져서 "그림자만 있는 빈 박스"가
  // 잠깐 보이는 버그가 있었다(2026-09-22) — 그래서 바깥(wrap)은 위치 이동(translateY)만
  // 맡고, "은은하게 색이 옅어지며 사라지는" 페이드는 그림자가 없는 안쪽(contentOpacity,
  // BlurView를 감싸는 별도 레이어)에만 줘서 같은 버그 없이 슬라이드+페이드를 같이 낸다.
  // ⚠️ 처음엔 이동은 spring, 페이드는 timing으로 서로 다른 방식을 섞었는데, spring은 끝나는
  // 시점이 물리 계산에 따라 들쭉날쭉해서 "글자(페이드)는 먼저 끝나고 흰 박스(이동)만 그
  // 자리에 남아있다가 사라지는" 어긋남이 있었다(2026-09-22) — 이동도 timing으로 바꿔서
  // 페이드와 정확히 같은 시간에 같이 끝나게 맞췄지만, 그래도 -80px로는 박스(카드) 높이를
  // 포함한 실제 크기가 화면 위로 완전히 빠져나가기 전에 사라져서(top:70에서 -80만큼만
  // 이동하면 박스 아래쪽이 아직 화면 안에 남아있음) 사라지는 순간 흰 배경이 잠깐 "뚝"
  // 끊기듯 보였다 — 박스가 화면 밖으로 완전히 나갈 만큼(top+박스 높이보다 크게) 이동
  // 거리를 넉넉히 늘려서(-80→-150) 화면에서 다 빠져나간 뒤에 없어지게 했다
  const translateY = useRef(new Animated.Value(-150)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const pendingRef = useRef<PendingUndo | null>(null);

  function hide() {
    // 위로 슬라이드되면서 동시에 옅어지도록 두 애니메이션을 정확히 같은 시간(duration)으로
    // 같이 재생한다(2026-09-22) — 지속시간이 같아야 정확히 같은 순간에 같이 끝난다
    Animated.parallel([
      Animated.timing(translateY, { toValue: -150, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 0, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => setVisible(null));
  }

  function commitPending() {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    pending.onExpire();
  }

  function showUndoToast(options: {
    message: string;
    accentColor: string;
    undoLabel: string;
    onUndo: () => void;
    onExpire: () => void;
  }) {
    // 이미 떠 있는 실행취소가 있으면 그건 지금 바로 확정시키고 새 걸 띄운다
    commitPending();

    const timer = setTimeout(() => {
      pendingRef.current = null;
      hide();
      options.onExpire();
    }, UNDO_DURATION_MS);
    pendingRef.current = { onUndo: options.onUndo, onExpire: options.onExpire, timer };
    setVisible({ message: options.message, accentColor: options.accentColor, undoLabel: options.undoLabel });
    translateY.stopAnimation();
    contentOpacity.stopAnimation();
    // 나타날 때는 화면 밖까지 멀리서 올 필요 없이 살짝 위에서 내려오는 정도로 충분해서,
    // 사라질 때(-150, 화면을 완전히 벗어나야 함)와는 다르게 짧은 거리(-30)에서 시작한다
    translateY.setValue(-30);
    contentOpacity.setValue(1);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
  }

  function handleUndoPress() {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    hide();
    pending.onUndo();
  }

  const undoToastNode =
    visible !== null ? (
      <Animated.View pointerEvents="box-none" style={[styles.wrap, { transform: [{ translateY }] }]}>
        {/* 같은 View에 그림자+모서리를 같이 주면 안드로이드에서 그림자가 안 그려지는
            문제(ShadowCard와 동일한 이유)라 그림자 전용 바깥 껍데기와 블러+내용 담당
            안쪽을 분리한다. 배경을 완전한 흰색 대신 BlurView로 바꿔서 뒤에 있는 화면이
            살짝 비쳐 보이는 유리 같은 느낌을 낸다(2026-09-22, "아이폰 느낌"의 반투명 요청) —
            65는 덜 비쳐 보인다는 피드백으로 40까지 낮춤(더 투명하게) */}
        <View style={styles.bubbleShadow}>
          {/* 그림자가 없는 이 레이어에서만 페이드시켜서(contentOpacity) 위 그림자 버그를
              안 건드리고 "슬라이드되며 옅어지는" 느낌을 낸다 */}
          <Animated.View style={{ opacity: contentOpacity }}>
            <BlurView intensity={40} tint="light" style={styles.bubble}>
              <Text style={[styles.message, { fontFamily: koreanFont.fontFamily }]} numberOfLines={1}>
                {visible.message}
              </Text>
              <AnimatedPressable onPress={handleUndoPress} hitSlop={8} style={styles.undoButton}>
                <Text style={[styles.undoText, { color: visible.accentColor, fontFamily: koreanFont.fontFamily }]}>
                  {visible.undoLabel}
                </Text>
              </AnimatedPressable>
            </BlurView>
          </Animated.View>
        </View>
      </Animated.View>
    ) : null;

  return { showUndoToast, undoToastNode };
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    // 헤더 버튼들과 겹쳐 보인다는 피드백으로 좀 더 아래로 내림(2026-09-22)
    top: 70,
    alignItems: 'center',
    zIndex: 999,
  },
  // 그림자 전용 바깥 껍데기 — ShadowCard와 같은 이유로 블러/모서리 담당 View와 분리
  bubbleShadow: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  // 테두리와 쓰레기통 아이콘은 지저분해 보인다는 피드백(2026-09-22)으로 없애고 그림자만으로
  // 카드 느낌을 낸다. overflow:'hidden'으로 블러가 둥근 모서리 밖으로 안 새어나가게 한다
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  message: {
    color: '#333',
    fontSize: 15,
    fontWeight: '400',
    flexShrink: 1,
    marginRight: 12,
  },
  undoButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  undoText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
