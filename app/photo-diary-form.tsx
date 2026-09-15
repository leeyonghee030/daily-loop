import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import ViewShot, { captureRef } from 'react-native-view-shot';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// 일반 RN ScrollView는 react-native-gesture-handler로 만든 블록(드래그/핀치)과 같은 화면에
// 있으면 터치 우선권 협상 체계가 서로 달라서 스크롤이 자꾸 끊기는 문제가 있었음 — 같은
// 라이브러리의 ScrollView로 바꾸면 제스처 인식이 한 시스템 안에서 정리돼서 훨씬 안정적으로 동작한다
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { InAppCamera } from '@/components/InAppCamera';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted, withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import {
  deletePhotoDiary,
  fetchPhotoDiary,
  savePhotoDiary,
  uploadPhotoDiaryPhoto,
  type CanvasBlock,
  type PhotoDiary,
  type PhotoDiaryMode,
  type PhotoSource,
  type TextColorMode,
} from '@/lib/photo-diary';
import { fetchRoutinesForDate, type Routine } from '@/lib/routines';

// "루틴 고르기" 모드의 자유 캔버스 크기 — 화면 좌우 padding(20+20)을 뺀 너비에서 한 번 더
// 줄여서, 캔버스 바깥(=제스처가 안 걸린 순수 여백)이 좌우로 넉넉히 남게 한다. 캔버스가 화면
// 폭을 거의 다 채우면 스크롤을 시작하려고 아무 데나 눌러도 블록의 제스처 인식 영역에 자꾸
// 걸려서 스크롤이 잘 안 먹는 문제가 있었음 — 캔버스를 줄이고 중앙 정렬해서 해결
const CANVAS_WIDTH = Math.round((Dimensions.get('window').width - 40) * 0.82);
const CANVAS_PHOTO_HEIGHT = Math.round(CANVAS_WIDTH * (3 / 4));
// "루틴 고르기" 캔버스 안의 사진 블록은 캔버스 전체 폭보다 살짝 작게 시작해서, 사진 바깥으로
// 스와이프하면 확실히 스크롤이 되는 여유 공간이 항상 보이게 한다
const PHOTO_BLOCK_WIDTH = Math.round(CANVAS_WIDTH * 0.86);
const PHOTO_BLOCK_HEIGHT = Math.round(PHOTO_BLOCK_WIDTH * (3 / 4));
const ROUTINE_ROW_HEIGHT = 44;
// 루틴 칩을 왼쪽에 한 줄로만 쌓으면 개수가 많을 때 고정된 캔버스 높이를 넘어가서 화면 밖으로
// 잘리고 클릭도 안 되는 문제가 있었음 — 왼쪽/오른쪽 2열로 나눠 배치해서 같은 개수를 절반 높이로 담는다
const CANVAS_SIDE_MARGIN = 16;
const ROUTINE_COL_GAP = 12;
const ROUTINE_COL_WIDTH = (CANVAS_WIDTH - CANVAS_SIDE_MARGIN * 2 - ROUTINE_COL_GAP) / 2;
const ROUTINE_COL_X = [CANVAS_SIDE_MARGIN, CANVAS_SIDE_MARGIN + ROUTINE_COL_WIDTH + ROUTINE_COL_GAP];
// 루틴이 아무리 많아도 사진 위에는 처음부터 이 개수까지만 자동으로 올리고, 그 이상은 "담지
// 않은 루틴" 목록으로 보내서 사용자가 원하는 것만 "다시 추가"로 골라 담게 한다 — 완전히
// 무제한으로 다 올리면 캔버스가 한없이 길어지고 사진 느낌 자체가 사라지지만, 보통의 하루
// 루틴 개수(10개 안팎)는 여유 있게 다 들어가도록 넉넉하게 잡는다
const MAX_AUTO_ROUTINE_BLOCKS = 10;

let blockIdSeq = 0;
function nextBlockId(): string {
  blockIdSeq += 1;
  return `blk-${Date.now()}-${blockIdSeq}`;
}

// 사진(로컬)이 아직 업로드 전인지 판별 — expo-image-picker 결과는 iOS/Android 둘 다
// file:// 또는 content://(안드로이드 일부 갤러리) 스킴을 쓰고, 업로드 후 받는 공개 URL은
// https://라서 이걸로 구분한다
function isLocalUri(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://');
}

function resolveTextColor(mode: TextColorMode, accent: string): string {
  if (mode === 'white') return '#ffffff';
  if (mode === 'accent') return accent;
  return '#1a1a1a';
}

// 서버에 저장된 사진일기 한 건을 캔버스 블록 배열로 변환 — "기존 값으로 화면 채우기"
// (최초 로드)와 "임시저장 삭제(마지막 저장 상태로 되돌리기)" 둘 다에서 같은 로직을 쓴다.
// 일기적기(text) 모드가 자유 캔버스로 바뀌기 전(옛 버전)에 저장된 항목은 blocks 없이
// content(큰 글상자 텍스트)만 있으므로, 그 글을 메모 블록 하나로 변환해 캔버스에 얹어준다
function buildBlocksFromEntry(entry: PhotoDiary, routineById: Map<string, Routine>): CanvasBlock[] {
  const filteredBlocks = (entry.blocks ?? []).filter((b) => (b.type === 'routine' ? routineById.has(b.routineId) : true));
  const withPhoto = filteredBlocks.some((b) => b.type === 'photo')
    ? filteredBlocks
    : [
        { id: nextBlockId(), type: 'photo' as const, uri: entry.photo_url, source: entry.photo_source, x: 0, y: 0, scale: 1 },
        ...filteredBlocks,
      ];
  if (entry.mode === 'text' && entry.content && !withPhoto.some((b) => b.type === 'text')) {
    return [...withPhoto, { id: nextBlockId(), type: 'text', text: entry.content, x: 24, y: CANVAS_PHOTO_HEIGHT + 40 }];
  }
  return withPhoto;
}

// 화면에 그리는 순서(겹침) 전용 우선순위 — 낮을수록 아래에 깔린다
function blockLayer(b: CanvasBlock): number {
  if (b.type === 'photo') return b.pasted ? 1 : 0;
  if (b.type === 'routine') return 2;
  return b.pasted ? 1 : 3;
}

// 블록 하나의 실제 렌더링 크기(x,y와 같은 좌표계, scale=1 기준) — onLayout으로 측정해서 채운다.
// 루틴 칩처럼 글자 수에 따라 폭이 들쭉날쭉한 블록은 "칸이 차지할 수 있는 최대 크기"로
// 근사하면 왼쪽/오른쪽 경계 판정이 비대칭으로 어긋나는 문제가 있어서, 실측값을 쓴다
type BlockSize = { width: number; height: number };

// 블록이 캔버스 경계 밖으로 얼마나 나갔는지 넓이 기준으로 계산 — 두 사각형의 겹치는 넓이를
// 실제 블록 넓이로 나눠서 "보이는 비율"을 구하고, threshold(기본 20%) 미만으로 보이면
// "대부분 밖으로 나갔다"로 판정한다. 가로/세로, 왼쪽/오른쪽/위/아래 전부 같은 기준으로 대칭 처리됨
function isMostlyOutsideCanvas(
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number,
  visibleThreshold = 0.2
): boolean {
  if (width <= 0 || height <= 0) return false;
  const overlapWidth = Math.max(0, Math.min(x + width, canvasWidth) - Math.max(x, 0));
  const overlapHeight = Math.max(0, Math.min(y + height, canvasHeight) - Math.max(y, 0));
  const visibleFraction = (overlapWidth * overlapHeight) / (width * height);
  return visibleFraction < visibleThreshold;
}

const DRAG_HOLD_MS = 150;
// 너무 작아지면 삭제 배지를 누르거나 다시 확대하기 어려워진다는 피드백으로 0.4 → 0.55로 올림
const MIN_BLOCK_SCALE = 0.55;
const MAX_BLOCK_SCALE = 2.2;
// 선택된 블록의 핀치 인식 영역을 실제 크기보다 넓혀주는 여백 — 작은 칩/메모 위에 정확히 두
// 손가락을 올리기 어렵다는 피드백으로 기존 24 → 44 → 56으로 계속 넓힘(선택된 블록에만
// 적용되므로 다른 블록의 터치에는 영향 없음)
const PINCH_HIT_SLOP = 56;
// 사진 블록의 가로/세로 각각 허용 범위(px) — 기존 균등 확대/축소 배율 범위를 그대로 픽셀로 환산
const MIN_PHOTO_WIDTH = Math.round(PHOTO_BLOCK_WIDTH * MIN_BLOCK_SCALE);
const MIN_PHOTO_HEIGHT = Math.round(PHOTO_BLOCK_HEIGHT * MIN_BLOCK_SCALE);
const MAX_PHOTO_WIDTH = Math.round(PHOTO_BLOCK_WIDTH * MAX_BLOCK_SCALE);
const MAX_PHOTO_HEIGHT = Math.round(PHOTO_BLOCK_HEIGHT * MAX_BLOCK_SCALE);
// 모서리 크기조절 손잡이의 터치 아이콘 크기 — 손가락으로 정확히 맞추기 어렵다는 피드백으로
// 26 → 32로 키우고, 아래 hitSlop으로 눈에 보이는 크기보다 더 넓게 인식되게 한다
const RESIZE_HANDLE_SIZE = 32;
// 손잡이 아이콘 자체보다 터치 인식 영역을 사방으로 더 넓혀준다(선택된 블록에만 적용되므로
// 다른 블록/스크롤 인식에는 영향 없음) — PINCH_HIT_SLOP과 같은 목적
const RESIZE_HANDLE_HIT_SLOP = 22;
// 회전 손잡이 — 크기/인식범위는 리사이즈 손잡이와 통일. 가로로 끈 픽셀만큼 각도(도)로
// 바꾸는 민감도(절대 좌표 기준 각도 계산은 스크롤 오프셋 등 때문에 불안정해서, 리사이즈
// 손잡이와 같은 방식으로 "드래그량 → 값 변화"를 직접 매핑하는 단순한 방식을 택함)
const ROTATE_HANDLE_SIZE = 32;
const ROTATE_HANDLE_HIT_SLOP = 22;
const ROTATE_SENSITIVITY = 0.6;
// 완전히 거꾸로 뒤집히면 오히려 어색해 보여서, 스크랩북처럼 살짝 기울어지는 정도로 제한
const MAX_ROTATION_DEG = 35;
// 사진 더블탭(위치 조정 화면 열기) 판정 간격
const PHOTO_DOUBLE_TAP_MS = 300;
// "루틴 색 강조" 토글 — 예전 네이티브 Switch(안드로이드 스타일: 얇은 선 위에 동그란 손잡이가
// 겹쳐서 움직이는 모양)를 흉내낸 커스텀 트랙+손잡이 크기. 손잡이가 선보다 두꺼워서 위아래로
// 살짝 튀어나오게 겹친다
const ROUTINE_SWITCH_TRACK_WIDTH = 36;
const ROUTINE_SWITCH_TRACK_HEIGHT = 14;
const ROUTINE_SWITCH_THUMB = 22;
const ROUTINE_SWITCH_THUMB_TRAVEL = ROUTINE_SWITCH_TRACK_WIDTH - ROUTINE_SWITCH_THUMB;
// 사진일기 사용법을 처음 한 번만 자동으로 띄웠는지 기록하는 기기 저장 키(계정 구분 없음 —
// 다른 "한 번만 보여주는 안내" 문구들과 같은 방식)
const PHOTO_DIARY_HELP_SEEN_KEY = 'photo-diary-help-seen';

// 사진 블록의 "지금 렌더링 크기"를 계산 — 가로/세로를 손잡이로 따로 조절한 적이 있으면 그
// 값을 쓰고, 아직 없으면(예전 데이터 포함) 균등 확대/축소 배율(scale)로부터 기본 크기를 계산한다
function photoBlockSize(block: Extract<CanvasBlock, { type: 'photo' }>): BlockSize {
  if (block.width && block.height) return { width: block.width, height: block.height };
  const scale = block.scale ?? 1;
  return { width: PHOTO_BLOCK_WIDTH * scale, height: PHOTO_BLOCK_HEIGHT * scale };
}

// 사진 위치 조정 화면에서 프레임(픽셀)이 너무 작아지지 않게 하는 최소 크기
const MIN_FRAME_PX = 40;
// 위치 조정을 한 번도 안 해본 사진은 프레임을 처음부터 꽉 찬 크기로 두면, 팬(이동) 가능
// 범위가 한쪽 축이라도 0이 돼서(특히 사진 비율과 목표 박스 비율이 비슷하면 양쪽 다) 드래그해도
// 전혀 안 움직이는 것처럼 보인다 — 처음엔 살짝 여유를 두고 시작해서 바로 드래그가 되는 걸
// 보여주고, 필요하면 손잡이로 다시 꽉 찬 크기(전체 사진)까지 늘릴 수 있게 한다
const DEFAULT_FOCAL_EDIT_SCALE = 0.85;
// 사진 블록에 저장된 crop(cropX/Y/W/H, 원본 이미지 기준 0~1 정규화 사각형)을 실제 이미지
// 스타일로 변환. 퍼센트 단위라 사진 박스의 실제 픽셀 크기와 무관하게 항상 부모(박스)를
// 기준으로 정확히 맞는다. cropW/H가 없으면(위치 조정을 한 번도 안 한 사진) 그냥
// resizeMode="cover" 기본 동작 그대로 둔다(예전과 완전히 동일하게 보임).
// ⚠️ cropW:cropH는 항상 이 사진 블록의 width:height와 같은 비율이어야 왜곡 없이 나온다 —
// updateBlockCrop/updateBlockSize가 이 불변조건을 유지한다
function cropToImageStyle(cropX?: number, cropY?: number, cropW?: number, cropH?: number) {
  if (!cropW || !cropH) return { width: '100%' as const, height: '100%' as const };
  const w = Math.max(0.02, Math.min(1, cropW));
  const h = Math.max(0.02, Math.min(1, cropH));
  const x = cropX ?? 0;
  const y = cropY ?? 0;
  return {
    position: 'absolute' as const,
    width: `${(1 / w) * 100}%` as const,
    height: `${(1 / h) * 100}%` as const,
    left: `${(-x / w) * 100}%` as const,
    top: `${(-y / h) * 100}%` as const,
  };
}

