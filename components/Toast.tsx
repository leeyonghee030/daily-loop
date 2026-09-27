import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { useKoreanFont } from '@/lib/korean-font';

// Alert.alert는 네이티브 모달이라 뜨고 닫힐 때 버벅이는 느낌이 있어서, 확인 버튼이 필요 없는
// 단순 결과 알림(적용/처리 완료 등)은 이 반투명 토스트로 대신 뜨고 자동으로 사라지게 한다.
// 이전 메시지가 아직 떠있는 동안 show()가 또 불리면 그냥 덮어써서 뒤 메시지가 통째로 씹혀
// 안 보이던 문제가 있었음 — 대기열에 쌓아뒀다가, 지금 뜬 메시지가 사라진 직후 순서대로 이어서 보여준다
// 디자인은 "내 루틴" 실행취소 토스트(UndoToast.tsx)와 통일(2026-09-27) — 유리질감 블러+흰
// 그림자 카드로, 같은 top 오프셋(70) 사용
// ⚠️ 처음엔 그림자(elevation)가 있는 바깥 껍데기까지 통째로 opacity 애니메이션을 걸었더니,
// 안드로이드에서 나타날 때 검은 화면+흰 박스가 잠깐 비치고 사라질 때도 지지직거리는 버그가
// 있었다(2026-09-27) — UndoToast가 이미 겪고 고쳤던 것과 같은 원인(그림자와 opacity 애니메이션을
// 같은 레이어에 같이 주면 안드로이드가 그림자를 따로 그려서 어긋나 보임). 그림자 껍데기(아래
// toastBubbleShadow)는 애니메이션 없이 고정하고, 블러+글자만 담은 안쪽 레이어에서만 페이드시킨다
type QueuedToast = { text: string; accentColor?: string };

export function useToast() {
  const koreanFont = useKoreanFont();
  const [toast, setToast] = useState<QueuedToast | null>(null);
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<QueuedToast[]>([]);
  const isShowingRef = useRef(false);

  function playNext() {
    const next = queueRef.current.shift();
    if (next === undefined) {
      isShowingRef.current = false;
      return;
    }
    isShowingRef.current = true;
    setToast(next);
    contentOpacity.stopAnimation();
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(contentOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setToast(null);
        playNext();
      });
    }, 2200);
  }

  // accentColor를 주면(예: 저장 완료처럼 "잘 됐다"는 의미의 알림) 체크 아이콘과 왼쪽 줄을
  // 그 색으로 강조해서 보여준다 — 안 주면 기존처럼 무채색 톤 그대로
  function show(text: string, accentColor?: string) {
    queueRef.current.push({ text, accentColor });
    if (!isShowingRef.current) playNext();
  }

  const toastNode =
    toast !== null ? (
      <View pointerEvents="none" style={styles.toast}>
        <View style={styles.toastBubbleShadow}>
          <Animated.View style={{ opacity: contentOpacity }}>
            <BlurView intensity={40} tint="light" style={styles.toastBubble}>
              <Text
                style={[
                  styles.toastText,
                  toast.accentColor ? { color: toast.accentColor } : null,
                  { fontFamily: koreanFont.fontFamily },
                ]}
                numberOfLines={2}>
                {toast.text}
              </Text>
            </BlurView>
          </Animated.View>
        </View>
      </View>
    ) : null;

  return { show, toastNode };
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 999,
  },
  // 그림자 전용 바깥 껍데기 — UndoToast/ShadowCard와 같은 이유로 블러/모서리 담당 View와 분리
  toastBubbleShadow: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  toastBubble: {
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  toastText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '400',
    textAlign: 'center',
  },
});
