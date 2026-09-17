import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Alert.alert는 네이티브 모달이라 뜨고 닫힐 때 버벅이는 느낌이 있어서, 확인 버튼이 필요 없는
// 단순 결과 알림(적용/처리 완료 등)은 이 반투명 토스트로 대신 뜨고 자동으로 사라지게 한다.
// 이전 메시지가 아직 떠있는 동안 show()가 또 불리면 그냥 덮어써서 뒤 메시지가 통째로 씹혀
// 안 보이던 문제가 있었음 — 대기열에 쌓아뒀다가, 지금 뜬 메시지가 사라진 직후 순서대로 이어서 보여준다
type QueuedToast = { text: string; accentColor?: string };

export function useToast() {
  const [toast, setToast] = useState<QueuedToast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
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
    opacity.stopAnimation();
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
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
      <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
        <View style={[styles.toastBubble, toast.accentColor ? { borderLeftWidth: 3, borderLeftColor: toast.accentColor } : null]}>
          {toast.accentColor && <Ionicons name="checkmark-circle" size={16} color={toast.accentColor} style={styles.toastIcon} />}
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      </Animated.View>
    ) : null;

  return { show, toastNode };
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 24,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 999,
  },
  toastBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 30, 30, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  toastIcon: {
    marginRight: 6,
  },
  toastText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
});
