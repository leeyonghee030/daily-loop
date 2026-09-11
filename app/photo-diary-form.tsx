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
import { BlurView } from 'expo-blur';
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
  Switch,
  TextInput,
  TouchableWithoutFeedback,
  View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// 일반 RN ScrollView는 react-native-gesture-handler로 만든 블록(드래그/핀치)과 같은 화면에
// 있으면 터치 우선권 협상 체계가 서로 달라서 스크롤이 자꾸 끊기는 문제가 있었음 — 같은
// 라이브러리의 ScrollView로 바꾸면 제스처 인식이 한 시스템 안에서 정리돼서 훨씬 안정적으로 동작한다
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
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
import { useTranslation } from '@/lib/language';
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
// (최초 로드)와 "임시저장 삭제(마지막 저장 상태로 되돌리기)" 둘 다에서 같은 로직을 쓴다
function buildBlocksFromEntry(entry: PhotoDiary, routineById: Map<string, Routine>): CanvasBlock[] {
  const filteredBlocks = (entry.blocks ?? []).filter((b) => (b.type === 'routine' ? routineById.has(b.routineId) : true));
  return filteredBlocks.some((b) => b.type === 'photo')
    ? filteredBlocks
    : [
        { id: nextBlockId(), type: 'photo' as const, uri: entry.photo_url, source: entry.photo_source, x: 0, y: 0, scale: 1 },
        ...filteredBlocks,
      ];
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
const MIN_BLOCK_SCALE = 0.6;
const MAX_BLOCK_SCALE = 2.2;

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
  pinchEnabled = true,
  onMove,
  onScale,
  onLayoutSize,
  children,
}: {
  x: number;
  y: number;
  scale?: number;
  pinchEnabled?: boolean;
  onMove: (x: number, y: number) => void;
  onScale?: (scale: number) => void;
  onLayoutSize?: (size: BlockSize) => void;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const gestureScale = useSharedValue(1);
  const baseScaleRef = useRef(scale);
  baseScaleRef.current = scale;

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

  // 선택된 블록에 한해서만, 작은 칩에서도 두 손가락을 정확히 올리기 쉽도록 핀치 인식 영역을 넓혀준다.
  // 확대/축소만 되고 그 상태로 손을 옮겨 위치를 못 바꾸면 불편하다는 피드백으로, 두 손가락의
  // 중심점(focal point)이 프레임마다 움직인 만큼을 그대로 이동량에 더해줘서 "핀치하면서 동시에
  // 이동"이 되게 한다(같은 translateX/Y를 Pan과 공유해서 애니메이션 스타일은 그대로 재사용)
  const pinchLastFocalX = useSharedValue(0);
  const pinchLastFocalY = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .enabled(pinchEnabled)
    .hitSlop(pinchEnabled ? 24 : 0)
    .onStart((e) => {
      pinchLastFocalX.value = e.focalX;
      pinchLastFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      // 손가락을 아주 작게 오므리면 배율이 최소치보다 한참 아래로 떨어졌다가 손을 떼는 순간
      // 최소치로 갑자기 튀어오르면서(고무줄처럼) 사진이 눈에 안 보이는 곳으로 훌쩍 이동한
      // 것처럼 느껴지는 버그가 있었음 — 손가락을 움직이는 동안에도 최종 배율과 같은 범위로
      // 미리 제한해서 미리보기와 실제 결과가 항상 일치하게 한다
      const proposedScale = baseScaleRef.current * e.scale;
      const clampedScale = Math.min(MAX_BLOCK_SCALE, Math.max(MIN_BLOCK_SCALE, proposedScale));
      gestureScale.value = clampedScale / baseScaleRef.current;
      translateX.value += e.focalX - pinchLastFocalX.value;
      translateY.value += e.focalY - pinchLastFocalY.value;
      pinchLastFocalX.value = e.focalX;
      pinchLastFocalY.value = e.focalY;
    })
    .onEnd((e) => {
      if (onScale) {
        const next = Math.min(MAX_BLOCK_SCALE, Math.max(MIN_BLOCK_SCALE, baseScaleRef.current * e.scale));
        runOnJS(onScale)(next);
      }
      runOnJS(onMove)(x + translateX.value, y + translateY.value);
      gestureScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    });

  const composedGesture = Gesture.Race(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale * gestureScale.value },
    ],
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
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

