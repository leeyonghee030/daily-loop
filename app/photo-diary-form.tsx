import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableWithoutFeedback,
  View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
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
  type PhotoDiaryMode,
  type PhotoSource,
} from '@/lib/photo-diary';
import { fetchRoutinesForDate, type Routine } from '@/lib/routines';

// "루틴 고르기" 모드의 자유 캔버스 크기 — 화면 좌우 padding(20+20)을 뺀 너비를 기준으로,
// 사진 비율(4:3) 아래에 블록을 자유롭게 놓을 여유 공간(EXTRA)을 더한다
const CANVAS_WIDTH = Dimensions.get('window').width - 40;
const CANVAS_PHOTO_HEIGHT = Math.round(CANVAS_WIDTH * (3 / 4));
const CANVAS_EXTRA_HEIGHT = 260;
const CANVAS_HEIGHT = CANVAS_PHOTO_HEIGHT + CANVAS_EXTRA_HEIGHT;
const ROUTINE_ROW_HEIGHT = 44;

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

// 자유 캔버스 위 블록 하나를 드래그로 옮길 수 있게 감싸는 컴포넌트.
// 탭(누르고 안 움직임)은 그대로 자식(칩의 onPress, 메모의 TextInput 포커스)에게 넘기고,
// 일정 거리 이상 움직여야만 드래그로 인식해서 자식의 탭 동작과 충돌하지 않는다.
function DraggableBlock({
  x,
  y,
  onMove,
  children,
}: {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const posRef = useRef({ x, y });
  posRef.current = { x, y };
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const startRef = useRef({ x, y });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // capture 단계에서 먼저 가져가야, 이 화면을 감싼 바깥 ScrollView가 세로 방향
      // 움직임을 스크롤로 먼저 채가서 블록이 안 움직이는 문제가 안 생긴다
      onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onPanResponderGrant: () => {
        startRef.current = posRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        onMoveRef.current(startRef.current.x + gesture.dx, startRef.current.y + gesture.dy);
      },
    })
  ).current;

  return (
    <RNView style={{ position: 'absolute', left: x, top: y }} {...panResponder.panHandlers}>
      {children}
    </RNView>
  );
}

