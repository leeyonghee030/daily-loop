import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View as RNView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text } from '@/components/Themed';
import { useAccentColor } from '@/lib/accent-color';
import { useTranslation } from '@/lib/language';

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
  onCapture: (uri: string) => void;
}) {
  const accent = useAccentColor();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  async function handleCapture() {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
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
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
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
            <RNView style={styles.bottomBar}>
              <AnimatedPressable style={styles.shutterOuter} onPress={handleCapture} disabled={isCapturing}>
                {isCapturing ? <ActivityIndicator color="#fff" /> : <RNView style={styles.shutterInner} />}
              </AnimatedPressable>
            </RNView>
          </>
        )}
      </RNView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
