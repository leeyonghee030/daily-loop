import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// 웹에는 진동 기능 자체가 없어서 호출하면 안 함 — expo-haptics도 네이티브 전용
function trigger(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  fn().catch(() => {});
}

export function hapticLight() {
  trigger(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// impactAsync(Light)보다도 더 약한 느낌 — 체크박스처럼 자주 누르는 사소한 토글에 사용
// (2026-09-27, "체크박스 진동이 조금 더 약하면 좋겠다" 피드백)
export function hapticSelection() {
  trigger(() => Haptics.selectionAsync());
}