export default function PhotoDiaryFormScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
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
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showModeModal, setShowModeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const shotRef = useRef<ViewShot>(null);

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
    if (entry.mode === 'routines') {
      const savedBlocks = (entry.blocks ?? []).filter((b) => (b.type === 'routine' ? routineById.has(b.routineId) : true));
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

  async function pickFromCamera() {
    setShowSourceModal(false);
    setIsBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('photoDiary.permissionTitle'), t('photoDiary.cameraPermissionDesc'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]) onPhotoObtained(result.assets[0].uri, 'camera');
    } finally {
      setIsBusy(false);
    }
  }

  async function pickFromLibrary() {
    setShowSourceModal(false);
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

  function onPhotoObtained(uri: string, source: PhotoSource) {
    setPhotoUri(uri);
    setPhotoSource(source);
    // 새로 만드는 경우에만 모드를 묻는다 — 기존 항목을 수정할 땐(사진만 교체) 모드를 유지
    if (!entryId) setShowModeModal(true);
  }

  function chooseMode(nextMode: PhotoDiaryMode) {
    setMode(nextMode);
    setShowModeModal(false);
    if (nextMode === 'routines') {
      setBlocks(
        candidateRoutines.map((r, i) => ({
          id: nextBlockId(),
          type: 'routine' as const,
          routineId: r.id,
          x: 16,
          y: CANVAS_PHOTO_HEIGHT + 12 + i * ROUTINE_ROW_HEIGHT,
        }))
      );
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
    setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'routine', routineId, x: 16, y: CANVAS_PHOTO_HEIGHT + 12 }]);
  }

  function addTextNote() {
    setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'text', text: '', x: 24, y: CANVAS_PHOTO_HEIGHT + 40 }]);
  }

  function updateBlockPosition(id: string, x: number, y: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
  }

  function updateTextBlockText(id: string, text: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === 'text' ? { ...b, text } : b)));
  }

  function removeTextBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  async function handleSave() {
    if (!userId || !date || !mode || !photoUri) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const finalPhotoUrl = isLocalUri(photoUri) ? await uploadPhotoDiaryPhoto(userId, photoUri) : photoUri;
      const saved = await savePhotoDiary(
        userId,
        date,
        {
          photoUrl: finalPhotoUrl,
          photoSource,
          mode,
          content: mode === 'text' ? content : null,
          blocks: mode === 'routines' ? blocks : null,
          routineColorEnabled,
        },
        entryId
      );
      setEntryId(saved.id);
      setPhotoUri(saved.photo_url);
      router.back();
    } catch {
      setErrorMessage(t('photoDiary.errorSave'));
    } finally {
      setIsSaving(false);
    }
  }

  async function performDelete() {
    if (!entryId) return;
    setIsSaving(true);
    try {
      await deletePhotoDiary(entryId);
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
      <TouchableWithoutFeedback onPress={dismissKeyboardAndSelection} accessible={false}>
        <RNView style={styles.container}>
          {entryId && (
            <AnimatedPressable
              style={styles.deleteLinkTop}
              onPress={() => setShowDeleteConfirm(true)}
              disabled={isSaving}>
              <Text style={styles.deleteLinkTopText}>{t('photoDiary.deleteButton')}</Text>
            </AnimatedPressable>
          )}

          <ScrollView
            contentContainerStyle={styles.inner}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={dismissKeyboardAndSelection}>
            {!photoUri ? (
              <AnimatedPressable style={styles.pickPhotoBox} onPress={() => setShowSourceModal(true)} disabled={isBusy}>
                {isBusy ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={32} color={accent} />
                    <Text style={styles.pickPhotoText}>{t('photoDiary.createButton')}</Text>
                  </>
                )}
              </AnimatedPressable>
            ) : (
              <>
                <ViewShot ref={shotRef} style={styles.template} options={{ format: 'jpg', quality: 0.9 }}>
                  <RNView
                    style={[
                      styles.templateInner,
                      mode === 'routines' && { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
                    ]}>
                    <RNView style={mode === 'routines' ? styles.canvasPhotoWrap : styles.photoWrap}>
                      <Image source={{ uri: photoUri }} style={mode === 'routines' ? styles.canvasPhotoImg : styles.photo} />
                      {showCameraFilter && (
                        <>
                          <BlurView intensity={16} tint="light" style={StyleSheet.absoluteFill} pointerEvents="none" />
                          <RNView
                            pointerEvents="none"
                            style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(accent, 0.22) }]}
                          />
                        </>
                      )}
                    </RNView>

                    {mode === 'text' ? (
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
                    ) : (
                      <>
                        {blocks.length === 0 && (
                          <Text style={styles.emptyCanvasText}>{t('photoDiary.emptyRoutines')}</Text>
                        )}
                        {blocks.map((block) => (
                        <DraggableBlock
                          key={block.id}
                          x={block.x}
                          y={block.y}
                          onMove={(x, y) => updateBlockPosition(block.id, x, y)}>
                          {block.type === 'routine' ? (
                            <RoutineBlockContent
                              routine={routineById.get(block.routineId)}
                              isCompleted={completedIds.has(block.routineId)}
                              isSelected={selectedBlockId === block.id}
                              routineColorEnabled={routineColorEnabled}
                              accent={accent}
                              styles={styles}
                              onPress={() => setSelectedBlockId((prev) => (prev === block.id ? null : block.id))}
                              onHide={() => hideRoutineBlock(block.id, block.routineId)}
                            />
                          ) : (
                            <RNView style={styles.textChipWrap}>
                              <TextInput
                                style={styles.textChip}
                                value={block.text}
                                onChangeText={(v) => updateTextBlockText(block.id, v)}
                                placeholder={t('photoDiary.notePlaceholder')}
                                multiline
                              />
                              <AnimatedPressable style={styles.chipDeleteBadgeLight} onPress={() => removeTextBlock(block.id)}>
                                <Ionicons name="close" size={11} color={textMuted} />
                              </AnimatedPressable>
                            </RNView>
                          )}
                        </DraggableBlock>
                        ))}
                      </>
                    )}
                  </RNView>
                </ViewShot>

                <AnimatedPressable style={styles.changePhotoButton} onPress={() => setShowSourceModal(true)} disabled={isBusy}>
                  <Text style={styles.changePhotoText}>{t('photoDiary.changePhoto')}</Text>
                </AnimatedPressable>

                {mode === 'routines' && (
                  <>
                    <View style={styles.routineToolsRow}>
                      <AnimatedPressable style={styles.addNoteButton} onPress={addTextNote}>
                        <Ionicons name="add-circle-outline" size={16} color={accent} />
                        <Text style={styles.addNoteButtonText}>{t('photoDiary.addNote')}</Text>
                      </AnimatedPressable>
                      <View style={styles.colorToggleRow}>
                        <Text style={styles.colorToggleLabel}>{t('photoDiary.routineColorToggle')}</Text>
                        <Switch
                          value={routineColorEnabled}
                          onValueChange={setRoutineColorEnabled}
                          trackColor={{ false: '#ccc', true: withAlpha(accent, 0.4) }}
                          thumbColor={routineColorEnabled ? accent : '#f4f3f4'}
                        />
                      </View>
                    </View>

                    {hiddenRoutineIds.length > 0 && (
                      <View style={styles.hiddenSection}>
                        <Text style={styles.hiddenSectionTitle}>
                          {t('photoDiary.hiddenSectionTitle')} ({hiddenRoutineIds.length})
                        </Text>
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
              <AnimatedPressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('today.save')}</Text>
                )}
              </AnimatedPressable>
            )}
          </ScrollView>
        </RNView>
      </TouchableWithoutFeedback>

      <Modal visible={showSourceModal} transparent animationType="fade" onRequestClose={() => setShowSourceModal(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowSourceModal(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('photoDiary.chooseSourceTitle')}</Text>
            <AnimatedPressable style={styles.optionRow} onPress={pickFromCamera}>
              <Ionicons name="camera-outline" size={20} color={accent} />
              <Text style={styles.optionRowText}>{t('photoDiary.takePhoto')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.optionRow} onPress={pickFromLibrary}>
              <Ionicons name="images-outline" size={20} color={accent} />
              <Text style={styles.optionRowText}>{t('photoDiary.pickFromLibrary')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowSourceModal(false)}>
              <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
            </AnimatedPressable>
          </ShadowCard>
        </RNView>
      </Modal>

      <Modal visible={showModeModal} transparent animationType="fade" onRequestClose={() => setShowModeModal(false)}>
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
              <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowDeleteConfirm(false)}>
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
    </KeyboardAvoidingView>
  );
}

