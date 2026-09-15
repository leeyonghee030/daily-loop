import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text } from '@/components/Themed';
import { useAccentColor } from '@/lib/accent-color';
import { useTranslation } from '@/lib/language';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// "디카 감성" 실시간 미리보기 전용 축소 배율 — 카메라 프리뷰 자체를 화면의 1/2 크기로 작게
// 그리게 한 뒤 다시 화면 크기로 늘려서(transform scale) 보여준다. 화면에 원래 크기로 그리고
// CSS로만 흐리게 하는 게 아니라, 카메라가 애초에 낮은 해상도로 그리게 하는 것이라 실제로
// 뭉개져 보인다 — 찍기 전에도 결과물과 비슷한 느낌을 미리 볼 수 있다
const PREVIEW_DOWNSCALE = 2;

// 카메라 촬영을 위해 외부 카메라 앱으로 나갔다 돌아오면, 그 사이 우리 앱이 백그라운드로
// 밀려나면서 안드로이드(특히 삼성 배터리 관리 기능)가 프로세스를 강제 종료해 앱이 재시작되고
// 작업 중이던 캔버스가 날아가는 문제가 있었다(2026-09-12, adb logcat으로 원인 확정: SIGKILL).
// 외부 앱을 아예 열지 않고 화면 안에서 직접 촬영하면 이 배경전환 자체가 없어져서 근본적으로
// 해결된다 — 대신 기기 기본 카메라 앱의 고급 기능(야간모드 등)은 못 쓴다.
export function InAppCamera({
  visible,
  onClose,
  onCapture,
}: {
  visible: boolean;
  onClose: () => void;
  // vintage: 촬영 직전 고른 "디카 감성" 필터 적용 여부
  onCapture: (uri: string, vintage: boolean) => void;
}) {
  const accent = useAccentColor();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [vintage, setVintage] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [zoom, setZoom] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  // 핀치가 끝난 시점의 줌 값 — 다음 핀치가 이어서 그 값부터 계산하게 기준점으로 쓴다
  // (DraggableBlock의 baseScaleRef와 같은 패턴)
  const baseZoomRef = useRef(0);

  // 미리보기가 실제 촬영 결과보다 화질이 좋아 보일 수 있다는 걸 짧게만 알려주는 안내 —
  // 화면을 계속 가리면 촬영에 방해되니 1.2초만 보였다 사라진다
  const [showQualityHint, setShowQualityHint] = useState(false);
  const qualityHintOpacity = useSharedValue(0);
  const qualityHintAnimatedStyle = useAnimatedStyle(() => ({ opacity: qualityHintOpacity.value }));

  function selectVintageMode() {
    setVintage(true);
    setShowQualityHint(true);
    qualityHintOpacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(
        900,
        withTiming(0, { duration: 180 }, (finished) => {
          if (finished) runOnJS(setShowQualityHint)(false);
        })
      )
    );
  }

  function commitZoom(next: number) {
    baseZoomRef.current = next;
    setZoom(next);
  }

  const pinchZoom = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(1, Math.max(0, baseZoomRef.current + (e.scale - 1) * 0.5));
      runOnJS(setZoom)(next);
    })
    .onEnd((e) => {
      const next = Math.min(1, Math.max(0, baseZoomRef.current + (e.scale - 1) * 0.5));
      runOnJS(commitZoom)(next);
    });

  async function handleCapture() {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCapture(photo.uri, vintage);
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* RN Modal은 앱 루트(app/_layout.tsx)의 GestureHandlerRootView 밖에서 별도 네이티브
          화면으로 그려져서, 그 안에서는 react-native-gesture-handler 제스처가 인식되지 않는다
          (사진 위치 조정 모달에서 같은 문제를 겪었음) — 핀치 줌을 쓰려면 여기서도 한 번 더 감싸야 한다 */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <RNView style={styles.container}>
        {!permission ? (
          <RNView style={styles.centered}>
            <ActivityIndicator color="#fff" />
          </RNView>
        ) : !permission.granted ? (
          <RNView style={styles.centered}>
            <Text style={styles.permissionText}>{t('photoDiary.cameraPermissionDesc')}</Text>
            <AnimatedPressable style={[styles.permissionButton, { backgroundColor: accent }]} onPress={requestPermission}>
              <Text style={styles.permissionButtonText}>{t('photoDiary.permissionTitle')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.closeTextButton} onPress={onClose}>
              <Text style={styles.closeText}>{t('settings.cancel')}</Text>
            </AnimatedPressable>
          </RNView>
        ) : (
          <>
            <GestureDetector gesture={pinchZoom}>
              <RNView style={styles.cameraWrap}>
                <CameraView
                  ref={cameraRef}
                  style={
                    vintage
                      ? {
                          width: SCREEN_WIDTH / PREVIEW_DOWNSCALE,
                          height: SCREEN_HEIGHT / PREVIEW_DOWNSCALE,
                          transform: [{ scale: PREVIEW_DOWNSCALE }],
                        }
                      : StyleSheet.absoluteFill
                  }
                  facing={facing}
                  zoom={zoom}
                />
              </RNView>
            </GestureDetector>
            {/* "디카 감성" 모드일 때 실제 캔버스에 적용되는 것과 같은 톤 보정을 미리 보여준다 —
                촬영 파일 자체엔 안 찍히고(캔버스에서 별도로 합성), 찍기 전에 대략 어떤 느낌일지
                짐작할 수 있게 하는 용도. BlurView는 뒤 화면을 캡처해서 합성하는 방식이라 이
                미리보기에서도 같은 이유로 안 써야 안전하다(캔버스 쪽 VignetteOverlay 주석 참고) */}
            {vintage && (
              <RNView pointerEvents="none" style={StyleSheet.absoluteFill}>
                <RNView style={[StyleSheet.absoluteFill, styles.filterFadeLayer]} />
                <RNView style={[StyleSheet.absoluteFill, styles.filterCoolLayer]} />
              </RNView>
            )}
            <RNView style={styles.topBar}>
              <AnimatedPressable style={styles.topButton} onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={26} color="#fff" />
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.topButton}
                onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
                hitSlop={10}>
                <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
              </AnimatedPressable>
            </RNView>
            {showQualityHint && (
              <Animated.View style={[styles.qualityHint, qualityHintAnimatedStyle]} pointerEvents="none">
                <Text style={styles.qualityHintText}>{t('photoDiary.cameraVintagePreviewNotice')}</Text>
              </Animated.View>
            )}
            <RNView style={styles.bottomBar}>
              <RNView style={styles.modeRow}>
                <AnimatedPressable
                  style={[styles.modeChip, !vintage && { backgroundColor: accent }]}
                  onPress={() => setVintage(false)}>
                  <Text style={[styles.modeChipText, !vintage && styles.modeChipTextActive]}>
                    {t('photoDiary.cameraModeNormal')}
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.modeChip, vintage && { backgroundColor: accent }]}
                  onPress={selectVintageMode}>
                  <Text style={[styles.modeChipText, vintage && styles.modeChipTextActive]}>
                    {t('photoDiary.cameraModeVintage')}
                  </Text>
                </AnimatedPressable>
              </RNView>
              <AnimatedPressable style={styles.shutterOuter} onPress={handleCapture} disabled={isCapturing}>
                {isCapturing ? <ActivityIndicator color="#fff" /> : <RNView style={styles.shutterInner} />}
              </AnimatedPressable>
            </RNView>
          </>
        )}
      </RNView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  // 디카 감성 모드일 때 CameraView를 작게 그린 뒤 화면 크기로 늘리기 위한 틀 — 가운데
  // 정렬해야 transform scale이 중심을 기준으로 커지면서 화면 전체를 정확히 채운다
  cameraWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  permissionText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.85,
  },
  permissionButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  permissionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  closeTextButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  closeText: {
    color: '#fff',
    opacity: 0.6,
    fontSize: 13,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // "디카 감성" 선택 시 1.2초만 보였다 사라지는 안내 — 화면 시야를 너무 가리지 않게 상단
  // 버튼들 바로 아래, 작고 옅게
  qualityHint: {
    position: 'absolute',
    top: 116,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  qualityHintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeChip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modeChipText: {
    color: '#fff',
    opacity: 0.75,
    fontSize: 13,
    fontWeight: '600',
  },
  modeChipTextActive: {
    opacity: 1,
  },
  // 실제 캔버스 필터(RadialGradient 비네트 제외)와 같은 톤 — 라이브 프리뷰 전용
  filterFadeLayer: {
    backgroundColor: 'rgba(30, 32, 38, 0.14)',
  },
  filterCoolLayer: {
    backgroundColor: 'rgba(120, 170, 200, 0.06)',
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
});