// 자유 캔버스 위 블록 하나를 드래그로 옮기거나 두 손가락으로 확대/축소할 수 있게 감싸는 컴포넌트.
// 예전엔 PanResponder(구형 API)로 직접 구현했는데, ScrollView와 제스처 우선순위를 안정적으로
// 조율하지 못해서 스크롤이 계속 끊기거나 반대로 드래그/핀치가 안 먹는 문제가 반복됐다.
// react-native-gesture-handler는 이런 "스크롤 vs 드래그" 충돌을 위해 만들어진 라이브러리라
// 이걸로 교체 — Pan은 "누른 자리에 150ms 이상 가만히 있어야"(activateAfterLongPress) 활성화되고,
// 그 전에 손가락이 움직이면 제스처가 자동으로 실패 처리되면서 바깥 ScrollView가 정상적으로
// 스크롤을 이어받는다(라이브러리가 이 네고시에이션을 직접 관리해줌).
// 핀치는 블록을 먼저 선택(탭)했을 때만 켜진다 — 항상 켜두면 손가락 2개로 훑을 때마다 작은
// 칩들 위에서 오작동/스크롤 방해가 생겨서, "선택 후에만 확대/축소" 규칙으로 단순화했다.
function DraggableBlock({
  x,
  y,
  scale = 1,
  width,
  height,
  rotation = 0,
  rotatable = false,
  sizeMode = 'transform',
  minSize,
  maxSize,
  handleColor = '#888',
  pinchEnabled = true,
  onMove,
  onScale,
  onResize,
  onRotate,
  onLayoutSize,
  onTap,
  children,
}: {
  x: number;
  y: number;
  scale?: number;
  // sizeMode가 'box'일 때만 쓰는 실제 렌더링 크기(px) — CSS scale 대신 실제 폭/높이를 바꿔서
  // Image의 resizeMode:cover가 다른 영역을 보여주게 한다(자르기 효과), 가로/세로 독립 조절용
  width?: number;
  height?: number;
  // 기울인 각도(도, 시계방향 양수)
  rotation?: number;
  // true면 회전 가능 — 사진(box 모드)은 선택 시 왼쪽 아래 모서리에 전용 손잡이를 보여주고,
  // 루틴/메모(transform 모드)는 손잡이 없이 두 손가락 확대/축소 제스처에 회전을 같이 얹는다
  rotatable?: boolean;
  // 'transform'(기본): 기존처럼 CSS scale로 균등 확대/축소(가로세로 비율 고정) — 루틴칩/메모가 사용
  // 'box': 실제 폭/높이 스타일을 직접 바꿔서 가로/세로를 독립적으로 조절할 수 있음 — 사진 전용
  sizeMode?: 'transform' | 'box';
  minSize?: BlockSize;
  maxSize?: BlockSize;
  handleColor?: string;
  pinchEnabled?: boolean;
  onMove: (x: number, y: number, scale?: number) => void;
  onScale?: (scale: number) => void;
  // sizeMode가 'box'일 때 핀치(균등)나 모서리 손잡이(개별)로 크기가 바뀐 뒤 호출됨
  onResize?: (width: number, height: number) => void;
  // 회전 손잡이를 놓았을 때 새 각도(도)와 함께 호출됨
  onRotate?: (rotation: number) => void;
  onLayoutSize?: (size: BlockSize) => void;
  // 메모(텍스트) 블록의 탭 처리 전용 — RN 기본 Pressable로 하면 두 손가락 중 하나를 그
  // 터치 responder가 먼저 채가서 Pinch가 두 손가락을 잘 못 알아채는 문제가 있어서, 같은
  // gesture-handler 안에서 탭까지 함께 처리한다(넘겨줄 때만 Race에 포함시켜 사진/루틴
  // 블록의 기존 Pressable 기반 탭은 그대로 둔다)
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const isBoxMode = sizeMode === 'box';
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const gestureScale = useSharedValue(1);
  const baseScaleRef = useRef(scale);
  baseScaleRef.current = scale;

  const rotationLive = useSharedValue(rotation);
  const baseRotationRef = useRef(rotation);
  baseRotationRef.current = rotation;
  useEffect(() => {
    rotationLive.value = rotation;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation]);

  const boxW = useSharedValue(width ?? 0);
  const boxH = useSharedValue(height ?? 0);
  const baseWidthRef = useRef(width ?? 0);
  const baseHeightRef = useRef(height ?? 0);
  baseWidthRef.current = width ?? 0;
  baseHeightRef.current = height ?? 0;
  useEffect(() => {
    if (!isBoxMode) return;
    boxW.value = width ?? 0;
    boxH.value = height ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBoxMode, width, height]);

  const minW = minSize?.width ?? 0;
  const minH = minSize?.height ?? 0;
  const maxW = maxSize?.width ?? Number.MAX_SAFE_INTEGER;
  const maxH = maxSize?.height ?? Number.MAX_SAFE_INTEGER;

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activateAfterLongPress(DRAG_HOLD_MS)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onMove)(x + e.translationX, y + e.translationY);
      translateX.value = 0;
      translateY.value = 0;
    });

  // 확대/축소하면서 두 손가락째로 위치도 같이 옮기고 싶다는 요청 — 예전엔 두 손가락의
  // 중심점이 움직인 만큼을 직접 계산해서 더했는데, 뷰 자신이 그 계산으로 움직이면 다음
  // 프레임엔 "뷰 기준 상대좌표"가 어긋나 서로 되먹임(feedback)이 생겨 손을 뗀 자리로
  // 튕기는 것처럼 보이는 버그가 있었다. 이번엔 별도의 "두 손가락 전용 Pan"을 만들어 Pinch와
  // 동시에(Simultaneous) 켜서, 이동은 Pan 고유의 안정적인 translationX/Y(제스처 시작점
  // 기준 절대값이라 되먹임이 없음)만 쓰고, Pinch는 순수하게 배율만 담당하도록 역할을 분리했다.
  // sizeMode가 'box'(사진)일 땐 크기 조절이 핀치(균등)와 모서리 손잡이(개별) 두 갈래라 손을
  // 뗀 위치 보정이 더 복잡해지므로, 이동은 한 손가락 드래그로만 하도록 단순화하고 이 제스처는 끈다
  const twoFingerPan = Gesture.Pan()
    .enabled(pinchEnabled && !isBoxMode)
    .minPointers(2)
    .maxPointers(2)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      // 이 순간 화면에 보이는 배율(baseScaleRef * gestureScale)을 같이 넘겨줘야, 경계
      // 계산(onMove)이 아직 리렌더 전이라 옛 값을 들고 있는 scale prop 대신 정확한 최신
      // 크기로 안전 위치를 계산한다(안 그러면 축소 직후 위치 보정이 엉뚱하게 튀는 버그가 재발함)
      const liveScale = baseScaleRef.current * gestureScale.value;
      runOnJS(onMove)(x + e.translationX, y + e.translationY, liveScale);
      translateX.value = 0;
      translateY.value = 0;
    });

  const pinch = Gesture.Pinch()
    .enabled(pinchEnabled)
    .hitSlop(pinchEnabled ? PINCH_HIT_SLOP : 0)
    .onUpdate((e) => {
      if (isBoxMode) {
        boxW.value = Math.min(maxW, Math.max(minW, baseWidthRef.current * e.scale));
        boxH.value = Math.min(maxH, Math.max(minH, baseHeightRef.current * e.scale));
        return;
      }
      // 손가락을 아주 작게 오므리면 배율이 최소치보다 한참 아래로 떨어졌다가 손을 떼는 순간
      // 최소치로 갑자기 튀어오르는(고무줄) 느낌이 있어서, 움직이는 동안에도 최종 배율과 같은
      // 범위로 미리 제한해 미리보기와 실제 결과가 항상 일치하게 한다
      const proposedScale = baseScaleRef.current * e.scale;
      const clampedScale = Math.min(MAX_BLOCK_SCALE, Math.max(MIN_BLOCK_SCALE, proposedScale));
      gestureScale.value = clampedScale / baseScaleRef.current;
    })
    .onEnd((e) => {
      if (isBoxMode) {
        if (onResize) runOnJS(onResize)(boxW.value, boxH.value);
        return;
      }
      const proposedScale = baseScaleRef.current * e.scale;
      const next = Math.min(MAX_BLOCK_SCALE, Math.max(MIN_BLOCK_SCALE, proposedScale));
      if (onScale) runOnJS(onScale)(next);
      gestureScale.value = 1;
    });

  // 루틴/메모는 전용 손잡이 없이, 선택 후 두 손가락 확대/축소와 같이 손가락을 비틀면 그만큼
  // 회전한다(사진처럼 별도 손잡이를 드래그할 필요 없이 "만지는 김에" 자연스럽게 돌아가게).
  // e.rotation은 라디안 단위 누적값이라 도(degree)로 환산해서 더한다
  const rotateGesture = Gesture.Rotation()
    .enabled(rotatable && pinchEnabled && !isBoxMode)
    .onUpdate((e) => {
      const proposed = baseRotationRef.current + (e.rotation * 180) / Math.PI;
      rotationLive.value = Math.min(MAX_ROTATION_DEG, Math.max(-MAX_ROTATION_DEG, proposed));
    })
    .onEnd(() => {
      if (onRotate) runOnJS(onRotate)(rotationLive.value);
    });

  const pinchAndMove = isBoxMode ? pinch : Gesture.Simultaneous(pinch, twoFingerPan, rotateGesture);

  // 모서리 손잡이 드래그 — 가로는 dx, 세로는 dy로 각각 따로 조절(자르기 같은 효과). pinch와
  // 달리 균등하지 않아도 되므로 별도 한 손가락 Pan으로 처리, 선택됐을 때만 활성화
  const resizeHandlePan = Gesture.Pan()
    .enabled(isBoxMode && pinchEnabled)
    .hitSlop(RESIZE_HANDLE_HIT_SLOP)
    .onUpdate((e) => {
      boxW.value = Math.min(maxW, Math.max(minW, baseWidthRef.current + e.translationX));
      boxH.value = Math.min(maxH, Math.max(minH, baseHeightRef.current + e.translationY));
    })
    .onEnd(() => {
      if (onResize) runOnJS(onResize)(boxW.value, boxH.value);
    });

  // 회전 손잡이 드래그(사진 전용 — 루틴/메모는 위 rotateGesture로 대신함) — 절대좌표 기준으로
  // 손가락-중심 각도를 계산하는 방식은 스크롤 오프셋 등에 따라 불안정해서, 리사이즈 손잡이와
  // 같은 원리로 "가로로 끈 만큼(px) 각도(도)가 바뀐다"는 단순한 매핑을 쓴다. 오른쪽으로 끌면
  // 시계방향(양수), 왼쪽으로 끌면 반시계방향
  const rotatePan = Gesture.Pan()
    .enabled(isBoxMode && rotatable && pinchEnabled)
    .hitSlop(ROTATE_HANDLE_HIT_SLOP)
    .onUpdate((e) => {
      const proposed = baseRotationRef.current + e.translationX * ROTATE_SENSITIVITY;
      rotationLive.value = Math.min(MAX_ROTATION_DEG, Math.max(-MAX_ROTATION_DEG, proposed));
    })
    .onEnd(() => {
      if (onRotate) runOnJS(onRotate)(rotationLive.value);
    });

  // 메모 탭 인식 전용(RN 기본 Pressable 대신 gesture-handler로 처리해야 Pinch가 두 손가락을
  // 잘 인식함) — 더블탭으로 "선택만" 모드를 따로 두려고 했었는데 실기에서 잘 안 잡혀서,
  // 싱글탭 하나로 단순화(탭하면 바로 선택+입력 모드, 이동/핀치/삭제도 그 상태에서 그대로 가능)
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success && onTap) runOnJS(onTap)();
    });

  const composedGesture = onTap ? Gesture.Race(pan, pinchAndMove, singleTap) : Gesture.Race(pan, pinchAndMove);

  const animatedStyle = useAnimatedStyle(() => ({
    // translate/scale은 원래(회전 안 된) 좌표계에서 먼저 적용되고, rotate를 배열 맨 끝에 둬야
    // 그 결과 위치를 기준으로 블록 자신의 중심을 축으로 돌아간다 — 순서가 바뀌면 드래그
    // 방향이 기울기에 따라 엉뚱하게 틀어져 보인다
    transform: isBoxMode
      ? [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${rotationLive.value}deg` }]
      : [
          { translateX: translateX.value },
          { translateY: translateY.value },
          { scale: scale * gestureScale.value },
          { rotate: `${rotationLive.value}deg` },
        ],
  }));

  const boxAnimatedStyle = useAnimatedStyle(() => ({
    width: boxW.value,
    height: boxH.value,
  }));

  const handleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: boxW.value - RESIZE_HANDLE_SIZE / 2 },
      { translateY: boxH.value - RESIZE_HANDLE_SIZE / 2 },
    ],
  }));

  // 회전 손잡이(사진 전용)는 왼쪽 아래 모서리에 고정 — 왼쪽(x)은 항상 음수 오프셋으로 고정해두고,
  // 세로(y)만 박스 높이를 따라가게 해서 크기를 조절해도 항상 왼쪽 아래를 가리킨다
  const rotateHandleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: boxH.value }],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[{ position: 'absolute', left: x, top: y }, animatedStyle]}
        onLayout={
          onLayoutSize
            ? (e) => onLayoutSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
            : undefined
        }>
        {isBoxMode ? <Animated.View style={boxAnimatedStyle}>{children}</Animated.View> : children}
        {isBoxMode && pinchEnabled && (
          <GestureDetector gesture={resizeHandlePan}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: RESIZE_HANDLE_SIZE,
                  height: RESIZE_HANDLE_SIZE,
                  borderRadius: RESIZE_HANDLE_SIZE / 2,
                  backgroundColor: handleColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                handleAnimatedStyle,
              ]}>
              <Ionicons name="resize" size={16} color="#fff" />
            </Animated.View>
          </GestureDetector>
        )}
        {isBoxMode && rotatable && pinchEnabled && (
          // ⚠️ GestureDetector의 자식은 ref를 실제 네이티브 뷰로 넘겨줄 수 있어야 제스처가
          // 인식된다 — Themed의 RNView(forwardRef 없는 일반 함수 컴포넌트)를 썼을 때 드래그
          // 인식이 안 되는 문제가 있어서, 리사이즈 손잡이와 동일하게 Animated.View로 감싼다
          <GestureDetector gesture={rotatePan}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: -ROTATE_HANDLE_SIZE / 2,
                  top: -ROTATE_HANDLE_SIZE / 2,
                  width: ROTATE_HANDLE_SIZE,
                  height: ROTATE_HANDLE_SIZE,
                  borderRadius: ROTATE_HANDLE_SIZE / 2,
                  backgroundColor: handleColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                rotateHandleAnimatedStyle,
              ]}>
              <Ionicons name="reload" size={15} color="#fff" />
            </Animated.View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// 옛날 디지털카메라 특유의 가장자리 비네트를 흉내낸다 — 사진 필터의 일부라 캡처(ViewShot)
// 범위 안에 있어야 하므로 SVG 오버레이로 그 위에 얹는다.
// ⚠️ width/height는 반드시 "지금 이 사진 블록의 실제 픽셀 크기"를 숫자로 직접 받는다 —
// 예전엔 "100%"(부모 기준 비율)로 두었는데, 모서리 손잡이로 레이아웃을 즉시 늘려도 이
// SVG가 새 크기를 바로 못 따라오고(임시저장 후 다시 들어와야 그제서야 맞는, 강제로 다시
// 마운트돼야만 반영되는) 문제가 있었다 — react-native-svg가 부모의 라이브 레이아웃 변화를
// 항상 percentage로 재계산해주지는 않는 것으로 보여서, 숫자 props를 직접 넘겨 리사이즈할
// 때마다 확실히 다시 그리게 한다
function VignetteOverlay({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="photoVignette" cx="50%" cy="46%" r="72%">
          <Stop offset="50%" stopColor="#0f1620" stopOpacity={0} />
          <Stop offset="100%" stopColor="#0f1620" stopOpacity={0.36} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#photoVignette)" />
    </Svg>
  );
}

export default function PhotoDiaryFormScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [entryId, setEntryId] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState<PhotoSource | null>(null);
  // 인앱 카메라에서 "디카 감성" 모드로 찍었는지 — 대표 사진 블록을 만들 때 같이 넣어준다
  const [photoVintage, setPhotoVintage] = useState(false);
  const [mode, setMode] = useState<PhotoDiaryMode | null>(null);
  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const [hiddenRoutineIds, setHiddenRoutineIds] = useState<string[]>([]);
  const [routineColorEnabled, setRoutineColorEnabled] = useState(true);
  // "루틴 색 강조" 토글의 손잡이 위치 — 값이 바뀔 때마다 부드럽게 미끄러지도록 애니메이션
  const routineSwitchOn = useSharedValue(routineColorEnabled ? 1 : 0);
  useEffect(() => {
    routineSwitchOn.value = withTiming(routineColorEnabled ? 1 : 0, { duration: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineColorEnabled]);
  const routineSwitchThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: routineSwitchOn.value * ROUTINE_SWITCH_THUMB_TRAVEL }],
  }));
  const [textColorMode, setTextColorMode] = useState<TextColorMode>('black');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // 메모(텍스트) 블록만 별도로 관리하는 "입력창(키보드) 모드" — 탭하면 selectedBlockId와
  // 같이 이 상태도 켜져서 키보드가 뜨고, 그 상태에서도 이동/핀치/삭제는 그대로 가능하다
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  // 사진을 더블탭하면 여는 "사진 위치 조정" 화면 — 원본 중 어느 부분을 보여줄지 고르는 용도
  const [focalEditBlockId, setFocalEditBlockId] = useState<string | null>(null);
  // 더블탭 판정용 — Pressable은 연속 탭을 자동으로 묶어주지 않아서 블록별 마지막 탭 시각을 직접 기억해둔다
  const lastPhotoTapRef = useRef<Map<string, number>>(new Map());
  // 블록별 실제 렌더링 크기(캔버스 밖으로 얼마나 나갔는지 정확히 계산하는 용도) — onLayout으로 채움
  const blockSizeRef = useRef<Map<string, BlockSize>>(new Map());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useSharedValue(0);
  const toastAnimatedStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  // 메모가 투명 배경이라 추가돼도 눈에 잘 안 띄어서, 짧게 떴다 사라지는 안내 배너로 알려준다
  function showToast(message: string) {
    setToastMessage(message);
    toastOpacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withDelay(
        1200,
        withTiming(0, { duration: 250 }, (finished) => {
          if (finished) runOnJS(setToastMessage)(null);
        })
      )
    );
  }

  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showInAppCamera, setShowInAppCamera] = useState(false);
  const [showModeModal, setShowModeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllNotesConfirm, setShowDeleteAllNotesConfirm] = useState(false);
  const [showDiscardDraftConfirm, setShowDiscardDraftConfirm] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showPasteEmptyModal, setShowPasteEmptyModal] = useState(false);
  // 사진 선택 팝업을 "대표 사진 바꾸기" 용도로 열었는지, "캔버스에 사진 추가" 용도로 열었는지 구분
  const [photoPickTarget, setPhotoPickTarget] = useState<'cover' | 'add'>('cover');

  const shotRef = useRef<ViewShot>(null);

  // 뒤로가기 버튼 오른쪽에 사진일기 사용법 안내 버튼(ⓘ)을 헤더에 얹는다
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <AnimatedPressable onPress={() => setShowHelpModal(true)} hitSlop={10} style={{ marginRight: 12 }}>
          <Ionicons name="information-circle-outline" size={22} color={accent} />
        </AnimatedPressable>
      ),
    });
  }, [navigation, accent]);

  const diaryQuery = useQuery({
    queryKey: ['photo-diary', userId, date],
    queryFn: () => fetchPhotoDiary(userId!, date),
    enabled: !!userId && !!date,
  });

  const routinesQuery = useQuery({
    queryKey: ['photo-diary-routines', userId, date],
    queryFn: () => fetchRoutinesForDate(userId!, date),
    enabled: !!userId && !!date,
  });

  const isLoading = diaryQuery.isLoading || routinesQuery.isLoading;
  const candidateRoutines = routinesQuery.data?.routines ?? [];
  const completions = routinesQuery.data?.completions ?? [];
  const completedIds = useMemo(() => new Set(completions.map((c) => c.routine_id)), [completions]);
  const routineById = useMemo(() => new Map(candidateRoutines.map((r) => [r.id, r])), [candidateRoutines]);

  // 캔버스 세로 길이는 루틴을 추가/삭제할 때마다 줄었다 늘었다 하지 않도록 고정값으로 둔다
  // (가로 길이의 2.3배였던 걸 "너무 길다"는 피드백으로 3/5만 남김) — 루틴을 많이 담아도 이
  // 안에서만 자유 배치되고, 밖으로 밀어내면 "담지 않은 루틴"으로 자동 이동한다
  const canvasHeight = Math.round(CANVAS_WIDTH * 2.3 * (3 / 5));
  const resolvedTextColor = resolveTextColor(textColorMode, accent);
  // 화면에 그리는 순서만 별도로 재정렬 — 실제 blocks 배열(저장 순서/드래그 상태)은 안 건드리고,
  // 사진(맨밑) < 붙여넣기한 것(사진/메모) < 루틴 < 직접 쓴 메모(맨위) 순으로만 겹침 순서를 고정한다
  const renderBlocks = useMemo(
    () =>
      blocks
        .map((b, i) => ({ b, i }))
        .sort((a, c) => blockLayer(a.b) - blockLayer(c.b) || a.i - c.i)
        .map(({ b }) => b),
    [blocks]
  );
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);
  const selectedBlockSupportsColor = selectedBlock && selectedBlock.type !== 'photo';
  const focalEditBlock = blocks.find(
    (b): b is Extract<CanvasBlock, { type: 'photo' }> => b.id === focalEditBlockId && b.type === 'photo'
  );

  // 기존에 저장된 사진일기가 있으면 그 값으로 화면을 채운다(수정 모드) — 일기적기/루틴고르기
  // 둘 다 이제 같은 자유 캔버스(blocks)를 쓴다
  useEffect(() => {
    const entry = diaryQuery.data;
    if (!entry) return;
    setEntryId(entry.id);
    setPhotoUri(entry.photo_url);
    setPhotoSource(entry.photo_source);
    setMode(entry.mode);
    setRoutineColorEnabled(entry.routine_color_enabled);
    setTextColorMode(entry.text_color_mode);
    const savedBlocks = buildBlocksFromEntry(entry, routineById);
    setBlocks(savedBlocks);
    const placedRoutineIds = new Set(
      savedBlocks.filter((b): b is Extract<CanvasBlock, { type: 'routine' }> => b.type === 'routine').map((b) => b.routineId)
    );
    setHiddenRoutineIds(candidateRoutines.filter((r) => !placedRoutineIds.has(r.id)).map((r) => r.id));
  }, [diaryQuery.data, candidateRoutines, routineById]);

  useEffect(() => {
    if (diaryQuery.isError) setErrorMessage(t('photoDiary.errorLoad'));
  }, [diaryQuery.isError]);

  // 카메라 등 외부 화면을 여는 동안 안드로이드가 앱 프로세스를 강제 종료했다가 재시작하면
  // (사진 촬영 후 오늘 탭으로 튕기던 문제) 이 화면의 로컬 state가 전부 날아간다 — 서버 저장
  // 전까지는 작업 내용을 기기에 임시 저장해뒀다가, 다시 이 날짜의 사진일기로 들어오면 그대로
  // 복원해서 최소한 진행 중이던 캔버스 구성(사진/루틴/메모 배치)까지 잃지는 않게 한다.
  // "저장" 성공 시에는 handleSave에서 draft를 바로 지우므로, 여기서 draft가 남아있다는 건
  // 기존 항목을 수정하던 중이었더라도 아직 저장 안 된 변경사항이 있다는 뜻 — 그래서 이미
  // 서버에 저장된 항목(diaryQuery.data)이 있어도 항상 draft를 우선해서 덮어씌운다
  const draftKey = userId && date ? `photo-diary-draft:${userId}:${date}` : null;
  const draftRestoredRef = useRef(false);

  useEffect(() => {
    if (!draftKey || draftRestoredRef.current || diaryQuery.isLoading) return;
    draftRestoredRef.current = true;
    AsyncStorage.getItem(draftKey)
      .then((raw) => {
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (draft.photoUri) setPhotoUri(draft.photoUri);
        if (draft.photoSource !== undefined) setPhotoSource(draft.photoSource);
        if (draft.mode) setMode(draft.mode);
        if (Array.isArray(draft.blocks)) setBlocks(draft.blocks);
        if (Array.isArray(draft.hiddenRoutineIds)) setHiddenRoutineIds(draft.hiddenRoutineIds);
        if (typeof draft.routineColorEnabled === 'boolean') setRoutineColorEnabled(draft.routineColorEnabled);
        if (draft.textColorMode) setTextColorMode(draft.textColorMode);
        // 사진은 찍었는데 "무엇을 적을까요" 모드를 고르기 전에 앱이 재시작된 경우, 모드가
        // 없는 채로 photoUri만 복원되면 저장/임시저장삭제 버튼이 전부 mode를 요구해서 하나도
        // 안 뜨는 막다른 화면이 됐었다 — 모드 선택 모달을 다시 띄워서 이어갈 수 있게 한다
        if (draft.photoUri && !draft.mode) setShowModeModal(true);
      })
      .catch(() => {});
  }, [draftKey, diaryQuery.isLoading]);

  useEffect(() => {
    // entryId가 있는(기존 항목을 수정 중인) 경우도 포함 — "사진 추가"로 카메라를 여는 동안
    // 앱이 재시작되면 그동안의 편집 내용을 잃지 않도록 항상 최신 상태를 기기에 남겨둔다.
    // mode가 정해지기 전(사진만 찍고 "무엇을 적을까요"를 아직 안 고른 상태)은 애매한
    // 중간 상태라 그 시점부턴 저장 안 하고, 모드를 고른 뒤부터만 임시저장을 시작한다
    if (!draftKey || !photoUri || !mode || !draftRestoredRef.current) return;
    const draft = { photoUri, photoSource, mode, blocks, hiddenRoutineIds, routineColorEnabled, textColorMode };
    AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(() => {});
  }, [draftKey, photoUri, photoSource, mode, blocks, hiddenRoutineIds, routineColorEnabled, textColorMode]);

  // 사진일기를 처음 써보는 사용자에게 사용법을 한 번만 자동으로 보여준다 — "일기 적기"든
  // "루틴 고르기"든 어느 쪽을 먼저 쓰든 상관없이 캔버스에 처음 들어온 그 순간 한 번만
  const helpAutoCheckedRef = useRef(false);
  useEffect(() => {
    if (!mode || helpAutoCheckedRef.current) return;
    helpAutoCheckedRef.current = true;
    AsyncStorage.getItem(PHOTO_DIARY_HELP_SEEN_KEY)
      .then((seen) => {
        if (seen) return;
        setShowHelpModal(true);
        AsyncStorage.setItem(PHOTO_DIARY_HELP_SEEN_KEY, '1').catch(() => {});
      })
      .catch(() => {});
  }, [mode]);

  async function pickFromLibrary() {
    setIsBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('photoDiary.permissionTitle'), t('photoDiary.libraryPermissionDesc'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) onPhotoObtained(result.assets[0].uri, 'library');
    } finally {
      setIsBusy(false);
    }
  }

  // 예전엔 여기서 OS 기본 카메라 앱을 열었는데, 그 순간 우리 앱이 백그라운드로 밀려나면서
  // 안드로이드(특히 삼성 배터리 관리 기능)가 프로세스를 강제 종료해 재시작되는 문제가 있었다
  // (2026-09-12, adb logcat으로 SIGKILL 확인). 외부 앱으로 안 나가도록 화면 안에서 직접
  // 촬영하는 InAppCamera로 교체 — 백그라운드 전환 자체가 없어져서 이 문제가 구조적으로 사라진다
  function requestCameraCapture() {
    setShowSourceModal(false);
    setTimeout(() => setShowInAppCamera(true), 350);
  }

  function requestLibraryPick() {
    setShowSourceModal(false);
    setTimeout(pickFromLibrary, 350);
  }

  function handleCameraCaptured(uri: string, vintage: boolean) {
    setShowInAppCamera(false);
    onPhotoObtained(uri, 'camera', vintage);
  }

  function openChangeCoverPhoto() {
    setPhotoPickTarget('cover');
    setShowSourceModal(true);
  }

  function openAddPhoto() {
    setPhotoPickTarget('add');
    setShowSourceModal(true);
  }

  // 캔버스에 사진을 하나 더 추가 — 대표 사진보다 조금 작게 시작해서 서로 구분되게 하고,
  // 이후 선택해서 자유롭게 드래그/핀치줌으로 옮기고 키울 수 있다
  function addPhotoBlockFromUri(uri: string, source: PhotoSource, pasted = false, vintage = false) {
    setBlocks((prev) => [
      ...prev,
      {
        id: nextBlockId(),
        type: 'photo',
        uri,
        source,
        vintage,
        pasted,
        x: CANVAS_SIDE_MARGIN,
        y: CANVAS_PHOTO_HEIGHT + 12,
        scale: 0.6,
      },
    ]);
  }

  function onPhotoObtained(uri: string, source: PhotoSource, vintage = false) {
    if (photoPickTarget === 'add') {
      addPhotoBlockFromUri(uri, source, false, vintage);
      return;
    }
    setPhotoUri(uri);
    setPhotoSource(source);
    setPhotoVintage(vintage);
    // "모드를 아직 한 번도 안 골랐을 때"(entryId가 아니라 mode 자체)만 모드 선택 팝업을 띄운다.
    // 예전엔 entryId(서버 저장 여부)로 판단해서, 신규 작성 중(아직 저장 전) "사진 바꾸기"를 누르면
    // 매번 모드 팝업이 다시 뜨고 chooseMode가 blocks를 통째로 새로 채워서 루틴/메모가 초기화됐었다
    if (!mode) {
      setShowModeModal(true);
      return;
    }
    // 루틴 캔버스에 이미 있는 대표 사진 블록만 바꿔서, 화면에 보이는 사진만 교체되고 루틴/메모는 그대로 남는다
    if (mode === 'routines') {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.type === 'photo');
        if (idx === -1) {
          return [{ id: nextBlockId(), type: 'photo', uri, source, vintage, x: 0, y: 0, scale: 1 }, ...prev];
        }
        const next = [...prev];
        next[idx] = { ...(next[idx] as Extract<CanvasBlock, { type: 'photo' }>), uri, source, vintage };
        return next;
      });
    }
  }

  // 이미지든 텍스트든, 클립보드에 있는 걸 캔버스 위 새 블록으로 붙여넣는다
  async function pasteFromClipboard() {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (hasImage) {
        const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.8 });
        if (image?.data) {
          const base64 = image.data.replace(/^data:image\/\w+;base64,/, '');
          const path = `${FileSystem.cacheDirectory}pasted-${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
          addPhotoBlockFromUri(path, 'library', true);
        }
        return;
      }
      const text = await Clipboard.getStringAsync();
      if (text) {
        setBlocks((prev) => [
          ...prev,
          { id: nextBlockId(), type: 'text', text, pasted: true, x: 24, y: CANVAS_PHOTO_HEIGHT + 40 },
        ]);
      } else {
        setShowPasteEmptyModal(true);
      }
    } catch {
      setErrorMessage(t('photoDiary.errorPaste'));
    } finally {
      setIsBusy(false);
    }
  }

  function chooseMode(nextMode: PhotoDiaryMode) {
    setMode(nextMode);
    setShowModeModal(false);
    if (!photoUri) return;
    if (nextMode === 'routines') {
      const toPlace = candidateRoutines.slice(0, MAX_AUTO_ROUTINE_BLOCKS);
      const overflow = candidateRoutines.slice(MAX_AUTO_ROUTINE_BLOCKS);
      setBlocks([
        { id: nextBlockId(), type: 'photo', uri: photoUri, source: photoSource, vintage: photoVintage, x: 0, y: 0, scale: 1 },
        ...toPlace.map((r, i) => ({
          id: nextBlockId(),
          type: 'routine' as const,
          routineId: r.id,
          x: ROUTINE_COL_X[i % 2],
          y: CANVAS_PHOTO_HEIGHT + 12 + Math.floor(i / 2) * ROUTINE_ROW_HEIGHT,
        })),
      ]);
      // 다 못 담은 루틴은 삭제된 게 아니라 "담지 않은 루틴" 목록에서 대기 — 원하는 것만 골라 담게 한다
      setHiddenRoutineIds(overflow.map((r) => r.id));
    } else {
      // 일기적기도 같은 자유 캔버스 — 루틴 없이 사진 하나와 바로 쓸 수 있는 빈 메모 하나로 시작한다
      setBlocks([
        { id: nextBlockId(), type: 'photo', uri: photoUri, source: photoSource, vintage: photoVintage, x: 0, y: 0, scale: 1 },
        { id: nextBlockId(), type: 'text', text: '', x: 24, y: CANVAS_PHOTO_HEIGHT + 40 },
      ]);
      setHiddenRoutineIds([]);
    }
  }

  function hideRoutineBlock(blockId: string, routineId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setHiddenRoutineIds((prev) => [...prev, routineId]);
    setSelectedBlockId(null);
  }

  function restoreRoutine(routineId: string) {
    setHiddenRoutineIds((prev) => prev.filter((id) => id !== routineId));
    setBlocks((prev) => {
      const routineBlockCount = prev.filter((b) => b.type === 'routine').length;
      return [
        ...prev,
        {
          id: nextBlockId(),
          type: 'routine',
          routineId,
          x: ROUTINE_COL_X[routineBlockCount % 2],
          y: CANVAS_PHOTO_HEIGHT + 12 + Math.floor(routineBlockCount / 2) * ROUTINE_ROW_HEIGHT,
        },
      ];
    });
  }

  function addTextNote() {
    setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'text', text: '', x: 24, y: CANVAS_PHOTO_HEIGHT + 40 }]);
    showToast(t('photoDiary.noteAddedToast'));
  }

  function updateBlockPosition(id: string, x: number, y: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
  }

  function updateBlockScale(id: string, scale: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, scale } : b)));
  }

  // 손잡이(사진) 또는 두 손가락 회전 제스처(루틴/메모)로 기울인 뒤 호출됨
  function updateBlockRotation(id: string, rotation: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, rotation } : b)));
  }

  // 루틴/메모 전용 — "회전 초기화" 버튼에서 기울기를 0으로 되돌림
  function resetBlockRotation(id: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id && (b.type === 'routine' || b.type === 'text') ? { ...b, rotation: 0 } : b))
    );
  }

  // 사진 블록 전용 — 핀치(균등) 또는 모서리 손잡이(가로/세로 개별)로 크기가 바뀐 뒤 실제
  // 픽셀 크기를 그대로 저장한다(자르기 효과, photoBlockSize() 참고)
  // 캔버스에서 핀치(균등)나 모서리 손잡이(가로/세로 개별)로 크기가 바뀔 때 호출됨. 저장된
  // crop이 있는데 비율(모양) 자체가 바뀌면 그 crop은 더 이상 유효하지 않아(왜곡 발생) 같이
  // 초기화한다 — 균등 핀치처럼 비율이 그대로면 crop은 안 건드리고 그대로 유지
  function updateBlockSize(id: string, width: number, height: number) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.type !== 'photo') return b;
        const prevSize = photoBlockSize(b);
        const aspectChanged = Math.abs(width / height - prevSize.width / prevSize.height) > 0.01;
        return aspectChanged
          ? { ...b, width, height, cropX: undefined, cropY: undefined, cropW: undefined, cropH: undefined }
          : { ...b, width, height };
      })
    );
  }

  // "사진 위치 조정" 화면에서 확인을 누르면 호출 — crop과 함께 그 프레임의 모양(가로세로
  // 비율)도 같이 반영해야 왜곡 없이 나오므로, 가로는 지금 폭을 유지하고 세로만 새 비율에
  // 맞게 다시 계산해서 crop과 한 번에 저장한다("가로 꽉 채우기"와 같은 방식)
  function updateBlockCrop(id: string, cropX: number, cropY: number, cropW: number, cropH: number, frameAspect: number) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.type !== 'photo') return b;
        const current = photoBlockSize(b);
        return { ...b, width: current.width, height: current.width / frameAspect, cropX, cropY, cropW, cropH };
      })
    );
  }

  // 촬영 시 고른 디카 필터를 캔버스에서 나중에 켜고 끌 수 있게 — 붙여넣기한 사진처럼 촬영
  // 당시 선택을 못 한 사진도 이걸로 적용/해제할 수 있다. vintage가 아직 명시 안 된 예전
  // 데이터(카메라 사진 자동 적용 규칙)도 여기서 토글하면 그때부터는 명시값을 갖게 된다
  function toggleBlockVintage(id: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id && b.type === 'photo' ? { ...b, vintage: !(b.vintage ?? b.source === 'camera') } : b
      )
    );
  }

  // 사진 탭 처리 — 한 번 탭이면 선택/해제, 300ms 안에 두 번째 탭이 들어오면 더블탭으로 보고
  // "사진 위치 조정" 화면을 연다. Pressable은 연속 탭을 자동으로 묶어주지 않아서 직접 판정한다
  function handlePhotoPress(id: string) {
    const now = Date.now();
    const last = lastPhotoTapRef.current.get(id) ?? 0;
    lastPhotoTapRef.current.set(id, now);
    if (now - last < PHOTO_DOUBLE_TAP_MS) {
      lastPhotoTapRef.current.delete(id);
      setFocalEditBlockId(id);
      return;
    }
    setSelectedBlockId((prev) => (prev === id ? null : id));
  }

  // 개별 글자색 지정 — undefined를 주면 "기본값 사용"(전체 글자색 설정을 따름)으로 되돌아간다
  function updateBlockTextColor(id: string, color: TextColorMode | undefined) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id && (b.type === 'routine' || b.type === 'text') ? { ...b, textColor: color } : b))
    );
  }

  function updateTextBlockText(id: string, text: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === 'text' ? { ...b, text } : b)));
  }

  function removeTextBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  // 캔버스에 사진이 0장이어도 저장 가능(대표 사진은 photoUri에 남아있고, 나중에 "사진
  // 추가"·붙여넣기로 다시 채울 수 있음)이라 마지막 한 장도 자유롭게 지울 수 있다
  function removePhotoBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedBlockId((prev) => (prev === id ? null : prev));
  }

  // 사진을 크게 확대하면 삭제 배지가 캔버스 밖(overflow:hidden으로 안 보이는 영역)으로
  // 밀려날 수 있어서, 배지를 사진 자체에 붙이지 않고 캔버스 기준 좌표로 따로 계산해 띄운다
  // 원래 자리(사진/메모의 오른쪽 위 모서리)에 살짝 겹치게 두되, 그 모서리가 캔버스 아래로
  // 넘어가면 복잡하게 다시 계산하지 않고 지금 위치에서 30px만 위로 당겨온다. 오른쪽으로
  // 넘어가는 경우만 캔버스 안쪽으로 살짝 당겨서 완전히 안 보이는 것만 막는다
  function cornerBadgePosition(x: number, y: number, w: number, badgeSize: number) {
    let left = x + w - badgeSize * 0.6;
    let top = y - badgeSize * 0.4;
    if (top > canvasHeight - badgeSize) top -= 30;
    // 사진을 캔버스보다 크게 키우면 모서리 자체가 캔버스의 위/왼쪽 밖으로도 밀려날 수 있어서
    // (예전엔 오른쪽/아래로 넘어가는 경우만 보정했음), 어느 방향으로 넘어가든 배지가 항상
    // 지금 보이는 캔버스 영역 안에 있도록 네 방향 모두 클램프한다
    top = Math.min(Math.max(top, 0), canvasHeight - badgeSize);
    left = Math.min(Math.max(left, 0), CANVAS_WIDTH - badgeSize);
    return { left, top };
  }

  // 배지는 평소엔 사진의 실제(지금) 오른쪽 위 모서리를 그대로 따라간다 — 고정 위치로 두면
  // 사진이 커졌을 때 실제 모서리와 배지 위치가 멀어져 어색하다는 피드백으로 되돌림. 사진이
  // 캔버스 밖으로 거의 나가려 할 때만 cornerBadgePosition의 보정으로 오른쪽 모서리 안쪽에 머문다
  function fitPhotoBadgePosition(block: Extract<CanvasBlock, { type: 'photo' }>) {
    const size = photoBlockSize(block);
    return cornerBadgePosition(block.x, block.y, size.width, 24);
  }

  function fitTextBadgePosition(block: Extract<CanvasBlock, { type: 'text' }>) {
    const size = blockSizeRef.current.get(block.id) ?? { width: 60, height: 24 };
    const w = size.width * (block.scale ?? 1);
    return cornerBadgePosition(block.x, block.y, w, 20);
  }

  // 캔버스에서 확대해도 폭이 정확히 캔버스 폭과 같아지도록 조절 — 손으로 핀치해서 딱
  // 맞추기 어렵다는 피드백으로 버튼 한 번으로 되게 한다. 높이는 그대로 둬서(가로만 맞춤)
  // 모서리 손잡이로 따로 조절해둔 세로 크기(자르기)를 건드리지 않는다
  function fitPhotoToCanvasWidth(id: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.type !== 'photo') return b;
        const current = photoBlockSize(b);
        // 가로만 바뀌고 세로는 그대로라 비율(모양)이 달라지므로, 저장돼 있던 crop은
        // 더 이상 이 모양과 안 맞아 같이 초기화한다(안 그러면 왜곡되어 보임)
        return {
          ...b,
          width: CANVAS_WIDTH,
          height: current.height,
          x: 0,
          cropX: undefined,
          cropY: undefined,
          cropW: undefined,
          cropH: undefined,
        };
      })
    );
  }

  function deleteAllTextBlocks() {
    const textIds = new Set(blocks.filter((b) => b.type === 'text').map((b) => b.id));
    setBlocks((prev) => prev.filter((b) => b.type !== 'text'));
    setSelectedBlockId((prev) => (prev && textIds.has(prev) ? null : prev));
    setEditingBlockId((prev) => (prev && textIds.has(prev) ? null : prev));
  }


  async function handleSave() {
    if (!userId || !date || !mode) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      // 캔버스 안 사진 블록 중 로컬(아직 업로드 전)인 것들을 전부 업로드하고 URL로 치환
      const finalBlocks = await Promise.all(
        blocks.map(async (b) => {
          if (b.type === 'photo' && isLocalUri(b.uri)) {
            return { ...b, uri: await uploadPhotoDiaryPhoto(userId, b.uri) };
          }
          return b;
        })
      );
      const firstPhoto = finalBlocks.find((b): b is Extract<CanvasBlock, { type: 'photo' }> => b.type === 'photo');
      const coverPhotoUrl = firstPhoto?.uri ?? photoUri;
      const coverPhotoSource = firstPhoto?.source ?? photoSource;

      if (!coverPhotoUrl) return;

      const saved = await savePhotoDiary(
        userId,
        date,
        {
          photoUrl: coverPhotoUrl,
          photoSource: coverPhotoSource,
          mode,
          blocks: finalBlocks,
          routineColorEnabled,
          textColorMode,
        },
        entryId
      );
      setEntryId(saved.id);
      setPhotoUri(saved.photo_url);
      setBlocks(finalBlocks);
      if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
      // 캘린더의 카메라 아이콘 등이 서버 재조회 타이밍을 기다리지 않고 바로 반영되게 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['photo-diary-dates'] });
      queryClient.invalidateQueries({ queryKey: ['photo-diary', userId, date] });
      router.back();
    } catch {
      setErrorMessage(t('photoDiary.errorSave'));
    } finally {
      setIsSaving(false);
    }
  }

  // "저장" 없이 지금까지 만진 내용을 버리고, 마지막으로 저장된 상태(기존 항목이면 서버 값,
  // 신규 작성이면 빈 화면)로 되돌린다 — 기기에 남아있는 임시저장도 같이 지운다
  function discardDraft() {
    if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
    setSelectedBlockId(null);
    const entry = diaryQuery.data;
    if (entry) {
      setPhotoUri(entry.photo_url);
      setPhotoSource(entry.photo_source);
      setMode(entry.mode);
      setRoutineColorEnabled(entry.routine_color_enabled);
      setTextColorMode(entry.text_color_mode);
      const savedBlocks = buildBlocksFromEntry(entry, routineById);
      setBlocks(savedBlocks);
      const placedRoutineIds = new Set(
        savedBlocks.filter((b): b is Extract<CanvasBlock, { type: 'routine' }> => b.type === 'routine').map((b) => b.routineId)
      );
      setHiddenRoutineIds(candidateRoutines.filter((r) => !placedRoutineIds.has(r.id)).map((r) => r.id));
    } else {
      setPhotoUri(null);
      setPhotoSource(null);
      setMode(null);
      setBlocks([]);
      setHiddenRoutineIds([]);
      setRoutineColorEnabled(true);
      setTextColorMode('black');
    }
  }

  async function performDelete() {
    if (!entryId) return;
    setIsSaving(true);
    try {
      await deletePhotoDiary(entryId);
      if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['photo-diary-dates'] });
      queryClient.invalidateQueries({ queryKey: ['photo-diary', userId, date] });
      router.back();
    } catch {
      setErrorMessage(t('photoDiary.errorDelete'));
      setIsSaving(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleSaveImage() {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      // 저장(쓰기) 전용 권한만 요청 — 전체 읽기 권한을 요청하면 안드로이드에서 사진과 무관한
      // "음악과 오디오" 접근까지 같이 물어보는 이상한 안내가 떠서, 쓰기 전용으로 범위를 좁힌다
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert(t('photoDiary.permissionTitle'), t('photoDiary.mediaLibraryPermissionDesc'));
        return;
      }
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.9 });
      await MediaLibrary.saveToLibraryAsync(uri);
      // OS 기본 알림창 대신, 이 화면에서 이미 쓰고 있는 주색 토스트(메모 추가 안내와 동일한
      // 스타일)로 통일 — 디자인 일관성
      showToast(t('photoDiary.savedToGalleryTitle'));
    } catch {
      setErrorMessage(t('photoDiary.errorSaveImage'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleShare() {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.9 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      setErrorMessage(t('photoDiary.errorSaveImage'));
    } finally {
      setIsBusy(false);
    }
  }

  function dismissKeyboardAndSelection() {
    Keyboard.dismiss();
    setSelectedBlockId(null);
    setEditingBlockId(null);
  }

  // 배경(빈 캔버스/여백)을 탭하면 키보드/선택을 해제하는 용도 — 예전엔 TouchableWithoutFeedback
  // (RN 구형 터치 responder 시스템)으로 만들었는데, 그 아래 메모 블록의 탭 인식은
  // react-native-gesture-handler로 따로 처리하고 있어서(Pinch와 함께 쓰려면 이 라이브러리가
  // 필요함) 서로 다른 두 시스템이 같은 탭을 각자 독립적으로 처리해버려 메모를 탭해도 선택되자마자
  // 이 배경 탭 핸들러가 뒤이어 선택을 다시 풀어버리는 충돌이 있었다(메모 탭이 아예 안 먹히는
  // 버그의 원인). 배경도 같은 gesture-handler 체계로 통일하면, 중첩된 제스처끼리는 더 안쪽
  // (자식) 블록이 인식한 탭을 배경까지 이중으로 처리하지 않아 충돌이 사라진다
  const backgroundTap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(dismissKeyboardAndSelection)();
  });

  // 메모(텍스트) 블록 탭 처리 — 탭하면 선택 + 입력창(키보드) 모드가 함께 켜진다(선택 상태라
  // 이동/핀치/삭제도 그 상태에서 그대로 가능). 원래는 더블탭으로 키보드 없이 "선택만" 하는
  // 모드도 따로 뒀는데, 실기에서 더블탭이 잘 안 잡혀서 제거하고 이걸로 단순화했다
  function handleTextSingleTap(id: string) {
    setSelectedBlockId(id);
    setEditingBlockId(id);
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {toastMessage && (
        <Animated.View style={[styles.toast, toastAnimatedStyle]} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
      <RNView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={dismissKeyboardAndSelection}>
          {/* 배경 탭으로 키보드/선택 해제하는 GestureDetector(backgroundTap) — ScrollView의 자식
              (내부)으로 둬서 스크롤 인식은 항상 ScrollView가 먼저 가져가고, 스크롤이 아닌 순수
              탭일 때만 배경 탭으로 인식된다. 같은 gesture-handler 체계라 메모 블록의 탭과도
              충돌하지 않는다(위 backgroundTap 정의부 주석 참고) */}
          <GestureDetector gesture={backgroundTap}>
            <RNView>
            {!photoUri ? (
              <AnimatedPressable style={styles.pickPhotoBox} onPress={() => setShowSourceModal(true)} disabled={isBusy}>
                {isBusy ? (
                  <ActivityIndicator color={accent} />
                ) : (
                  <>
                    <RNView style={styles.pickPhotoIconBadge}>
                      <Ionicons name="camera" size={28} color="#fff" />
                    </RNView>
                    <Text style={styles.pickPhotoText}>{t('photoDiary.createButton')}</Text>
                    <Text style={styles.pickPhotoSubtext}>{t('photoDiary.createButtonSubtext')}</Text>
                  </>
                )}
              </AnimatedPressable>
            ) : (
              <>
                {/* 사진일기 "범위" 표시는 사용자 편의용 안내선일 뿐이라, 저장/공유되는 이미지에는
                    안 보이도록 실제로 캡처되는 ViewShot 바깥에 별도 테두리로 감싼다 */}
                <RNView style={styles.templateWrap}>
                <RNView style={styles.templateFrame}>
                  <ViewShot ref={shotRef} style={styles.template} options={{ format: 'jpg', quality: 0.9 }}>
                    <RNView style={[styles.templateInner, { width: CANVAS_WIDTH, height: canvasHeight, overflow: 'hidden' }]}>
                      {!blocks.some((b) => b.type !== 'photo') && (
                        <Text style={styles.emptyCanvasText}>
                          {t(mode === 'routines' ? 'photoDiary.emptyRoutines' : 'photoDiary.emptyText')}
                        </Text>
                      )}
                      {renderBlocks.map((block) => {
                            const isSelected = selectedBlockId === block.id;
                            const isEditing = editingBlockId === block.id;
                            const blockTextColor =
                              block.type !== 'photo'
                                ? resolveTextColor(block.textColor ?? textColorMode, accent)
                                : resolvedTextColor;
                            return (
                              <DraggableBlock
                                key={block.id}
                                x={block.x}
                                y={block.y}
                                scale={block.scale ?? 1}
                                sizeMode={block.type === 'photo' ? 'box' : 'transform'}
                                width={block.type === 'photo' ? photoBlockSize(block).width : undefined}
                                height={block.type === 'photo' ? photoBlockSize(block).height : undefined}
                                minSize={block.type === 'photo' ? { width: MIN_PHOTO_WIDTH, height: MIN_PHOTO_HEIGHT } : undefined}
                                maxSize={block.type === 'photo' ? { width: MAX_PHOTO_WIDTH, height: MAX_PHOTO_HEIGHT } : undefined}
                                rotation={block.rotation ?? 0}
                                rotatable
                                onRotate={(r) => updateBlockRotation(block.id, r)}
                                handleColor={accent}
                                pinchEnabled={isSelected}
                                onLayoutSize={(size) => blockSizeRef.current.set(block.id, size)}
                                onMove={(x, y, nextScale) => {
                                  let w: number;
                                  let h: number;
                                  if (block.type === 'photo') {
                                    const photoSize = photoBlockSize(block);
                                    w = photoSize.width;
                                    h = photoSize.height;
                                  } else {
                                    const size = blockSizeRef.current.get(block.id);
                                    const fallbackWidth = block.type === 'routine' ? ROUTINE_COL_WIDTH : 80;
                                    const fallbackHeight = block.type === 'routine' ? ROUTINE_ROW_HEIGHT : 30;
                                    // 두 손가락으로 핀치+이동을 같이 하면 scale도 이 순간 같이 바뀌는
                                    // 중이라, 아직 리렌더 전이라 옛 값을 들고 있는 block.scale 대신
                                    // 방금 계산된 nextScale이 있으면 그걸 우선 써서 경계를 계산한다
                                    const effectiveScale = nextScale ?? block.scale ?? 1;
                                    w = (size?.width ?? fallbackWidth) * effectiveScale;
                                    h = (size?.height ?? fallbackHeight) * effectiveScale;
                                  }
                                  // 루틴 칩을 캔버스 밖으로 80% 이상 밀어내면 삭제가 아니라
                                  // "담지 않은 루틴" 목록으로 보내서, 다시 추가하면 초기 위치로
                                  // 되돌아오게 한다(끌던 위치를 그대로 기억하지 않음)
                                  if (block.type === 'routine') {
                                    if (isMostlyOutsideCanvas(x, y, w, h, CANVAS_WIDTH, canvasHeight)) {
                                      hideRoutineBlock(block.id, block.routineId);
                                      return;
                                    }
                                  } else if (isMostlyOutsideCanvas(x, y, w, h, CANVAS_WIDTH, canvasHeight)) {
                                    // 사진/메모는 루틴처럼 "담지 않은 목록"이 없어서, 캔버스 밖으로
                                    // 나가면 다시 찾을 방법 없이 사라져버린다 — 대신 절반은 항상
                                    // 캔버스 안에 남도록 위치를 되돌린다(핀치로 축소하다가 초점이
                                    // 살짝 튀어도 화면 밖으로 완전히 사라지지 않게 하는 안전장치)
                                    updateBlockPosition(
                                      block.id,
                                      Math.min(Math.max(x, -w * 0.5), CANVAS_WIDTH - w * 0.5),
                                      Math.min(Math.max(y, -h * 0.5), canvasHeight - h * 0.5)
                                    );
                                    return;
                                  }
                                  updateBlockPosition(block.id, x, y);
                                }}
                                onScale={(s) => updateBlockScale(block.id, s)}
                                onResize={block.type === 'photo' ? (w, h) => updateBlockSize(block.id, w, h) : undefined}
                                onTap={block.type === 'text' && !isEditing ? () => handleTextSingleTap(block.id) : undefined}>
                                {block.type === 'photo' ? (
                                  <RNView style={{ flex: 1 }}>
                                    <AnimatedPressable
                                      onPress={() => handlePhotoPress(block.id)}
                                      style={styles.photoBlockBase}>
                                      {(() => {
                                        const imgStyle = cropToImageStyle(block.cropX, block.cropY, block.cropW, block.cropH);
                                        const isVintage = block.vintage ?? block.source === 'camera';
                                        return (
                                          <>
                                            <Image source={{ uri: block.uri }} resizeMode="cover" style={imgStyle} />
                                            {isVintage && (
                                              <>
                                                {/* 예전엔 BlurView로 부드러운 느낌을 냈는데, 안드로이드의
                                                    BlurView는 "뒤에 있는 화면을 캡처해서 흐리게 합성"하는
                                                    방식이라 드래그/확대축소용으로 겹겹이 감싸둔 뷰 구조
                                                    안에서는 캡처 범위가 어긋나 엉뚱한 사각형 영역만 흐리게
                                                    찍히는 버그가 있었다 — 대신 같은 사진을 아주 살짝
                                                    어긋난 위치에 반투명으로 두 장 더 겹쳐서(사람 눈에는
                                                    "번져 보이는" 흐림처럼 읽힘) 실제 블러 없이 흐린
                                                    느낌을 낸다. 점 패턴보다 실제 화질 저하에 가까워 보임 */}
                                                <Image
                                                  source={{ uri: block.uri }}
                                                  resizeMode="cover"
                                                  style={[
                                                    { position: 'absolute' as const, left: 0, top: 0 },
                                                    imgStyle,
                                                    { opacity: 0.18, transform: [{ translateX: 1 }, { translateY: 0.7 }] },
                                                  ]}
                                                />
                                                <Image
                                                  source={{ uri: block.uri }}
                                                  resizeMode="cover"
                                                  style={[
                                                    { position: 'absolute' as const, left: 0, top: 0 },
                                                    imgStyle,
                                                    { opacity: 0.18, transform: [{ translateX: -1 }, { translateY: -0.7 }] },
                                                  ]}
                                                />
                                                <RNView pointerEvents="none" style={[StyleSheet.absoluteFill, styles.filterFadeLayer]} />
                                                <RNView pointerEvents="none" style={[StyleSheet.absoluteFill, styles.filterCoolLayer]} />
                                                <VignetteOverlay
                                                  width={photoBlockSize(block).width}
                                                  height={photoBlockSize(block).height}
                                                />
                                              </>
                                            )}
                                          </>
                                        );
                                      })()}
                                      {/* 선택 테두리는 photoBlockBase 자체가 아니라 겹치는 별도
                                          오버레이로 그린다 — photoBlockBase에 직접 border를 주면
                                          그 안의 퍼센트 기반 이미지가 border만큼 줄어든 영역을
                                          기준으로 채워져서 선택할 때마다 사진이 미세하게 작아
                                          보이는 문제가 있었다 */}
                                      {isSelected && (
                                        <RNView pointerEvents="none" style={[StyleSheet.absoluteFill, styles.photoBlockSelected]} />
                                      )}
                                    </AnimatedPressable>
                                    {/* 삭제 버튼은 여기(사진과 같이 확대/축소되는 자리)가 아니라
                                        캔버스 레벨에 별도로 떠서 사진이 캔버스보다 커져도 항상
                                        보이는 위치에 고정된다 — 아래 selectedPhotoBadgeBox 참고 */}
                                  </RNView>
                                ) : block.type === 'routine' ? (
                                  <RoutineBlockContent
                                    routine={routineById.get(block.routineId)}
                                    isCompleted={completedIds.has(block.routineId)}
                                    isSelected={isSelected}
                                    routineColorEnabled={routineColorEnabled}
                                    textColor={blockTextColor}
                                    accent={accent}
                                    styles={styles}
                                    scale={block.scale ?? 1}
                                    onPress={() => setSelectedBlockId((prev) => (prev === block.id ? null : block.id))}
                                    onHide={() => hideRoutineBlock(block.id, block.routineId)}
                                  />
                                ) : (
                                  <RNView style={styles.textChipWrap}>
                                    {isEditing ? (
                                      <TextInput
                                        autoFocus
                                        style={[styles.textChip, { color: blockTextColor }]}
                                        value={block.text}
                                        onChangeText={(v) => updateTextBlockText(block.id, v)}
                                        placeholder={t('photoDiary.notePlaceholder')}
                                        placeholderTextColor={withAlpha(blockTextColor, 0.5)}
                                        multiline
                                      />
                                    ) : (
                                      // 탭하면 선택 + 입력(키보드) 모드가 함께 켜진다. 손가락이
                                      // 스치기만 해도 곧장 포커스를 가져가 키보드가 깜빡이던 예전
                                      // 버그를 막기 위해 탭 전엔 포커스 없는 일반 텍스트로만
                                      // 보여준다. 탭 인식은 DraggableBlock의 onTap(gesture-handler
                                      // 기반)이 담당 — RN 기본 Pressable을 쓰면 두 손가락 중
                                      // 하나를 먼저 채가서 핀치(확대/축소) 인식이 잘 안 되는
                                      // 문제가 있었다
                                      <Text style={[styles.textChip, { color: blockTextColor }]}>
                                        {block.text || t('photoDiary.notePlaceholder')}
                                      </Text>
                                    )}
                                  </RNView>
                                )}
                              </DraggableBlock>
                            );
                          })}
                          {/* 사진 삭제 버튼은 사진 자체가 아니라 캔버스 기준 좌표로 따로 띄워서,
                              사진을 크게 확대해 배지가 사진의 실제 모서리에서 캔버스 밖으로
                              밀려나도 항상 지금 보이는 영역 안에서 누를 수 있게 한다 */}
                          {selectedBlock && selectedBlock.type === 'photo' && (
                            <AnimatedPressable
                              style={[styles.photoDeleteBadge, fitPhotoBadgePosition(selectedBlock)]}
                              onPress={() => removePhotoBlock(selectedBlock.id)}>
                              <Ionicons name="close" size={13} color="#fff" />
                            </AnimatedPressable>
                          )}
                          {/* 메모 삭제 버튼도 사진과 같은 방식 — 메모 자체에 붙이지 않고 캔버스
                              기준 좌표로 띄워서 크게 확대해도 항상 누를 수 있는 자리에 있다 */}
                          {selectedBlock && selectedBlock.type === 'text' && (
                            <AnimatedPressable
                              style={[styles.chipDeleteBadgeLight, fitTextBadgePosition(selectedBlock)]}
                              onPress={() => removeTextBlock(selectedBlock.id)}>
                              <Ionicons name="close" size={11} color="#fff" />
                            </AnimatedPressable>
                          )}
                    </RNView>
                  </ViewShot>
                </RNView>
                </RNView>

                <>
                    <View style={styles.routineToolsRow}>
                      <AnimatedPressable style={styles.addNoteButton} onPress={addTextNote}>
                        <Ionicons name="add-circle-outline" size={16} color={accent} />
                        <Text style={styles.addNoteButtonText} numberOfLines={1}>
                          {t('photoDiary.addNote')}
                        </Text>
                      </AnimatedPressable>
                      <AnimatedPressable style={styles.addNoteButton} onPress={openAddPhoto} disabled={isBusy}>
                        <Ionicons name="image-outline" size={16} color={accent} />
                        <Text style={styles.addNoteButtonText} numberOfLines={1}>
                          {t('photoDiary.addPhoto')}
                        </Text>
                      </AnimatedPressable>
                      <AnimatedPressable style={styles.addNoteButton} onPress={pasteFromClipboard} disabled={isBusy}>
                        <Ionicons name="clipboard-outline" size={16} color={accent} />
                        <Text style={styles.addNoteButtonText} numberOfLines={1}>
                          {t('photoDiary.pasteButton')}
                        </Text>
                      </AnimatedPressable>
                      {blocks.some((b) => b.type === 'text') && (
                        <AnimatedPressable style={styles.addNoteButton} onPress={() => setShowDeleteAllNotesConfirm(true)}>
                          <Ionicons name="trash-outline" size={16} color={textMuted} />
                          <Text style={[styles.addNoteButtonText, { color: textMuted }]} numberOfLines={1}>
                            {t('photoDiary.deleteAllNotesButton')}
                          </Text>
                        </AnimatedPressable>
                      )}
                    </View>
                    <View style={styles.colorToggleRow}>
                      {mode === 'routines' && (
                        <>
                          <Text style={styles.colorToggleLabel}>{t('photoDiary.routineColorToggle')}</Text>
                          {/* 예전 네이티브 Switch(안드로이드 스타일: 얇은 선 위에 동그란 손잡이가
                              겹쳐서 움직이는 모양)를 흉내내되, AnimatedPressable로 직접 눌러서
                              토글한다 — 네이티브 Switch는 배경 탭 해제 제스처(backgroundTap)가
                              감싸는 영역 안에서 터치가 간헐적으로 씹혀 눌러도 안 바뀌는 문제가 있었다 */}
                          <AnimatedPressable
                            onPress={() => setRoutineColorEnabled((prev) => !prev)}
                            hitSlop={8}
                            style={styles.routineSwitchTouchArea}>
                            <RNView
                              style={[
                                styles.routineSwitchTrack,
                                { backgroundColor: routineColorEnabled ? withAlpha(accent, 0.5) : '#ccc' },
                              ]}
                            />
                            <Animated.View
                              style={[
                                styles.routineSwitchThumb,
                                { backgroundColor: routineColorEnabled ? accent : '#f4f3f4' },
                                routineSwitchThumbStyle,
                              ]}
                            />
                          </AnimatedPressable>
                        </>
                      )}
                      <Text style={[styles.colorToggleLabel, mode === 'routines' && styles.textColorLabel]}>
                        {t('photoDiary.textColorLabel')}
                      </Text>
                      {(['black', 'white', 'accent'] as const).map((mode) => (
                        <AnimatedPressable
                          key={mode}
                          onPress={() => setTextColorMode(mode)}
                          style={[
                            styles.textColorSwatch,
                            { backgroundColor: resolveTextColor(mode, accent) },
                            textColorMode === mode && styles.textColorSwatchSelected,
                          ]}
                        />
                      ))}
                      <AnimatedPressable
                        style={styles.changePhotoInlineButton}
                        onPress={openChangeCoverPhoto}
                        disabled={isBusy}>
                        <Ionicons name="camera-outline" size={13} color={accent} />
                        <Text style={styles.changePhotoInlineText}>{t('photoDiary.changePhoto')}</Text>
                      </AnimatedPressable>
                    </View>

                    {selectedBlockSupportsColor && selectedBlock && (
                      <View style={styles.colorToggleRow}>
                        <Text style={styles.colorToggleLabel}>{t('photoDiary.individualTextColorLabel')}</Text>
                        {(['black', 'white', 'accent'] as const).map((mode) => (
                          <AnimatedPressable
                            key={mode}
                            onPress={() => updateBlockTextColor(selectedBlock.id, mode)}
                            style={[
                              styles.textColorSwatch,
                              { backgroundColor: resolveTextColor(mode, accent) },
                              (selectedBlock.type === 'routine' || selectedBlock.type === 'text') &&
                                selectedBlock.textColor === mode &&
                                styles.textColorSwatchSelected,
                            ]}
                          />
                        ))}
                        <AnimatedPressable onPress={() => updateBlockTextColor(selectedBlock.id, undefined)} hitSlop={6}>
                          <Text style={styles.restoreText}>{t('photoDiary.individualTextColorReset')}</Text>
                        </AnimatedPressable>
                        <AnimatedPressable onPress={() => resetBlockRotation(selectedBlock.id)} hitSlop={6}>
                          <Text style={styles.restoreText}>{t('photoDiary.resetRotation')}</Text>
                        </AnimatedPressable>
                      </View>
                    )}

                    {selectedBlock && selectedBlock.type === 'photo' && (
                      <View style={styles.colorToggleRow}>
                        <AnimatedPressable
                          style={styles.changePhotoInlineButton}
                          onPress={() => fitPhotoToCanvasWidth(selectedBlock.id)}>
                          <Ionicons name="resize-outline" size={13} color={accent} />
                          <Text style={styles.changePhotoInlineText}>{t('photoDiary.fitPhotoWidth')}</Text>
                        </AnimatedPressable>
                        {/* 촬영 시 고른 디카 필터를 캔버스에서도 켜고 끌 수 있게 — 붙여넣기한
                            사진처럼 촬영 당시 선택을 못 한 사진에도 나중에 적용/해제 가능 */}
                        <AnimatedPressable
                          style={[
                            styles.changePhotoInlineButton,
                            (selectedBlock.vintage ?? selectedBlock.source === 'camera') && { backgroundColor: accent },
                          ]}
                          onPress={() => toggleBlockVintage(selectedBlock.id)}>
                          <Ionicons
                            name="color-filter-outline"
                            size={13}
                            color={selectedBlock.vintage ?? selectedBlock.source === 'camera' ? '#fff' : accent}
                          />
                          <Text
                            style={[
                              styles.changePhotoInlineText,
                              (selectedBlock.vintage ?? selectedBlock.source === 'camera') && { color: '#fff' },
                            ]}>
                            {t('photoDiary.toggleVintageFilter')}
                          </Text>
                        </AnimatedPressable>
                      </View>
                    )}

                    {mode === 'routines' && hiddenRoutineIds.length > 0 && (
                      <View style={styles.hiddenSection}>
                        <Text style={styles.hiddenSectionTitle}>
                          {t('photoDiary.hiddenSectionTitle')} ({hiddenRoutineIds.length})
                        </Text>
                        <Text style={styles.hiddenSectionDesc}>{t('photoDiary.hiddenSectionDesc')}</Text>
                        {hiddenRoutineIds.map((id) => {
                          const routine = routineById.get(id);
                          if (!routine) return null;
                          return (
                            <View key={id} style={styles.hiddenRow}>
                              <Text style={styles.hiddenRowText} numberOfLines={1}>
                                {routine.title}
                              </Text>
                              <AnimatedPressable onPress={() => restoreRoutine(id)} hitSlop={6}>
                                <Text style={styles.restoreText}>{t('photoDiary.addBack')}</Text>
                              </AnimatedPressable>
                            </View>
                          );
                        })}
                      </View>
                    )}
                </>

                <View style={styles.imageActionsRow}>
                  <AnimatedPressable style={styles.imageActionButton} onPress={handleSaveImage} disabled={isBusy}>
                    <Ionicons name="download-outline" size={16} color={accent} />
                    <Text style={styles.imageActionText}>{t('photoDiary.saveImage')}</Text>
                  </AnimatedPressable>
                  <AnimatedPressable style={styles.imageActionButton} onPress={handleShare} disabled={isBusy}>
                    <Ionicons name="share-social-outline" size={16} color={accent} />
                    <Text style={styles.imageActionText}>{t('photoDiary.share')}</Text>
                  </AnimatedPressable>
                </View>
              </>
            )}

            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

            {photoUri && mode && (
              <>
                <AnimatedPressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>{t('today.save')}</Text>
                  )}
                </AnimatedPressable>
                {/* 저장된 항목(entryId)이 있을 때만 "사진일기 삭제"도 같이 뜨므로, 그때는 임시저장
                    삭제와 좌우로 나란히, 신규 작성 중(아직 저장 전)엔 임시저장 삭제만 가운데 */}
                <View style={[styles.bottomLinksRow, !entryId && styles.bottomLinksRowSingle]}>
                  <AnimatedPressable
                    style={styles.discardDraftLink}
                    disabled={isSaving}
                    onPress={() => setShowDiscardDraftConfirm(true)}>
                    <Text style={styles.discardDraftLinkText}>{t('photoDiary.discardDraftButton')}</Text>
                  </AnimatedPressable>
                  {entryId && (
                    <AnimatedPressable
                      style={styles.deleteLinkBottom}
                      onPress={() => setShowDeleteConfirm(true)}
                      disabled={isSaving}>
                      <Text style={styles.deleteLinkBottomText}>{t('photoDiary.deleteButton')}</Text>
                    </AnimatedPressable>
                  )}
                </View>
              </>
            )}
            </RNView>
          </GestureDetector>
        </ScrollView>
      </RNView>

      <Modal visible={showSourceModal} transparent animationType="fade" onRequestClose={() => setShowSourceModal(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowSourceModal(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.chooseSourceTitle')}</Text>
            <AnimatedPressable style={styles.optionRow} onPress={requestCameraCapture}>
              <Ionicons name="camera-outline" size={20} color={accent} />
              <Text style={styles.optionRowText}>{t('photoDiary.takePhoto')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.optionRow} onPress={requestLibraryPick}>
              <Ionicons name="images-outline" size={20} color={accent} />
              <Text style={styles.optionRowText}>{t('photoDiary.pickFromLibrary')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowSourceModal(false)}>
              <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
            </AnimatedPressable>
          </ShadowCard>
        </RNView>
      </Modal>

      {/* 이 모달은 신규 작성 흐름(entryId 없음)에서만 뜨고, 여기서 뒤로가기를 누르면 모달만
          닫히고 사진은 골랐지만 모드는 없는 어중간한 화면에 남던 버그가 있었음 — 뒤로가기 시
          사진일기 만들기 전이었던 일기 화면(diary-form)까지 통째로 나가도록 수정 */}
      <Modal visible={showModeModal} transparent animationType="fade" onRequestClose={() => router.back()}>
        <RNView style={styles.confirmBackdrop}>
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.chooseModeTitle')}</Text>
            <AnimatedPressable style={styles.optionRow} onPress={() => chooseMode('text')}>
              <Ionicons name="create-outline" size={20} color={accent} />
              <Text style={styles.optionRowText}>{t('photoDiary.modeText')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.optionRow} onPress={() => chooseMode('routines')}>
              <Ionicons name="list-outline" size={20} color={accent} />
              <Text style={[styles.optionRowText, { flex: 1 }]}>{t('photoDiary.modeRoutines')}</Text>
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedBadgeText}>{t('photoDiary.recommendedBadge')}</Text>
              </View>
            </AnimatedPressable>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowDeleteConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.deleteConfirmTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('photoDiary.deleteConfirmDesc')}</Text>
            <View style={styles.confirmButtonRow}>
              <AnimatedPressable
                style={[styles.confirmCancelButton, { flex: 1 }]}
                onPress={() => setShowDeleteConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.confirmDeleteButton} onPress={performDelete} disabled={isSaving}>
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmDeleteText}>{t('myRoutines.delete')}</Text>
                )}
              </AnimatedPressable>
            </View>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal
        visible={showDeleteAllNotesConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteAllNotesConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowDeleteAllNotesConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.deleteAllNotesConfirmTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('photoDiary.deleteAllNotesConfirmDesc')}</Text>
            <View style={styles.confirmButtonRow}>
              <AnimatedPressable
                style={[styles.confirmCancelButton, { flex: 1 }]}
                onPress={() => setShowDeleteAllNotesConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.confirmDeleteButton}
                onPress={() => {
                  deleteAllTextBlocks();
                  setShowDeleteAllNotesConfirm(false);
                }}>
                <Text style={styles.confirmDeleteText}>{t('photoDiary.deleteAllNotesButton')}</Text>
              </AnimatedPressable>
            </View>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal
        visible={showDiscardDraftConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDiscardDraftConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowDiscardDraftConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.discardDraftConfirmTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('photoDiary.discardDraftConfirmDesc')}</Text>
            <View style={styles.confirmButtonRow}>
              <AnimatedPressable
                style={[styles.confirmCancelButton, { flex: 1 }]}
                onPress={() => setShowDiscardDraftConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.primaryConfirmButton}
                onPress={() => {
                  discardDraft();
                  setShowDiscardDraftConfirm(false);
                }}>
                <Text style={styles.primaryConfirmText}>{t('photoDiary.discardDraftButton')}</Text>
              </AnimatedPressable>
            </View>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal visible={showHelpModal} transparent animationType="fade" onRequestClose={() => setShowHelpModal(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowHelpModal(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.helpTitle')}</Text>
            <View style={styles.helpBulletList}>
              {(
                [
                  ['move-outline', t('photoDiary.helpTitle1'), t('photoDiary.helpDesc1')],
                  ['create-outline', t('photoDiary.helpTitle2'), t('photoDiary.helpDesc2')],
                  ['scan-outline', t('photoDiary.helpTitle7'), t('photoDiary.helpDesc7')],
                ] as const
              ).map(([icon, title, desc]) => (
                <View key={title} style={styles.helpRow}>
                  <View style={styles.helpIconBadge}>
                    <Ionicons name={icon} size={17} color={accent} />
                  </View>
                  <View style={styles.helpTextCol}>
                    <Text style={styles.helpRowTitle}>{title}</Text>
                    <Text style={styles.helpRowDesc}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowHelpModal(false)}>
              <Text style={styles.confirmCancelText}>{t('photoDiary.helpCloseButton')}</Text>
            </AnimatedPressable>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal
        visible={showPasteEmptyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasteEmptyModal(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowPasteEmptyModal(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <RNView style={styles.pasteEmptyIconBadge}>
              <Ionicons name="clipboard-outline" size={26} color={accent} />
            </RNView>
            <Text style={styles.confirmTitle}>{t('photoDiary.pasteEmptyTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('photoDiary.pasteEmptyDesc')}</Text>
            <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowPasteEmptyModal(false)}>
              <Text style={styles.confirmCancelText}>{t('photoDiary.helpCloseButton')}</Text>
            </AnimatedPressable>
          </ShadowCard>
        </RNView>
      </Modal>

      <InAppCamera
        visible={showInAppCamera}
        onClose={() => setShowInAppCamera(false)}
        onCapture={handleCameraCaptured}
      />

      {focalEditBlock && (
        <PhotoFocalEditorModal
          visible
          uri={focalEditBlock.uri}
          aspect={(() => {
            const size = photoBlockSize(focalEditBlock);
            return size.width / size.height;
          })()}
          initialCropX={focalEditBlock.cropX}
          initialCropY={focalEditBlock.cropY}
          initialCropW={focalEditBlock.cropW}
          initialCropH={focalEditBlock.cropH}
          onCancel={() => setFocalEditBlockId(null)}
          onConfirm={(cropX, cropY, cropW, cropH, frameAspect) => {
            updateBlockCrop(focalEditBlock.id, cropX, cropY, cropW, cropH, frameAspect);
            setFocalEditBlockId(null);
          }}
          accent={accent}
          styles={styles}
          t={t}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// 루틴 블록의 칩 + (선택됐을 때만 보이는) 숨기기 배지 — 컴포넌트로 빼서 위 렌더 부분을 단순화
function RoutineBlockContent({
  routine,
  isCompleted,
  isSelected,
  routineColorEnabled,
  textColor,
  accent,
  styles,
  scale,
  onPress,
  onHide,
}: {
  routine: Routine | undefined;
  isCompleted: boolean;
  isSelected: boolean;
  routineColorEnabled: boolean;
  textColor: string;
  accent: string;
  styles: ReturnType<typeof createStyles>;
  scale: number;
  onPress: () => void;
  onHide: () => void;
}) {
  if (!routine) return null;
  return (
    <RNView>
      <AnimatedPressable
        style={[
          styles.routineChip,
          routineColorEnabled
            ? { backgroundColor: withAlpha(accent, 0.16), borderColor: accent }
            : styles.routineChipNeutral,
        ]}
        onPress={onPress}>
        {isCompleted && <Ionicons name="checkmark-circle" size={13} color={accent} />}
        <Text style={[styles.routineChipText, { color: textColor }]} numberOfLines={1}>
          {routine.title}
        </Text>
      </AnimatedPressable>
      {isSelected && (
        // 블록이 작게 축소되면 배지도 같이 줄어들어 누르기 어려워지므로, 부모 스케일의
        // 역수만큼 되돌려 항상 원래 크기로 보이게 한다
        <AnimatedPressable
          style={[styles.chipHideBadge, { transform: [{ scale: 1 / scale }] }]}
          onPress={onHide}>
          <Ionicons name="close" size={12} color="#fff" />
        </AnimatedPressable>
      )}
    </RNView>
  );
}

// 사진 위치 조정 화면의 미리보기 한 변 최대 길이, 프레임 모서리 손잡이 인식 여백 —
// 캔버스 리사이즈 손잡이와 같은 값을 재사용해 손가락 인식 크기를 통일한다
const FOCAL_PREVIEW_MAX = 300;

// 사진 더블탭으로 여는 "사진 위치 조정" 모달. 처음엔 확대된 이미지를 고정 틀 안에서 파는
// 방식이었는데 손가락 인식이 잘 안 된다는 피드백으로, 원본 사진 전체를 보여주고(resizeMode
// contain) 그 위에 목표 비율의 네모 프레임을 얹어 프레임 자체를 드래그(이동)·모서리로
// 크기조절(줌)하는 방식으로 다시 만들었다 — 터치 영역이 훨씬 커져서 인식이 쉬워지고, 프레임을
// 최대로 키우면(비율이 맞으면) 사진 전체를, 안 맞아도 이미지 안에 들어가는 가장 큰 영역을 담는다
function PhotoFocalEditorModal({
  visible,
  uri,
  aspect,
  initialCropX,
  initialCropY,
  initialCropW,
  initialCropH,
  onCancel,
  onConfirm,
  accent,
  styles,
  t,
}: {
  visible: boolean;
  uri: string;
  // 프레임을 처음 열 때 기준으로 쓰는 지금 박스의 가로/세로 비율 — 저장된 crop이 없을 때만 쓰인다
  aspect: number;
  initialCropX?: number;
  initialCropY?: number;
  initialCropW?: number;
  initialCropH?: number;
  onCancel: () => void;
  // cropX/Y/W/H(원본 이미지 기준 0~1)와 그 프레임의 가로세로 비율(frameAspect)을 함께 넘긴다 —
  // 프레임 모양을 바꾸면 사진 박스의 모양도 같이 바뀌어야 왜곡 없이 반영되기 때문
  onConfirm: (cropX: number, cropY: number, cropW: number, cropH: number, frameAspect: number) => void;
  accent: string;
  styles: ReturnType<typeof createStyles>;
  t: (key: TranslationKey) => string;
}) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNaturalSize(null);
    Image.getSize(
      uri,
      (width, height) => setNaturalSize({ width, height }),
      // 크기 조회 실패해도 편집 자체는 가능하게 대략적인 기본 비율로 대체
      () => setNaturalSize({ width: 4, height: 3 })
    );
  }, [visible, uri]);

  const previewBox = Math.min(FOCAL_PREVIEW_MAX, Dimensions.get('window').width - 80);
  // "contain" 방식으로 원본 사진 전체가 previewBox 정사각형 안에 다 보이도록(레터박스 포함) 크기 계산
  let dispW = previewBox;
  let dispH = previewBox;
  if (naturalSize) {
    const imgAspect = naturalSize.width / naturalSize.height;
    if (imgAspect > 1) {
      dispW = previewBox;
      dispH = previewBox / imgAspect;
    } else {
      dispH = previewBox;
      dispW = previewBox * imgAspect;
    }
  }
  const imgOffsetX = (previewBox - dispW) / 2;
  const imgOffsetY = (previewBox - dispH) / 2;

  // 프레임 크기(가로/세로 각각, 표시된 사진 기준 px)·중심 오프셋 — 손잡이로 가로/세로를 각각
  // 자유롭게 바꿀 수 있어(모양 자체를 바꿀 수 있음) 더 이상 목표 비율에 고정하지 않는다
  const frameW = useSharedValue(dispW);
  const frameH = useSharedValue(dispH);
  const frameCx = useSharedValue(0);
  const frameCy = useSharedValue(0);
  const startW = useSharedValue(dispW);
  const startH = useSharedValue(dispH);
  const startCx = useSharedValue(0);
  const startCy = useSharedValue(0);

  // 모달을 다시 열거나(다른 사진) 사진 크기 조회가 끝나면, 그 사진에 저장된 crop(있으면) 또는
  // 기본값(없으면, 지금 박스 비율 기준 85% 크기 — 처음부터 꽉 채우면 팬 여유가 없어 안 움직임)으로
  // 프레임을 맞춘다
  useEffect(() => {
    if (!visible || !naturalSize) return;
    let w: number;
    let h: number;
    if (initialCropW && initialCropH) {
      w = initialCropW * dispW;
      h = initialCropH * dispH;
    } else {
      let mw = dispW;
      let mh = dispW / aspect;
      if (mh > dispH) {
        mh = dispH;
        mw = dispH * aspect;
      }
      w = mw * DEFAULT_FOCAL_EDIT_SCALE;
      h = mh * DEFAULT_FOCAL_EDIT_SCALE;
    }
    w = Math.min(dispW, Math.max(MIN_FRAME_PX, w));
    h = Math.min(dispH, Math.max(MIN_FRAME_PX, h));
    const frameLeft = initialCropX !== undefined && initialCropW ? initialCropX * dispW : (dispW - w) / 2;
    const frameTop = initialCropY !== undefined && initialCropH ? initialCropY * dispH : (dispH - h) / 2;
    const maxOffX = (dispW - w) / 2;
    const maxOffY = (dispH - h) / 2;
    const cx = Math.min(maxOffX, Math.max(-maxOffX, frameLeft - (dispW / 2 - w / 2)));
    const cy = Math.min(maxOffY, Math.max(-maxOffY, frameTop - (dispH / 2 - h / 2)));
    frameW.value = w;
    startW.value = w;
    frameH.value = h;
    startH.value = h;
    frameCx.value = cx;
    startCx.value = cx;
    frameCy.value = cy;
    startCy.value = cy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, naturalSize, initialCropX, initialCropY, initialCropW, initialCropH, aspect, dispW, dispH]);

  const framePan = Gesture.Pan()
    .onUpdate((e) => {
      const maxOffX = (dispW - frameW.value) / 2;
      const maxOffY = (dispH - frameH.value) / 2;
      frameCx.value = Math.min(maxOffX, Math.max(-maxOffX, startCx.value + e.translationX));
      frameCy.value = Math.min(maxOffY, Math.max(-maxOffY, startCy.value + e.translationY));
    })
    .onEnd(() => {
      startCx.value = frameCx.value;
      startCy.value = frameCy.value;
    });

  // 모서리 손잡이를 끌면 가로/세로가 각각 따로 커지거나 작아진다(모양 자체도 바뀜) — 캔버스의
  // 사진 크기조절 손잡이와 같은 방식·같은 hitSlop
  const cornerPan = Gesture.Pan()
    .hitSlop(RESIZE_HANDLE_HIT_SLOP)
    .onUpdate((e) => {
      const w = Math.min(dispW, Math.max(MIN_FRAME_PX, startW.value + e.translationX));
      const h = Math.min(dispH, Math.max(MIN_FRAME_PX, startH.value + e.translationY));
      frameW.value = w;
      frameH.value = h;
      const maxOffX = (dispW - w) / 2;
      const maxOffY = (dispH - h) / 2;
      frameCx.value = Math.min(maxOffX, Math.max(-maxOffX, frameCx.value));
      frameCy.value = Math.min(maxOffY, Math.max(-maxOffY, frameCy.value));
    })
    .onEnd(() => {
      startW.value = frameW.value;
      startH.value = frameH.value;
      startCx.value = frameCx.value;
      startCy.value = frameCy.value;
    });

  const frameAnimatedStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: imgOffsetX + dispW / 2 - frameW.value / 2 + frameCx.value,
    top: imgOffsetY + dispH / 2 - frameH.value / 2 + frameCy.value,
    width: frameW.value,
    height: frameH.value,
  }));

  const handleAnimatedStyle = useAnimatedStyle(() => {
    const left = imgOffsetX + dispW / 2 - frameW.value / 2 + frameCx.value;
    const top = imgOffsetY + dispH / 2 - frameH.value / 2 + frameCy.value;
    return {
      position: 'absolute' as const,
      left: left + frameW.value - RESIZE_HANDLE_SIZE / 2,
      top: top + frameH.value - RESIZE_HANDLE_SIZE / 2,
    };
  });

  function handleConfirm() {
    const w = frameW.value;
    const h = frameH.value;
    const frameLeft = dispW / 2 - w / 2 + frameCx.value;
    const frameTop = dispH / 2 - h / 2 + frameCy.value;
    onConfirm(frameLeft / dispW, frameTop / dispH, w / dispW, h / dispH, w / h);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* RN Modal은 앱 루트(app/_layout.tsx)와 별도의 네이티브 화면으로 그려져서, 거기서
          한 번 감싼 GestureHandlerRootView 밖으로 벗어난다 — 그 안에서는
          react-native-gesture-handler 제스처(GestureDetector)가 아예 인식되지 않는(터치
          자체가 안 먹는) 안드로이드/iOS 공통 문제가 있어서, 모달 전용으로 한 번 더 감싼다 */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <RNView style={styles.confirmBackdrop}>
        <AnimatedPressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{t('photoDiary.focalEditTitle')}</Text>
          <Text style={styles.confirmDesc}>{t('photoDiary.focalEditDesc')}</Text>
          {!naturalSize ? (
            <RNView style={[styles.focalPreviewBox, { width: previewBox, height: previewBox }]}>
              <ActivityIndicator color={accent} />
            </RNView>
          ) : (
            <RNView style={[styles.focalPreviewBox, { width: previewBox, height: previewBox }]}>
              <Image
                source={{ uri }}
                resizeMode="contain"
                style={{ position: 'absolute', left: imgOffsetX, top: imgOffsetY, width: dispW, height: dispH }}
              />
              <GestureDetector gesture={framePan}>
                <Animated.View style={[styles.focalFrame, frameAnimatedStyle]} />
              </GestureDetector>
              <GestureDetector gesture={cornerPan}>
                <Animated.View style={[styles.focalFrameHandle, { backgroundColor: accent }, handleAnimatedStyle]}>
                  <Ionicons name="resize" size={16} color="#fff" />
                </Animated.View>
              </GestureDetector>
            </RNView>
          )}
          <View style={styles.confirmButtonRow}>
            <AnimatedPressable style={[styles.confirmCancelButton, { flex: 1 }]} onPress={onCancel}>
              <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.primaryConfirmButton} onPress={handleConfirm} disabled={!naturalSize}>
              <Text style={styles.primaryConfirmText}>{t('photoDiary.focalEditConfirm')}</Text>
            </AnimatedPressable>
          </View>
        </ShadowCard>
      </RNView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toast: {
      position: 'absolute',
      top: 64,
      alignSelf: 'center',
      zIndex: 20,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 8,
      paddingHorizontal: 16,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    toastText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
    },
    inner: {
      flexGrow: 1,
      padding: 20,
      paddingTop: 4,
      // 안드로이드 시스템 내비게이션 바(제스처/뒤로가기 버튼)와 맨 아래 삭제 링크가
      // 겹쳐 보이던 문제로 하단 여백을 더 넉넉하게 둠 — "저장" 버튼에서 뚝 떨어져 붕 뜬
      // 느낌이 든다는 피드백으로 살짝 더 키움(항상 뒤로가기 버튼보다는 위에 있음)
      paddingBottom: 52,
    },
    // 임시저장 삭제(왼쪽)와 사진일기 삭제(오른쪽)를 한 줄에 나란히 — 사진일기 삭제 버튼이
    // 없을 때(신규 작성 중)는 bottomLinksRowSingle로 가운데 정렬만 남긴다
    bottomLinksRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      // "저장" 버튼에 너무 붙어서 어중간하게 떠 보인다는 피드백으로 간격을 넓힘
      marginTop: 22,
      // 양 끝(space-between)이 너무 멀어 보인다는 피드백으로 좌우를 20px씩 안으로 당김
      paddingHorizontal: 20,
    },
    bottomLinksRowSingle: {
      justifyContent: 'center',
    },
    deleteLinkBottom: {
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    deleteLinkBottomText: {
      color: accent,
      fontSize: 13,
      fontWeight: '600',
    },
    pickPhotoBox: {
      minHeight: 240,
      borderWidth: 1,
      borderColor: withAlpha(accent, 0.2),
      borderRadius: cardRadius,
      backgroundColor: withAlpha(accent, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    pickPhotoIconBadge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    pickPhotoText: {
      color: accent,
      fontWeight: '700',
      fontSize: 16,
    },
    pickPhotoSubtext: {
      fontSize: 12,
      opacity: 0.5,
      textAlign: 'center',
      paddingHorizontal: 28,
    },
    templateWrap: {
      alignSelf: 'center',
      marginTop: 20,
    },
    // 사진일기 전체 범위를 은은한 주색 테두리로 안내 — ViewShot 바깥이라 저장/공유 이미지에는
    // 찍히지 않고, 편집 화면에서만 "여기까지가 사진일기예요"를 알려주는 용도
    templateFrame: {
      alignSelf: 'center',
      borderWidth: 1.5,
      borderColor: withAlpha(accent, 0.45),
      borderRadius: cardRadius,
      overflow: 'hidden',
    },
    // 모서리를 여기서 둥글게 자르면(borderRadius+overflow:hidden), 이미지로 저장/공유할 때는
    // templateFrame(편집 화면 안내선, 캡처 범위 밖)의 둥근 테두리가 없어서 둥글게 잘려나간
    // 네 모서리 바깥 자리에 색이 하나도 안 칠해진 채로 남고, JPG는 투명을 지원 안 해서 그
    // 자리가 검정으로 나왔다 — 모서리는 templateFrame이 이미 화면에서 둥글게 잘라 보여주므로
    // (편집 화면 모양은 그대로 유지됨), 실제로 캡처되는 이 뷰는 흰 배경의 각진 사각형으로 둬서
    // 저장/공유 이미지에서 모서리가 항상 깔끔한 흰색(또는 사진)으로 나오게 한다
    template: {
      backgroundColor: '#ffffff',
    },
    templateInner: {
      backgroundColor: '#ffffff',
      position: 'relative',
    },
    // 캔버스 위 "사진" 블록의 실제 크기는 DraggableBlock의 sizeMode="box"가 감싸는 바깥
    // Animated.View가 결정한다(가로/세로 독립 조절 가능) — 여기선 그 크기를 그대로 채운다
    photoBlockBase: {
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    },
    photoBlockSelected: {
      borderWidth: 2,
      borderColor: accent,
    },
    // 블러 없이 톤만으로 옛날 디카(CCD 센서 특유의 살짝 어둡고 채도는 낮은데 오히려 색이
    // 진해 보이는) 느낌을 내는 2겹 레이어 — fade(어두운 무채색)를 살짝 섞어서 전체를
    // 조금 어둡게+채도를 낮추고(예전엔 반대로 밝은 회백색을 섞어 바랜 느낌을 냈는데, 그러면
    // 대비가 빠지고 색이 흐려져서 "쨍하고 진한" 느낌과 반대가 됐었다), cool(옅은 청록)로
    // 전체 색온도를 차갑게 낮춘다. 테마색(주색)은 사용자마다 달라 느낌이 일정하지 않을 수
    // 있어 이 필터엔 안 쓰고 고정 색으로 둔다
    filterFadeLayer: {
      backgroundColor: 'rgba(30, 32, 38, 0.14)',
    },
    filterCoolLayer: {
      backgroundColor: 'rgba(120, 170, 200, 0.06)',
    },
    emptyCanvasText: {
      position: 'absolute',
      top: CANVAS_PHOTO_HEIGHT + 16,
      left: 16,
      fontSize: 13,
      opacity: 0.5,
    },
    routineChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: ROUTINE_COL_WIDTH,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1.5,
    },
    routineChipNeutral: {
      backgroundColor: '#f2f2f2',
      borderColor: border,
    },
    routineChipText: {
      fontSize: 13,
      fontWeight: '600',
      fontFamily: fontKorean.fontFamily,
    },
    chipHideBadge: {
      position: 'absolute',
      top: -8,
      right: -8,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: withAlpha(accent, 0.7),
      alignItems: 'center',
      justifyContent: 'center',
    },
    // left/top은 fitPhotoBadgePosition()이 매번 계산해서 넘겨준다(캔버스 안에서 항상
    // 보이는 위치로 고정하기 위해 사진 자신에 붙이지 않고 캔버스 기준 절대좌표로 띄움)
    photoDeleteBadge: {
      position: 'absolute',
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: withAlpha(accent, 0.7),
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
      zIndex: 5,
    },
    textChipWrap: {
      position: 'relative',
      minWidth: 60,
      maxWidth: CANVAS_WIDTH - 40,
    },
    // 노란 메모 박스가 사진과 안 어울린다는 피드백으로 배경/테두리를 없애고 글자만 남김 —
    // 여전히 DraggableBlock으로 감싸져 있어 자유롭게 드래그해서 옮길 수 있다
    textChip: {
      minWidth: 40,
      minHeight: 24,
      padding: 4,
      backgroundColor: 'transparent',
      fontSize: 15 + fontKorean.sizeAdjust,
      lineHeight: 20 + fontKorean.sizeAdjust,
      fontFamily: fontKorean.fontFamily,
      fontWeight: '600',
    },
    // left/top은 fitTextBadgePosition()이 매번 계산해서 넘겨준다(사진 삭제 배지와 같은 이유로
    // 메모 자체가 아니라 캔버스 기준 절대좌표로 띄움)
    chipDeleteBadgeLight: {
      position: 'absolute',
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: withAlpha(accent, 0.7),
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 4,
      zIndex: 5,
    },
    // 4개(메모/사진/붙여넣기/메모삭제)가 화면 폭에 상관없이 항상 한 줄에 다 들어가도록
    // 폭을 나눠 갖게 한다(flexWrap 없이 각자 flex:1)
    routineToolsRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 4,
      marginTop: 14,
    },
    addNoteButton: {
      flex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    },
    addNoteButtonText: {
      color: accent,
      fontSize: 11.5,
      fontWeight: '600',
    },
    colorToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    colorToggleLabel: {
      fontSize: 12,
      opacity: 0.6,
    },
    textColorLabel: {
      marginLeft: 8,
    },
    textColorSwatch: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: border,
    },
    textColorSwatchSelected: {
      borderWidth: 2,
      borderColor: accent,
    },
    // "글자색" 줄 맨 끝, 스와치 옆 남는 자리에 들어가는 작은 사진 바꾸기 버튼(루틴 모드 전용) —
    // 사진 위에 겹쳐 뜨던 버튼을 여기로 옮겨서 사진을 가리지 않게 한다
    changePhotoInlineButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(accent, 0.35),
    },
    changePhotoInlineText: {
      color: accent,
      fontSize: 11.5,
      fontWeight: '600',
    },
    // "루틴 색 강조" 토글 — 네이티브 Switch와 같은 모양(트랙+동그란 손잡이)을 직접 그린다
    // 터치 영역은 손잡이 높이만큼 확보(손잡이가 선보다 두꺼움) — 트랙은 그 안에서 세로 가운데,
    // 손잡이는 절대위치로 겹쳐서 좌우로만 움직인다
    routineSwitchTouchArea: {
      width: ROUTINE_SWITCH_TRACK_WIDTH,
      height: ROUTINE_SWITCH_THUMB,
      justifyContent: 'center',
    },
    routineSwitchTrack: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignSelf: 'center',
      height: ROUTINE_SWITCH_TRACK_HEIGHT,
      borderRadius: ROUTINE_SWITCH_TRACK_HEIGHT / 2,
    },
    routineSwitchThumb: {
      position: 'absolute',
      left: 0,
      width: ROUTINE_SWITCH_THUMB,
      height: ROUTINE_SWITCH_THUMB,
      borderRadius: ROUTINE_SWITCH_THUMB / 2,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    hiddenSection: {
      marginTop: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: border,
      borderRadius: cardRadius,
    },
    hiddenSectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      opacity: 0.6,
      marginBottom: 2,
    },
    hiddenSectionDesc: {
      fontSize: 11,
      opacity: 0.45,
      marginBottom: 8,
    },
    hiddenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    hiddenRowText: {
      flex: 1,
      fontSize: 13,
      opacity: 0.6,
    },
    restoreText: {
      color: accent,
      fontSize: 13,
      fontWeight: '600',
    },
    imageActionsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 20,
      marginTop: 16,
    },
    imageActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: accent,
      borderRadius: cardRadius,
    },
    imageActionText: {
      color: accent,
      fontSize: 13,
      fontWeight: '600',
    },
    error: {
      color: '#FF6B6B',
      marginTop: 12,
    },
    saveButton: {
      marginTop: 20,
      backgroundColor: accent,
      borderRadius: cardRadius,
      paddingVertical: 14,
      alignItems: 'center',
    },
    saveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    discardDraftLink: {
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    discardDraftLinkText: {
      color: textMuted,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    confirmBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
      paddingHorizontal: 32,
    },
    confirmCardOuter: {
      width: '100%',
    },
    confirmCard: {
      padding: 24,
      alignItems: 'stretch',
    },
    confirmTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 14,
      textAlign: 'center',
    },
    confirmDesc: {
      fontSize: 13,
      opacity: 0.5,
      marginBottom: 20,
      textAlign: 'center',
    },
    pasteEmptyIconBadge: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: withAlpha(accent, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 12,
    },
    helpBulletList: {
      gap: 22,
      marginBottom: 20,
    },
    helpRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    helpIconBadge: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: withAlpha(accent, 0.14),
      alignItems: 'center',
      justifyContent: 'center',
    },
    helpTextCol: {
      flex: 1,
      paddingTop: 3,
    },
    helpRowTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: accent,
      marginBottom: 3,
    },
    helpRowDesc: {
      fontSize: 13,
      lineHeight: 18.5,
      opacity: 0.65,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    optionRowText: {
      fontSize: 15,
    },
    recommendedBadge: {
      backgroundColor: withAlpha(accent, 0.15),
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 999,
    },
    recommendedBadgeText: {
      color: accent,
      fontSize: 11,
      fontWeight: '700',
    },
    confirmButtonRow: {
      flexDirection: 'row',
      gap: 10,
      width: '100%',
      marginTop: 8,
    },
    // flex:1은 confirmButtonRow(가로 배치) 안에서 짝지어 쓸 때만 필요하다. 세로로 쌓인
    // 컨테이너(예: 사진 선택 팝업의 "취소" 단독 버튼) 안에서 flex:1을 주면, 부모가 정해진
    // 높이가 없어 남는 공간을 나눠줄 게 없는 상태라 버튼 높이가 0으로 찌그러져 버튼 테두리만
    // 남고 글자가 통째로 안 보이는 버그가 있었음 — 기본값은 flex 없이 내용 크기로 두고,
    // 가로로 짝지어 쓰는 자리에서만 그때그때 flex:1을 따로 붙인다
    confirmCancelButton: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: cardRadius,
      borderWidth: 1,
      borderColor: border,
      marginTop: 14,
    },
    confirmCancelText: {
      fontSize: 14,
      fontWeight: '600',
      opacity: 0.6,
    },
    confirmDeleteButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: cardRadius,
      backgroundColor: '#FF6B6B',
    },
    confirmDeleteText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
    // "사진 위치 조정" 모달의 미리보기 액자 — 실제 사진 박스와 같은 가로세로 비율로 맞춰서
    // 여기서 고른 위치가 실제 캔버스에서도 그대로 보이게 한다
    focalPreviewBox: {
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: cardRadius,
      backgroundColor: '#eee',
      marginVertical: 16,
    },
    // 목표 비율의 크롭 프레임 — 반투명 배경 + 테두리로 "이 안이 담긴다"는 걸 보여준다
    focalFrame: {
      borderWidth: 2,
      borderColor: accent,
      backgroundColor: withAlpha(accent, 0.12),
    },
    focalFrameHandle: {
      width: RESIZE_HANDLE_SIZE,
      height: RESIZE_HANDLE_SIZE,
      borderRadius: RESIZE_HANDLE_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    // 삭제(빨강)만큼 무겁지 않은 확인 액션에 쓰는 주색 버튼 — 사진 위치 조정 "완료", 임시저장
    // 삭제 확인 등 여러 곳에서 재사용
    primaryConfirmButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: cardRadius,
      backgroundColor: accent,
    },
    primaryConfirmText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
  });
}
