import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

// Alert.alert는 네이티브 모달이라 뜨고 닫힐 때 버벅이는 느낌이 있어서, 확인 버튼이 필요 없는
// 단순 결과 알림(적용/처리 완료 등)은 이 반투명 토스트로 대신 뜨고 자동으로 사라지게 한다.
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(text: string) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(text);
    opacity.stopAnimation();
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMessage(null));
    }, 900);
  }

  const toastNode =
    message !== null ? (
      <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
        <Text style={styles.toastText}>{message}</Text>
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
  toastText: {
    backgroundColor: 'rgba(30, 30, 30, 0.8)',
    color: '#fff',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