// 옛날 디지털카메라 특유의 살짝 어두워지는 가장자리(비네트) 느낌을 흉내낸다 — 사진 필터의
// 일부라 캡처(ViewShot) 범위 안에 있어야 하므로 SVG 오버레이로 그 위에 얹는다
function VignetteOverlay({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="photoVignette" cx="50%" cy="46%" r="72%">
          <Stop offset="55%" stopColor="#1a1a1a" stopOpacity={0} />
          <Stop offset="100%" stopColor="#1a1a1a" stopOpacity={0.3} />
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
  const [mode, setMode] = useState<PhotoDiaryMode | null>(null);
  const [content, setContent] = useState('');
  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const [hiddenRoutineIds, setHiddenRoutineIds] = useState<string[]>([]);
  const [routineColorEnabled, setRoutineColorEnabled] = useState(true);
  const [textColorMode, setTextColorMode] = useState<TextColorMode>('black');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // 메모(텍스트) 블록만 별도로 관리하는 "입력창(키보드) 모드" — 한 번 탭하면 이 상태가 돼서
  // 키보드가 뜨고, selectedBlockId(핀치/삭제뱃지용)와는 분리해서 더블탭으로만 진입하게 한다
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const tapTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
  const [showHelpModal, setShowHelpModal] = useState(false);
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

  // 기존에 저장된 사진일기가 있으면 그 값으로 화면을 채운다(수정 모드)
  useEffect(() => {
    const entry = diaryQuery.data;
    if (!entry) return;
    setEntryId(entry.id);
    setPhotoUri(entry.photo_url);
    setPhotoSource(entry.photo_source);
    setMode(entry.mode);
    setContent(entry.content ?? '');
    setRoutineColorEnabled(entry.routine_color_enabled);
    setTextColorMode(entry.text_color_mode);
    if (entry.mode === 'routines') {
      const savedBlocks = buildBlocksFromEntry(entry, routineById);
      setBlocks(savedBlocks);
      const placedRoutineIds = new Set(
        savedBlocks.filter((b): b is Extract<CanvasBlock, { type: 'routine' }> => b.type === 'routine').map((b) => b.routineId)
      );
      setHiddenRoutineIds(candidateRoutines.filter((r) => !placedRoutineIds.has(r.id)).map((r) => r.id));
    }
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
        if (typeof draft.content === 'string') setContent(draft.content);
        if (Array.isArray(draft.blocks)) setBlocks(draft.blocks);
        if (Array.isArray(draft.hiddenRoutineIds)) setHiddenRoutineIds(draft.hiddenRoutineIds);
        if (typeof draft.routineColorEnabled === 'boolean') setRoutineColorEnabled(draft.routineColorEnabled);
        if (draft.textColorMode) setTextColorMode(draft.textColorMode);
      })
      .catch(() => {});
  }, [draftKey, diaryQuery.isLoading]);

  useEffect(() => {
    // entryId가 있는(기존 항목을 수정 중인) 경우도 포함 — "사진 추가"로 카메라를 여는 동안
    // 앱이 재시작되면 그동안의 편집 내용을 잃지 않도록 항상 최신 상태를 기기에 남겨둔다
    if (!draftKey || !photoUri || !draftRestoredRef.current) return;
    const draft = { photoUri, photoSource, mode, content, blocks, hiddenRoutineIds, routineColorEnabled, textColorMode };
    AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(() => {});
  }, [draftKey, photoUri, photoSource, mode, content, blocks, hiddenRoutineIds, routineColorEnabled, textColorMode]);

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

  function handleCameraCaptured(uri: string) {
    setShowInAppCamera(false);
    onPhotoObtained(uri, 'camera');
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
  function addPhotoBlockFromUri(uri: string, source: PhotoSource, pasted = false) {
    setBlocks((prev) => [
      ...prev,
      { id: nextBlockId(), type: 'photo', uri, source, pasted, x: CANVAS_SIDE_MARGIN, y: CANVAS_PHOTO_HEIGHT + 12, scale: 0.6 },
    ]);
  }

  function onPhotoObtained(uri: string, source: PhotoSource) {
    if (photoPickTarget === 'add') {
      addPhotoBlockFromUri(uri, source);
      return;
    }
    setPhotoUri(uri);
    setPhotoSource(source);
    if (!entryId) {
      setShowModeModal(true);
      return;
    }
    // 기존 항목의 "사진 바꾸기"인 경우, 루틴 캔버스에 이미 있는 대표 사진 블록도 같이 바꿔서
    // 화면에 보이는 사진도 즉시 교체되게 한다(없으면 새로 만든다)
    if (mode === 'routines') {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.type === 'photo');
        if (idx === -1) {
          return [{ id: nextBlockId(), type: 'photo', uri, source, x: 0, y: 0, scale: 1 }, ...prev];
        }
        const next = [...prev];
        next[idx] = { ...(next[idx] as Extract<CanvasBlock, { type: 'photo' }>), uri, source };
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
        Alert.alert(t('photoDiary.pasteEmptyTitle'));
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
    if (nextMode === 'routines' && photoUri) {
      const toPlace = candidateRoutines.slice(0, MAX_AUTO_ROUTINE_BLOCKS);
      const overflow = candidateRoutines.slice(MAX_AUTO_ROUTINE_BLOCKS);
      setBlocks([
        { id: nextBlockId(), type: 'photo', uri: photoUri, source: photoSource, x: 0, y: 0, scale: 1 },
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

  function deleteAllTextBlocks() {
    const textIds = new Set(blocks.filter((b) => b.type === 'text').map((b) => b.id));
    setBlocks((prev) => prev.filter((b) => b.type !== 'text'));
    setSelectedBlockId((prev) => (prev && textIds.has(prev) ? null : prev));
    setEditingBlockId((prev) => (prev && textIds.has(prev) ? null : prev));
  }


  async function handleSave() {
    if (!userId || !date || !mode) return;
    if (mode === 'text' && !photoUri) return;
    if (mode === 'routines' && !blocks.some((b) => b.type === 'photo')) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      let coverPhotoUrl = photoUri;
      let coverPhotoSource = photoSource;
      let finalBlocks = blocks;

      if (mode === 'routines') {
        // 캔버스 안 사진 블록 중 로컬(아직 업로드 전)인 것들을 전부 업로드하고 URL로 치환
        finalBlocks = await Promise.all(
          blocks.map(async (b) => {
            if (b.type === 'photo' && isLocalUri(b.uri)) {
              return { ...b, uri: await uploadPhotoDiaryPhoto(userId, b.uri) };
            }
            return b;
          })
        );
        const firstPhoto = finalBlocks.find((b): b is Extract<CanvasBlock, { type: 'photo' }> => b.type === 'photo');
        coverPhotoUrl = firstPhoto?.uri ?? photoUri;
        coverPhotoSource = firstPhoto?.source ?? photoSource;
      } else if (photoUri && isLocalUri(photoUri)) {
        coverPhotoUrl = await uploadPhotoDiaryPhoto(userId, photoUri);
      }

      if (!coverPhotoUrl) return;

      const saved = await savePhotoDiary(
        userId,
        date,
        {
          photoUrl: coverPhotoUrl,
          photoSource: coverPhotoSource,
          mode,
          content: mode === 'text' ? content : null,
          blocks: mode === 'routines' ? finalBlocks : null,
          routineColorEnabled,
          textColorMode,
        },
        entryId
      );
      setEntryId(saved.id);
      setPhotoUri(saved.photo_url);
      if (mode === 'routines') setBlocks(finalBlocks);
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
      setContent(entry.content ?? '');
      setRoutineColorEnabled(entry.routine_color_enabled);
      setTextColorMode(entry.text_color_mode);
      if (entry.mode === 'routines') {
        const savedBlocks = buildBlocksFromEntry(entry, routineById);
        setBlocks(savedBlocks);
        const placedRoutineIds = new Set(
          savedBlocks.filter((b): b is Extract<CanvasBlock, { type: 'routine' }> => b.type === 'routine').map((b) => b.routineId)
        );
        setHiddenRoutineIds(candidateRoutines.filter((r) => !placedRoutineIds.has(r.id)).map((r) => r.id));
      } else {
        setBlocks([]);
        setHiddenRoutineIds([]);
      }
    } else {
      setPhotoUri(null);
      setPhotoSource(null);
      setMode(null);
      setContent('');
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
      Alert.alert(t('photoDiary.savedToGalleryTitle'));
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

  const DOUBLE_TAP_MS = 260;

  // 메모(텍스트) 블록 탭 처리 — 한 번 탭하면(짧은 지연 뒤 두 번째 탭이 안 오면) 입력창(키보드)
  // 모드로, 그 지연 안에 다시 탭하면(더블탭) 키보드 없이 선택만(이동/핀치/삭제 가능) 모드로 전환한다
  function handleTextBlockPress(id: string) {
    const pending = tapTimersRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      tapTimersRef.current.delete(id);
      setEditingBlockId(null);
      setSelectedBlockId(id);
      return;
    }
    const timer = setTimeout(() => {
      tapTimersRef.current.delete(id);
      setSelectedBlockId(id);
      setEditingBlockId(id);
    }, DOUBLE_TAP_MS);
    tapTimersRef.current.set(id, timer);
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const showCameraFilter = photoSource === 'camera';

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
          {/* 배경 빈 곳을 탭하면 키보드/선택을 해제하는 용도 — 예전엔 이 컴포넌트가 ScrollView를
              바깥에서 감싸고 있었는데, 그러면 구형 터치 responder 시스템(TouchableWithoutFeedback)이
              react-native-gesture-handler 기반 ScrollView보다 상위에서 터치 우선권 협상에 끼어들어
              "사진 바꾸기" 버튼 아래(제스처 블록이 없는 일반 버튼 구간)의 스크롤이 계속 뻑뻑했다.
              ScrollView의 자식(내부)으로 옮기면 스크롤 인식은 항상 ScrollView가 먼저 가져가고,
              스크롤이 아닌 순수 탭일 때만 이 컴포넌트가 배경 탭으로 인식해 정상 동작한다 */}
          <TouchableWithoutFeedback onPress={dismissKeyboardAndSelection} accessible={false}>
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
                <RNView style={styles.templateFrame}>
                  <ViewShot ref={shotRef} style={styles.template} options={{ format: 'jpg', quality: 0.9 }}>
                    <RNView
                      style={[
                        styles.templateInner,
                        mode === 'routines' && { width: CANVAS_WIDTH, height: canvasHeight, overflow: 'hidden' },
                      ]}>
                      {mode === 'text' ? (
                        <>
                          <RNView style={styles.photoWrap}>
                            <Image source={{ uri: photoUri }} style={styles.photo} />
                            {showCameraFilter && (
                              <>
                                <BlurView intensity={12} tint="light" style={StyleSheet.absoluteFill} pointerEvents="none" />
                                <RNView pointerEvents="none" style={[StyleSheet.absoluteFill, styles.filterWarmLayer]} />
                                <RNView
                                  pointerEvents="none"
                                  style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(accent, 0.16) }]}
                                />
                                <VignetteOverlay width={CANVAS_WIDTH} height={CANVAS_PHOTO_HEIGHT} />
                              </>
                            )}
                          </RNView>
                          <View style={styles.contentBox}>
                            <TextInput
                              style={styles.textArea}
                              value={content}
                              onChangeText={setContent}
                              placeholder={t('photoDiary.textPlaceholder')}
                              multiline
                              textAlignVertical="top"
                            />
                          </View>
                        </>
                      ) : (
                        <>
                          {!blocks.some((b) => b.type !== 'photo') && (
                            <Text style={styles.emptyCanvasText}>{t('photoDiary.emptyRoutines')}</Text>
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
                                pinchEnabled={isSelected}
                                onLayoutSize={(size) => blockSizeRef.current.set(block.id, size)}
                                onMove={(x, y) => {
                                  const size = blockSizeRef.current.get(block.id);
                                  const fallbackWidth = block.type === 'routine' ? ROUTINE_COL_WIDTH : PHOTO_BLOCK_WIDTH;
                                  const fallbackHeight = block.type === 'routine' ? ROUTINE_ROW_HEIGHT : PHOTO_BLOCK_HEIGHT;
                                  const w = (size?.width ?? fallbackWidth) * (block.scale ?? 1);
                                  const h = (size?.height ?? fallbackHeight) * (block.scale ?? 1);
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
                                onScale={(s) => updateBlockScale(block.id, s)}>
                                {block.type === 'photo' ? (
                                  <AnimatedPressable
                                    onPress={() => setSelectedBlockId((prev) => (prev === block.id ? null : block.id))}
                                    style={[styles.photoBlockBase, isSelected && styles.photoBlockSelected]}>
                                    <Image source={{ uri: block.uri }} style={styles.photoBlockImage} />
                                    {block.source === 'camera' && (
                                      <>
                                        <BlurView
                                          intensity={12}
                                          tint="light"
                                          style={StyleSheet.absoluteFill}
                                          pointerEvents="none"
                                        />
                                        <RNView pointerEvents="none" style={[StyleSheet.absoluteFill, styles.filterWarmLayer]} />
                                        <RNView
                                          pointerEvents="none"
                                          style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(accent, 0.16) }]}
                                        />
                                        <VignetteOverlay width={PHOTO_BLOCK_WIDTH} height={PHOTO_BLOCK_HEIGHT} />
                                      </>
                                    )}
                                  </AnimatedPressable>
                                ) : block.type === 'routine' ? (
                                  <RoutineBlockContent
                                    routine={routineById.get(block.routineId)}
                                    isCompleted={completedIds.has(block.routineId)}
                                    isSelected={isSelected}
                                    routineColorEnabled={routineColorEnabled}
                                    textColor={blockTextColor}
                                    accent={accent}
                                    styles={styles}
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
                                      // 한 번 탭 = (짧은 지연 뒤) 키보드가 뜨는 입력 모드, 그 지연
                                      // 안에 다시 탭 = 더블탭으로 인식해 키보드 없이 선택만(이동/
                                      // 핀치/삭제 가능) 모드로 전환. 손가락이 스치기만 해도 곧장
                                      // 포커스를 가져가 키보드가 깜빡이던 예전 버그를 막기 위해
                                      // 선택 전엔 포커스 없는 일반 텍스트로만 보여준다
                                      <AnimatedPressable onPress={() => handleTextBlockPress(block.id)}>
                                        <Text style={[styles.textChip, { color: blockTextColor }]}>
                                          {block.text || t('photoDiary.notePlaceholder')}
                                        </Text>
                                      </AnimatedPressable>
                                    )}
                                    {isSelected && (
                                      <AnimatedPressable
                                        style={styles.chipDeleteBadgeLight}
                                        onPress={() => removeTextBlock(block.id)}>
                                        <Ionicons name="close" size={11} color={textMuted} />
                                      </AnimatedPressable>
                                    )}
                                  </RNView>
                                )}
                              </DraggableBlock>
                            );
                          })}
                        </>
                      )}
                    </RNView>
                  </ViewShot>
                </RNView>

                <AnimatedPressable style={styles.changePhotoButton} onPress={openChangeCoverPhoto} disabled={isBusy}>
                  <Text style={styles.changePhotoText}>{t('photoDiary.changePhoto')}</Text>
                </AnimatedPressable>

                {mode === 'routines' && (
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
                      <Text style={styles.colorToggleLabel}>{t('photoDiary.routineColorToggle')}</Text>
                      <Switch
                        value={routineColorEnabled}
                        onValueChange={setRoutineColorEnabled}
                        trackColor={{ false: '#ccc', true: withAlpha(accent, 0.4) }}
                        thumbColor={routineColorEnabled ? accent : '#f4f3f4'}
                      />
                      <Text style={[styles.colorToggleLabel, styles.textColorLabel]}>
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
                      </View>
                    )}

                    {hiddenRoutineIds.length > 0 && (
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
                )}

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
                <AnimatedPressable
                  style={styles.discardDraftLink}
                  disabled={isSaving}
                  onPress={() =>
                    Alert.alert(t('photoDiary.discardDraftConfirmTitle'), t('photoDiary.discardDraftConfirmDesc'), [
                      { text: t('settings.cancel'), style: 'cancel' },
                      { text: t('photoDiary.discardDraftButton'), style: 'destructive', onPress: discardDraft },
                    ])
                  }>
                  <Text style={styles.discardDraftLinkText}>{t('photoDiary.discardDraftButton')}</Text>
                </AnimatedPressable>
              </>
            )}

            {entryId && (
              <AnimatedPressable
                style={styles.deleteLinkBottom}
                onPress={() => setShowDeleteConfirm(true)}
                disabled={isSaving}>
                <Text style={styles.deleteLinkBottomText}>{t('photoDiary.deleteButton')}</Text>
              </AnimatedPressable>
            )}
            </RNView>
          </TouchableWithoutFeedback>
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
              <Text style={styles.optionRowText}>{t('photoDiary.modeRoutines')}</Text>
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

      <Modal visible={showHelpModal} transparent animationType="fade" onRequestClose={() => setShowHelpModal(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowHelpModal(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.helpTitle')}</Text>
            <View style={styles.helpBulletList}>
              {[
                t('photoDiary.helpBullet1'),
                t('photoDiary.helpBullet2'),
                t('photoDiary.helpBullet3'),
                t('photoDiary.helpBullet4'),
              ].map((line) => (
                <Text key={line} style={styles.helpBulletText}>
                  {'•  '}
                  {line}
                </Text>
              ))}
            </View>
            <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowHelpModal(false)}>
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
        <AnimatedPressable style={styles.chipHideBadge} onPress={onHide}>
          <Ionicons name="close" size={12} color="#fff" />
        </AnimatedPressable>
      )}
    </RNView>
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
      // 겹쳐 보이던 문제로 하단 여백을 더 넉넉하게 둠
      paddingBottom: 44,
    },
    deleteLinkBottom: {
      alignSelf: 'center',
      marginTop: 18,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    deleteLinkBottomText: {
      color: '#FF6B6B',
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
    // 사진일기 전체 범위를 은은한 주색 테두리로 안내 — ViewShot 바깥이라 저장/공유 이미지에는
    // 찍히지 않고, 편집 화면에서만 "여기까지가 사진일기예요"를 알려주는 용도
    templateFrame: {
      alignSelf: 'center',
      borderWidth: 1.5,
      borderColor: withAlpha(accent, 0.45),
      borderRadius: cardRadius,
      overflow: 'hidden',
    },
    template: {
      borderRadius: cardRadius,
      overflow: 'hidden',
    },
    templateInner: {
      backgroundColor: '#ffffff',
      position: 'relative',
    },
    photoWrap: {
      position: 'relative',
    },
    photo: {
      width: '100%',
      aspectRatio: 4 / 3,
    },
    // 캔버스 위 "사진" 블록의 기본(scale 1) 크기 — 대표 사진이든 나중에 추가한 사진이든
    // 전부 이 크기를 기준으로 두고 두 손가락 핀치로 커지거나 작아진다
    photoBlockBase: {
      width: PHOTO_BLOCK_WIDTH,
      height: PHOTO_BLOCK_HEIGHT,
      overflow: 'hidden',
    },
    photoBlockImage: {
      width: '100%',
      height: '100%',
    },
    photoBlockSelected: {
      borderWidth: 2,
      borderColor: accent,
    },
    contentBox: {
      padding: 14,
      minHeight: 140,
    },
    filterWarmLayer: {
      backgroundColor: 'rgba(255, 200, 140, 0.12)',
    },
    emptyCanvasText: {
      position: 'absolute',
      top: CANVAS_PHOTO_HEIGHT + 16,
      left: 16,
      fontSize: 13,
      opacity: 0.5,
    },
    textArea: {
      minHeight: 120,
      fontSize: 15 + fontKorean.sizeAdjust,
      lineHeight: 22 + fontKorean.sizeAdjust,
      fontFamily: fontKorean.fontFamily,
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
      backgroundColor: '#FF6B6B',
      alignItems: 'center',
      justifyContent: 'center',
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
    chipDeleteBadgeLight: {
      position: 'absolute',
      top: -8,
      right: -8,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    changePhotoButton: {
      alignSelf: 'center',
      marginTop: 10,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    changePhotoText: {
      fontSize: 13,
      opacity: 0.5,
      textDecorationLine: 'underline',
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
      alignSelf: 'center',
      marginTop: 10,
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
    helpBulletList: {
      gap: 10,
      marginBottom: 18,
    },
    helpBulletText: {
      fontSize: 13,
      lineHeight: 19,
      opacity: 0.75,
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
  });
}