// 루틴 블록의 칩 + (선택됐을 때만 보이는) 숨기기 배지 — 컴포넌트로 빼서 위 렌더 부분을 단순화
function RoutineBlockContent({
  routine,
  isCompleted,
  isSelected,
  routineColorEnabled,
  accent,
  styles,
  onPress,
  onHide,
}: {
  routine: Routine | undefined;
  isCompleted: boolean;
  isSelected: boolean;
  routineColorEnabled: boolean;
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
        <Text style={styles.routineChipText} numberOfLines={1}>
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
    inner: {
      flexGrow: 1,
      padding: 20,
      paddingTop: 4,
    },
    deleteLinkTop: {
      alignSelf: 'flex-end',
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    deleteLinkTopText: {
      color: '#FF6B6B',
      fontSize: 13,
      fontWeight: '600',
    },
    pickPhotoBox: {
      minHeight: 220,
      borderWidth: 1,
      borderColor: border,
      borderStyle: 'dashed',
      borderRadius: cardRadius,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    pickPhotoText: {
      color: accent,
      fontWeight: '600',
      fontSize: 15,
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
    canvasPhotoWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_PHOTO_HEIGHT,
    },
    canvasPhotoImg: {
      width: CANVAS_WIDTH,
      height: CANVAS_PHOTO_HEIGHT,
    },
    contentBox: {
      padding: 14,
      minHeight: 140,
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
      maxWidth: CANVAS_WIDTH - 40,
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
      minWidth: 120,
      maxWidth: CANVAS_WIDTH - 40,
    },
    textChip: {
      minWidth: 120,
      minHeight: 60,
      padding: 10,
      backgroundColor: '#FFF6C8',
      borderRadius: 8,
      fontSize: 13 + fontKorean.sizeAdjust,
      lineHeight: 18 + fontKorean.sizeAdjust,
      fontFamily: fontKorean.fontFamily,
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
    routineToolsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
    },
    addNoteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    addNoteButtonText: {
      color: accent,
      fontSize: 13,
      fontWeight: '600',
    },
    colorToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    colorToggleLabel: {
      fontSize: 12,
      opacity: 0.6,
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
    confirmCancelButton: {
      flex: 1,
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
