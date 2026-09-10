import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View as RNView,
} from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/language';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import {
  categoryDisplayName,
  countRoutinesUsingVideo,
  createCategory,
  createUserVideo,
  deleteUserVideo,
  fetchCategories,
  fetchDeletedCategories,
  fetchHiddenDefaultCategories,
  fetchVideosByCategory,
  hardDeleteCategory,
  hideDefaultCategory,
  recreateDefaultCategories,
  renameCategory,
  restoreCategory,
  softDeleteCategory,
  updateVideoSortOrder,
  type Category,
  type DeletedCategory,
  type HiddenDefaultCategory,
  type Video,
} from '@/lib/videos';

function daysUntilCategoryPurge(deletedAt: string): number {
  const purgeDate = new Date(deletedAt);
  purgeDate.setDate(purgeDate.getDate() + 3);
  const diffMs = purgeDate.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function CategoryVideoGrid({ onSelectVideo }: { onSelectVideo: (video: Video) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);
  const categoriesQueryKey = ['video-categories', userId] as const;
  const gridScrollRef = useAnimatedRef<Animated.ScrollView>();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'rename'>('create');
  const [categoryNameInput, setCategoryNameInput] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [categoryModalError, setCategoryModalError] = useState<string | null>(null);

  // 영상 삭제 확인창 — 네이티브 Alert 대신 이 화면 디자인에 맞춘 커스텀 확인창을 쓴다
  const [deleteTarget, setDeleteTarget] = useState<{ video: Video; linkedCount: number } | null>(null);
  // 카테고리 삭제 확인창도 같은 이유로 커스텀 Modal을 쓴다 — 네이티브 Alert는 이 화면 색/폰트를
  // 못 따라가고, 뒤로가기(안드로이드 하드웨어 백키/제스처)를 눌렀을 때 화면 자체가 나가버릴 수
  // 있는데 Modal의 onRequestClose로 감싸면 "안내창만 닫힘"이 보장된다
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<Category | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<DeletedCategory | null>(null);

  const [showTrashModal, setShowTrashModal] = useState(false);
  const [deletedCategories, setDeletedCategories] = useState<DeletedCategory[]>([]);
  const [hiddenDefaults, setHiddenDefaults] = useState<HiddenDefaultCategory[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusyId, setTrashBusyId] = useState<number | null>(null);
  const [recreatingDefaults, setRecreatingDefaults] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: categoriesQueryKey,
    queryFn: () => fetchCategories(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(categoriesQuery.refetch, !!userId);
  const categories = categoriesQuery.data ?? [];
  // 카테고리 값이 새로 바뀔 때마다(포커스마다 재조회 포함) 첫 번째로 리셋해버리면, 탭을
  // 옮겼다 돌아왔을 때 보고 있던 카테고리가 자꾸 1번으로 튕기게 됨 — 진짜 최초 1회만 정해준다
  const hasSetInitialCategoryRef = useRef(false);
  useEffect(() => {
    if (!categoriesQuery.data || hasSetInitialCategoryRef.current) return;
    hasSetInitialCategoryRef.current = true;
    setSelectedId(categoriesQuery.data[0]?.id ?? null);
  }, [categoriesQuery.data]);

  // 기존 호출부(setCategories(배열) 또는 setCategories(prev => ...))를 그대로 두기 위해
  // useState 셋터와 똑같은 형태로 만든 얇은 래퍼 — 실제로는 react-query 캐시를 갱신한다
  function setCategories(value: Category[] | ((prev: Category[]) => Category[])) {
    queryClient.setQueryData(categoriesQueryKey, (old?: Category[]) =>
      typeof value === 'function' ? (value as (prev: Category[]) => Category[])(old ?? []) : value
    );
  }

  const selectedCategory = categories.find((c) => c.id === selectedId) ?? null;

  const videosQueryKey = ['videos-by-category', selectedId, userId] as const;
  const videosQuery = useQuery({
    queryKey: videosQueryKey,
    queryFn: () => fetchVideosByCategory(selectedId!, userId!),
    enabled: selectedId !== null && !!userId,
  });
  useRefetchOnFocus(videosQuery.refetch, selectedId !== null && !!userId);
  const videos = videosQuery.data ?? [];
  const isLoading = videosQuery.isLoading;

  function setVideos(value: Video[] | ((prev: Video[]) => Video[])) {
    queryClient.setQueryData(videosQueryKey, (old?: Video[]) =>
      typeof value === 'function' ? (value as (prev: Video[]) => Video[])(old ?? []) : value
    );
  }

  function loadVideos(_categoryId: number) {
    videosQuery.refetch();
  }

  // 드래그로 순서를 바꾸면 화면부터 바로 새 순서로 바꾸고(낙관적 업데이트), 서버에도 반영한다
  function handleDragEnd(newOrder: Video[]) {
    setVideos(newOrder);
    updateVideoSortOrder(newOrder.map((v) => v.id)).catch(() => videosQuery.refetch());
  }

  async function performDeleteVideo(video: Video) {
    setDeleteTarget(null);
    try {
      await deleteUserVideo(video.id);
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
    } catch (err) {
      Alert.alert(t('categoryVideoGrid.deleteFailedTitle'), err instanceof Error ? err.message : t('categoryVideoGrid.deleteVideoFailedDefault'));
    }
  }

  async function handleDeleteVideo(video: Video) {
    const linkedCount = await countRoutinesUsingVideo(video.id).catch(() => 0);
    setDeleteTarget({ video, linkedCount });
  }

  async function handleAddVideo() {
    if (!userId || selectedId === null || !urlInput.trim()) return;
    setIsSubmitting(true);
    setAddError(null);
    try {
      const { alreadyAdded } = await createUserVideo(userId, selectedId, urlInput);
      if (alreadyAdded) {
        setAddError(t('categoryVideoGrid.alreadyAddedError'));
        return;
      }
      setUrlInput('');
      setShowAddModal(false);
      loadVideos(selectedId);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('categoryVideoGrid.addVideoFailedDefault'));
    } finally {
      setIsSubmitting(false);
    }
  }

  function openCreateCategoryModal() {
    setCategoryModalMode('create');
    setCategoryNameInput('');
    setCategoryModalError(null);
    setShowCategoryModal(true);
  }

  function openRenameCategoryModal() {
    if (!selectedCategory) return;
    setCategoryModalMode('rename');
    setCategoryNameInput(selectedCategory.name);
    setCategoryModalError(null);
    setShowCategoryModal(true);
  }

  async function handleSubmitCategory() {
    if (!userId) return;
    const name = categoryNameInput.trim();
    if (!name) return;
    setCategorySubmitting(true);
    setCategoryModalError(null);
    try {
      if (categoryModalMode === 'create') {
        const created = await createCategory(userId, name);
        setCategories((prev) => [...prev, created]);
        setSelectedId(created.id);
      } else if (selectedCategory) {
        const updated = await renameCategory(selectedCategory.id, name);
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
      setShowCategoryModal(false);
    } catch (err) {
      setCategoryModalError(err instanceof Error ? err.message : t('categoryVideoGrid.saveCategoryFailedDefault'));
    } finally {
      setCategorySubmitting(false);
    }
  }

  // 확인창을 커스텀 Modal로 띄우기만 하고, 실제 삭제는 그 Modal의 "삭제" 버튼(performDeleteCategory)에서 처리
  function handleDeleteCategory() {
    if (!selectedCategory) return;
    setCategoryDeleteTarget(selectedCategory);
  }

  async function performDeleteCategory(cat: Category) {
    setCategoryDeleteTarget(null);
    if (cat.user_id === null) {
      // 기본 카테고리는 공용 행이라 진짜로 못 지우고, 나에게서만 숨긴다 — 그 안의 내 영상은 즉시 완전히 삭제(복구 불가)
      if (!userId) return;
      try {
        await hideDefaultCategory(userId, cat.id);
        setCategories((prev) => {
          const next = prev.filter((c) => c.id !== cat.id);
          setSelectedId(next[0]?.id ?? null);
          return next;
        });
      } catch {
        Alert.alert(t('categoryVideoGrid.deleteFailedTitle'), t('categoryVideoGrid.deleteCategoryFailed'));
      }
      return;
    }

    try {
      await softDeleteCategory(cat.id);
      setCategories((prev) => {
        const next = prev.filter((c) => c.id !== cat.id);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
    } catch {
      Alert.alert(t('categoryVideoGrid.deleteFailedTitle'), t('categoryVideoGrid.deleteCategoryFailed'));
    }
  }

  async function openTrash() {
    if (!userId) return;
    setShowTrashModal(true);
    setTrashLoading(true);
    try {
      const [list, hidden] = await Promise.all([fetchDeletedCategories(userId), fetchHiddenDefaultCategories(userId)]);
      setDeletedCategories(list);
      setHiddenDefaults(hidden);
    } finally {
      setTrashLoading(false);
    }
  }

  async function handleRecreateDefaults() {
    if (!userId) return;
    setRecreatingDefaults(true);
    try {
      await recreateDefaultCategories(userId);
      setHiddenDefaults([]);
      const cats = await fetchCategories(userId);
      setCategories(cats);
      if (selectedId === null) setSelectedId(cats[0]?.id ?? null);
    } catch {
      Alert.alert(t('categoryVideoGrid.recreateFailedTitle'), t('categoryVideoGrid.recreateFailedDesc'));
    } finally {
      setRecreatingDefaults(false);
    }
  }

  async function handleRestoreCategory(cat: DeletedCategory) {
    setTrashBusyId(cat.id);
    try {
      await restoreCategory(cat.id);
      setDeletedCategories((prev) => prev.filter((c) => c.id !== cat.id));
      setCategories((prev) => [...prev, { id: cat.id, name: cat.name, user_id: cat.user_id }]);
    } catch {
      Alert.alert(t('categoryVideoGrid.restoreFailedTitle'), t('categoryVideoGrid.restoreFailedDesc'));
    } finally {
      setTrashBusyId(null);
    }
  }

  function handleHardDeleteCategory(cat: DeletedCategory) {
    setHardDeleteTarget(cat);
  }

  async function performHardDeleteCategory(cat: DeletedCategory) {
    setHardDeleteTarget(null);
    setTrashBusyId(cat.id);
    try {
      await hardDeleteCategory(cat.id);
      setDeletedCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch {
      Alert.alert(t('categoryVideoGrid.deleteFailedTitle'), t('categoryVideoGrid.hardDeleteFailedDesc'));
    } finally {
      setTrashBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}>
        {categories.map((cat) => (
          <AnimatedPressable
            key={cat.id}
            style={[styles.tab, selectedId === cat.id && styles.tabActive]}
            onPress={() => setSelectedId(cat.id)}>
            <Text style={[styles.tabText, selectedId === cat.id && styles.tabTextActive]}>
              {categoryDisplayName(cat.name, t)}
            </Text>
          </AnimatedPressable>
        ))}
        <AnimatedPressable style={styles.tabAdd} onPress={openCreateCategoryModal}>
          <Text style={styles.tabAddText}>{t('categoryVideoGrid.addCategory')}</Text>
        </AnimatedPressable>
      </ScrollView>

      <View style={styles.actionsRow}>
        {userId && selectedId !== null && (
          <AnimatedPressable style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Text style={styles.addButtonText}>{t('categoryVideoGrid.addMyVideo')}</Text>
          </AnimatedPressable>
        )}
        {selectedCategory?.user_id === userId && (
          <AnimatedPressable style={styles.categoryActionButton} onPress={openRenameCategoryModal}>
            <Ionicons name="create-outline" size={14} color={accent} />
            <Text style={styles.categoryActionText}>{t('categoryVideoGrid.renameCategory')}</Text>
          </AnimatedPressable>
        )}
        <AnimatedPressable style={styles.trashLinkButton} onPress={openTrash}>
          <Text style={styles.trashLinkText}>{t('categoryVideoGrid.deletedCategoriesLink')}</Text>
        </AnimatedPressable>
        {selectedCategory && (
          <AnimatedPressable style={styles.categoryActionButton} onPress={handleDeleteCategory}>
            <Ionicons name="trash-outline" size={14} color={accent} />
            <Text style={styles.categoryActionText}>{t('myRoutines.delete')}</Text>
          </AnimatedPressable>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : videos.length === 0 ? (
        <Text style={styles.emptyText}>
          {t('categoryVideoGrid.emptyVideosLine1')}
          {'\n'}
          {t('categoryVideoGrid.emptyVideosLine2')}
        </Text>
      ) : (
        <Animated.ScrollView ref={gridScrollRef} style={styles.list} contentContainerStyle={styles.grid}>
          <Sortable.Grid
            columns={videos.length === 1 ? 1 : 2}
            data={videos}
            keyExtractor={(item) => item.id}
            rowGap={16}
            columnGap={12}
            scrollableRef={gridScrollRef}
            onDragEnd={({ data }) => handleDragEnd(data)}
            renderItem={({ item }: { item: Video }) => (
              <AnimatedPressable style={styles.cardSlot} onPress={() => onSelectVideo(item)}>
                <ShadowCard style={styles.cardOuter} contentStyle={styles.card}>
                  <View style={styles.thumbnailWrap}>
                    <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
                    <AnimatedPressable style={styles.deleteBadge} onPress={() => handleDeleteVideo(item)}>
                      <Text style={styles.deleteBadgeText}>✕</Text>
                    </AnimatedPressable>
                  </View>
                  <View style={styles.cardTitleBox}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                  </View>
                  <Text style={styles.cardChannel} numberOfLines={1}>
                    {item.channel_name}
                  </Text>
                </ShadowCard>
              </AnimatedPressable>
            )}
          />
        </Animated.ScrollView>
      )}

      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
        <RNView style={styles.modalBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowAddModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t('categoryVideoGrid.addVideoModalTitle')}</Text>
            <Text style={styles.modalDesc}>{t('categoryVideoGrid.addVideoModalDesc')}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.modalInput, styles.modalInputWithClear]}
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="https://www.youtube.com/watch?v=..."
                autoCapitalize="none"
                autoCorrect={false}
              />
              {urlInput.length > 0 && (
                <AnimatedPressable style={styles.inputClearButton} onPress={() => setUrlInput('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={textMuted} />
                </AnimatedPressable>
              )}
            </View>
            {addError && <Text style={styles.modalError}>{addError}</Text>}
            <View style={styles.modalButtonRow}>
              <AnimatedPressable
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAddModal(false);
                  setUrlInput('');
                  setAddError(null);
                }}>
                <Text style={styles.modalCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.modalSaveButton} onPress={handleAddVideo} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>{t('common.add')}</Text>}
              </AnimatedPressable>
            </View>
          </View>
        </RNView>
      </Modal>

      <Modal
        visible={showCategoryModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCategoryModal(false)}>
        <RNView style={styles.modalBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowCategoryModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {categoryModalMode === 'create'
                ? t('categoryVideoGrid.categoryModalTitleCreate')
                : t('categoryVideoGrid.categoryModalTitleRename')}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={categoryNameInput}
              onChangeText={setCategoryNameInput}
              placeholder={t('categoryVideoGrid.categoryNamePlaceholder')}
            />
            {categoryModalError && <Text style={styles.modalError}>{categoryModalError}</Text>}
            <View style={styles.modalButtonRow}>
              <AnimatedPressable style={styles.modalCancelButton} onPress={() => setShowCategoryModal(false)}>
                <Text style={styles.modalCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.modalSaveButton} onPress={handleSubmitCategory} disabled={categorySubmitting}>
                {categorySubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>{t('today.save')}</Text>}
              </AnimatedPressable>
            </View>
          </View>
        </RNView>
      </Modal>

      <Modal visible={showTrashModal} animationType="slide" transparent onRequestClose={() => setShowTrashModal(false)}>
        <RNView style={styles.modalBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowTrashModal(false)} />
          <View style={styles.trashModalSheet}>
            <Text style={styles.modalTitle}>{t('categoryVideoGrid.deletedCategoriesLink')}</Text>
            {trashLoading ? (
              <ActivityIndicator style={styles.loading} />
            ) : (
              <ScrollView>
                <Text style={styles.modalDesc}>{t('categoryVideoGrid.trashModalDesc')}</Text>
                {deletedCategories.length === 0 ? (
                  <Text style={styles.emptyText}>{t('categoryVideoGrid.emptyDeletedCategories')}</Text>
                ) : (
                  deletedCategories.map((cat) => (
                    <View key={cat.id} style={styles.trashRow}>
                      <View style={styles.trashRowInfo}>
                        <Text style={styles.trashRowTitle}>{categoryDisplayName(cat.name, t)}</Text>
                        <Text style={styles.trashRowMeta}>
                          {language === 'ko'
                            ? `${daysUntilCategoryPurge(cat.deleted_at)}일 후 완전 삭제`
                            : `Permanently deleted in ${daysUntilCategoryPurge(cat.deleted_at)} day(s)`}
                        </Text>
                      </View>
                      <AnimatedPressable
                        style={styles.restoreButtonSmall}
                        disabled={trashBusyId === cat.id}
                        onPress={() => handleRestoreCategory(cat)}>
                        <Text style={styles.restoreButtonSmallText}>{t('categoryVideoGrid.restore')}</Text>
                      </AnimatedPressable>
                      <AnimatedPressable
                        style={styles.trashHardDeleteButton}
                        disabled={trashBusyId === cat.id}
                        onPress={() => handleHardDeleteCategory(cat)}>
                        <Text style={styles.trashHardDeleteText}>{t('categoryVideoGrid.hardDelete')}</Text>
                      </AnimatedPressable>
                    </View>
                  ))
                )}

                <Text style={[styles.modalTitle, styles.trashSectionTitle]}>
                  {t('categoryVideoGrid.hiddenDefaultsSectionTitle')}
                </Text>
                <Text style={styles.modalDesc}>{t('categoryVideoGrid.hiddenDefaultsDesc')}</Text>
                {hiddenDefaults.length === 0 ? (
                  <Text style={styles.emptyText}>{t('categoryVideoGrid.emptyHiddenDefaults')}</Text>
                ) : (
                  <>
                    {hiddenDefaults.map((cat) => (
                      <Text key={cat.category_id} style={styles.hiddenDefaultText}>
                        · {categoryDisplayName(cat.name, t)}
                      </Text>
                    ))}
                    <AnimatedPressable
                      style={styles.recreateButton}
                      disabled={recreatingDefaults}
                      onPress={handleRecreateDefaults}>
                      {recreatingDefaults ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.recreateButtonText}>{t('categoryVideoGrid.recreateDefaults')}</Text>
                      )}
                    </AnimatedPressable>
                  </>
                )}
              </ScrollView>
            )}
            <AnimatedPressable style={styles.modalCancelButton} onPress={() => setShowTrashModal(false)}>
              <Text style={styles.modalCancelText}>{t('today.close')}</Text>
            </AnimatedPressable>
          </View>
        </RNView>
      </Modal>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setDeleteTarget(null)} />
          {deleteTarget && (
            <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
              <Text style={styles.confirmTitle}>
                {deleteTarget.linkedCount > 0
                  ? t('categoryVideoGrid.confirmDeleteVideoTitleLinked')
                  : t('categoryVideoGrid.confirmDeleteVideoTitleSimple')}
              </Text>
              <Text style={styles.confirmDesc}>
                {deleteTarget.linkedCount > 0
                  ? language === 'ko'
                    ? `영상을 삭제하면 연결된 루틴 ${deleteTarget.linkedCount}개에서 이 영상을 볼 수 없게 돼요. 루틴 자체와 기록은 그대로 남아요.`
                    : `Deleting this video will remove it from ${deleteTarget.linkedCount} linked routine(s). The routines and their records stay intact.`
                  : deleteTarget.video.title}
              </Text>
              <View style={styles.confirmButtonRow}>
                <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setDeleteTarget(null)}>
                  <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={styles.confirmDeleteButton}
                  onPress={() => performDeleteVideo(deleteTarget.video)}>
                  <Text style={styles.confirmDeleteText}>{t('myRoutines.delete')}</Text>
                </AnimatedPressable>
              </View>
            </ShadowCard>
          )}
        </RNView>
      </Modal>

      {/* 카테고리 삭제 확인 — 위 영상 삭제 확인창과 완전히 같은 스타일(제목+설명+버튼, 테마색만
          사용)로 통일. 경고 아이콘/배지 없이 문구로만 안내한다 */}
      <Modal
        visible={!!categoryDeleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryDeleteTarget(null)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setCategoryDeleteTarget(null)} />
          {categoryDeleteTarget && (
            <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
              <Text style={styles.confirmTitle}>
                {categoryDeleteTarget.user_id === null
                  ? t('categoryVideoGrid.deleteDefaultCategoryWarningTitle')
                  : t('categoryVideoGrid.deleteCategoryConfirmTitle')}
              </Text>
              <Text style={styles.confirmDesc}>
                {categoryDeleteTarget.user_id === null
                  ? language === 'ko'
                    ? `"${categoryDisplayName(categoryDeleteTarget.name, t)}" 카테고리를 삭제하면 내가 추가한 영상이 지금 바로 사라지고 되돌릴 수 없어요. 카테고리 자체와 저희가 기본 제공하는 영상은 "삭제된 카테고리"의 "기본 카테고리 생성"으로 나중에 다시 채울 수 있어요.`
                    : `Deleting "${categoryDisplayName(categoryDeleteTarget.name, t)}" will remove any videos you added right away, and this can't be undone. You can recreate the category itself and our default videos later from "Deleted categories" → "Recreate default categories".`
                  : language === 'ko'
                    ? `"${categoryDeleteTarget.name}" 카테고리와 그 안의 영상은 3일간 보관돼요. 3일 안에는 "삭제된 카테고리"에서 복구할 수 있어요.`
                    : `"${categoryDisplayName(categoryDeleteTarget.name, t)}" and the videos inside will be kept for 3 days. You can restore it from "Deleted categories" within that time.`}
              </Text>
              <View style={styles.confirmButtonRow}>
                <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setCategoryDeleteTarget(null)}>
                  <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.confirmDeleteButton} onPress={() => performDeleteCategory(categoryDeleteTarget)}>
                  <Text style={styles.confirmDeleteText}>{t('myRoutines.delete')}</Text>
                </AnimatedPressable>
              </View>
            </ShadowCard>
          )}
        </RNView>
      </Modal>

      {/* "삭제된 카테고리" 목록에서 3일을 기다리지 않고 바로 완전삭제할 때의 확인 — 위와 동일한
          스타일. 이 Modal이 showTrashModal 위에 별도로 뜨므로, 뒤로가기를 누르면 이 확인창만
          먼저 닫히고 "삭제된 카테고리" 목록은 그대로 남는다 */}
      <Modal
        visible={!!hardDeleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setHardDeleteTarget(null)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setHardDeleteTarget(null)} />
          {hardDeleteTarget && (
            <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{t('categoryVideoGrid.hardDeleteConfirmTitle')}</Text>
              <Text style={styles.confirmDesc}>{t('categoryVideoGrid.hardDeleteConfirmDesc')}</Text>
              <View style={styles.confirmButtonRow}>
                <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setHardDeleteTarget(null)}>
                  <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.confirmDeleteButton} onPress={() => performHardDeleteCategory(hardDeleteTarget)}>
                  <Text style={styles.confirmDeleteText}>{t('categoryVideoGrid.hardDelete')}</Text>
                </AnimatedPressable>
              </View>
            </ShadowCard>
          )}
        </RNView>
      </Modal>
    </View>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    flexGrow: 0,
    marginBottom: 12,
  },
  tabsContent: {
    gap: 8,
    paddingHorizontal: 4,
  },
  tab: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: accent,
    borderColor: accent,
  },
  tabText: {
    fontSize: 13,
  },
  tabTextActive: {
    color: '#fff',
  },
  tabAdd: {
    borderWidth: 1,
    borderColor: accent,
    borderStyle: 'dashed',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabAddText: {
    fontSize: 13,
    color: accent,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  categoryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  categoryActionText: {
    color: accent,
    fontSize: 13,
    fontWeight: '600',
  },
  trashLinkButton: {
    marginLeft: 'auto',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  trashLinkText: {
    fontSize: 12,
    opacity: 0.5,
    textDecorationLine: 'underline',
  },
  trashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    padding: 10,
    marginTop: 10,
  },
  trashRowInfo: {
    flex: 1,
  },
  trashRowTitle: {
    fontSize: 14,
  },
  trashRowMeta: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  trashHardDeleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  trashHardDeleteText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
  },
  restoreButtonSmall: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  restoreButtonSmallText: {
    color: accent,
    fontSize: 12,
    fontWeight: '600',
  },
  loading: {
    marginTop: 40,
  },
  emptyText: {
    marginTop: 40,
    textAlign: 'center',
    opacity: 0.5,
  },
  list: {
    flex: 1,
  },
  grid: {
    paddingBottom: 20,
  },
  // Sortable.Grid가 columns 수에 맞춰 셀 폭을 알아서 계산해준다(딱 1개면 columns=1로 줘서
  // 꽉 채운 크기로 보이게 함) — 카드 쪽은 그 셀 폭을 그대로 채우기만 하면 된다
  cardSlot: {
    width: '100%',
  },
  cardOuter: {
    width: '100%',
  },
  card: {
    padding: 8,
  },
  thumbnailWrap: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: cardRadius,
    backgroundColor: border,
  },
  deleteBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // Text 자체에 height를 주면 그리드 라이브러리가 셀 크기를 측정할 때 무시하는 경우가 있어서,
  // 감싸는 View에 고정 높이를 줘서 1줄이든 2줄이든 카드 높이가 항상 같게 만든다
  cardTitleBox: {
    height: 34,
    marginTop: 6,
  },
  cardTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  cardChannel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  addButton: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: accent,
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  trashModalSheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  trashSectionTitle: {
    marginTop: 20,
  },
  hiddenDefaultText: {
    fontSize: 13,
    opacity: 0.75,
    marginTop: 6,
  },
  recreateButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  recreateButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 16,
    lineHeight: 18,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputWrap: {
    justifyContent: 'center',
  },
  // X 버튼에 글자가 가리지 않도록 오른쪽 여백만 더 준다(URL 입력에만 적용, 카테고리 이름 입력은 그대로)
  modalInputWithClear: {
    paddingRight: 36,
  },
  inputClearButton: {
    position: 'absolute',
    right: 10,
    padding: 4,
  },
  modalError: {
    color: '#FF6B6B',
    marginTop: 10,
    fontSize: 13,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
  modalCancelText: {
    fontSize: 14,
  },
  modalSaveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 14,
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
    alignItems: 'center',
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 18,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.6,
  },
  confirmDeleteButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  confirmDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  });
}
