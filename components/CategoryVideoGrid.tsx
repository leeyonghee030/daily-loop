import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View as RNView,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
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

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'rename'>('create');
  const [categoryNameInput, setCategoryNameInput] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [categoryModalError, setCategoryModalError] = useState<string | null>(null);

  const [showTrashModal, setShowTrashModal] = useState(false);
  const [deletedCategories, setDeletedCategories] = useState<DeletedCategory[]>([]);
  const [hiddenDefaults, setHiddenDefaults] = useState<HiddenDefaultCategory[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusyId, setTrashBusyId] = useState<number | null>(null);
  const [recreatingDefaults, setRecreatingDefaults] = useState(false);

  const selectedCategory = categories.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!userId) return;
    fetchCategories(userId).then((cats) => {
      setCategories(cats);
      setSelectedId(cats[0]?.id ?? null);
    });
  }, [userId]);

  function loadVideos(categoryId: number) {
    if (!userId) return;
    setIsLoading(true);
    fetchVideosByCategory(categoryId, userId)
      .then(setVideos)
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (selectedId === null) return;
    loadVideos(selectedId);
  }, [selectedId, userId]);

  async function performDeleteVideo(video: Video) {
    try {
      await deleteUserVideo(video.id);
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
    } catch (err) {
      Alert.alert('삭제 실패', err instanceof Error ? err.message : '영상을 삭제하지 못했어요.');
    }
  }

  async function handleDeleteVideo(video: Video) {
    const linkedCount = await countRoutinesUsingVideo(video.id).catch(() => 0);
    if (linkedCount > 0) {
      Alert.alert(
        '이 영상은 루틴에 연결돼 있어요',
        `연결된 루틴 ${linkedCount}개에서 영상 연결만 사라지고, 루틴 자체와 기록은 그대로 남아요. 그래도 삭제하시겠어요?`,
        [
          { text: '취소', style: 'cancel' },
          { text: '그래도 삭제', style: 'destructive', onPress: () => performDeleteVideo(video) },
        ]
      );
      return;
    }
    Alert.alert('이 영상을 삭제할까요?', video.title, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => performDeleteVideo(video) },
    ]);
  }

  async function handleAddVideo() {
    if (!userId || selectedId === null || !urlInput.trim()) return;
    setIsSubmitting(true);
    setAddError(null);
    try {
      await createUserVideo(userId, selectedId, urlInput);
      setUrlInput('');
      setShowAddModal(false);
      loadVideos(selectedId);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '영상을 추가하지 못했어요.');
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
      setCategoryModalError(err instanceof Error ? err.message : '저장하지 못했어요.');
    } finally {
      setCategorySubmitting(false);
    }
  }

  function handleDeleteCategory() {
    if (!selectedCategory) return;
    const cat = selectedCategory;

    if (cat.user_id === null) {
      // 기본 카테고리는 공용 행이라 진짜로 못 지우고, 나에게서만 숨긴다 — 그 안의 내 영상은 즉시 완전히 삭제(복구 불가)
      if (!userId) return;
      Alert.alert(
        '⚠️ 추가한 영상은 복구되지 않아요',
        `"${cat.name}" 카테고리를 삭제하면 내가 추가한 영상이 지금 바로 사라지고 되돌릴 수 없어요. 카테고리 자체와 저희가 기본 제공하는 영상은 "삭제된 카테고리"의 "기본 카테고리 생성"으로 나중에 다시 채울 수 있어요. 그래도 삭제할까요?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              try {
                await hideDefaultCategory(userId, cat.id);
                setCategories((prev) => {
                  const next = prev.filter((c) => c.id !== cat.id);
                  setSelectedId(next[0]?.id ?? null);
                  return next;
                });
              } catch {
                Alert.alert('삭제 실패', '카테고리를 삭제하지 못했어요.');
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      '이 카테고리를 삭제할까요?',
      `"${cat.name}" 카테고리와 그 안의 영상은 3일간 보관돼요. 3일 안에는 "삭제된 카테고리"에서 복구할 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteCategory(cat.id);
              setCategories((prev) => {
                const next = prev.filter((c) => c.id !== cat.id);
                setSelectedId(next[0]?.id ?? null);
                return next;
              });
            } catch {
              Alert.alert('삭제 실패', '카테고리를 삭제하지 못했어요.');
            }
          },
        },
      ]
    );
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
      Alert.alert('실패', '기본 카테고리를 다시 만들지 못했어요.');
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
      Alert.alert('복구 실패', '복구하지 못했어요.');
    } finally {
      setTrashBusyId(null);
    }
  }

  function handleHardDeleteCategory(cat: DeletedCategory) {
    Alert.alert('완전히 삭제할까요?', '3일을 기다리지 않고 지금 바로 완전히 삭제돼요. 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '완전 삭제',
        style: 'destructive',
        onPress: async () => {
          setTrashBusyId(cat.id);
          try {
            await hardDeleteCategory(cat.id);
            setDeletedCategories((prev) => prev.filter((c) => c.id !== cat.id));
          } catch {
            Alert.alert('삭제 실패', '삭제하지 못했어요.');
          } finally {
            setTrashBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}>
        {categories.map((cat) => (
          <Pressable
            key={cat.id}
            style={[styles.tab, selectedId === cat.id && styles.tabActive]}
            onPress={() => setSelectedId(cat.id)}>
            <Text style={[styles.tabText, selectedId === cat.id && styles.tabTextActive]}>{cat.name}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.tabAdd} onPress={openCreateCategoryModal}>
          <Text style={styles.tabAddText}>+ 카테고리</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.actionsRow}>
        {userId && selectedId !== null && (
          <Pressable style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Text style={styles.addButtonText}>+ 내 영상 추가</Text>
          </Pressable>
        )}
        {selectedCategory?.user_id === userId && (
          <Pressable style={styles.categoryActionButton} onPress={openRenameCategoryModal}>
            <Text style={styles.categoryActionText}>✎ 이름 수정</Text>
          </Pressable>
        )}
        {selectedCategory && (
          <Pressable style={styles.categoryActionButton} onPress={handleDeleteCategory}>
            <Text style={styles.categoryActionTextDanger}>🗑 삭제</Text>
          </Pressable>
        )}
        <Pressable style={styles.trashLinkButton} onPress={openTrash}>
          <Text style={styles.trashLinkText}>삭제된 카테고리</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : videos.length === 0 ? (
        <Text style={styles.emptyText}>아직 추가한 영상이 없어요{'\n'}추천 영상에서 가져오거나 직접 추가해보세요</Text>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => onSelectVideo(item)}>
              <View style={styles.thumbnailWrap}>
                <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
                <Pressable style={styles.deleteBadge} onPress={() => handleDeleteVideo(item)}>
                  <Text style={styles.deleteBadgeText}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardChannel} numberOfLines={1}>
                {item.channel_name}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
        <RNView style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>내 영상 추가</Text>
            <Text style={styles.modalDesc}>유튜브 링크를 붙여넣으면 제목/채널 정보를 자동으로 가져와요. 나에게만 보여요.</Text>
            <TextInput
              style={styles.modalInput}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="https://www.youtube.com/watch?v=..."
              autoCapitalize="none"
              autoCorrect={false}
            />
            {addError && <Text style={styles.modalError}>{addError}</Text>}
            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAddModal(false);
                  setUrlInput('');
                  setAddError(null);
                }}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={styles.modalSaveButton} onPress={handleAddVideo} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>추가</Text>}
              </Pressable>
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
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowCategoryModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{categoryModalMode === 'create' ? '카테고리 추가' : '카테고리 이름 수정'}</Text>
            <TextInput
              style={styles.modalInput}
              value={categoryNameInput}
              onChangeText={setCategoryNameInput}
              placeholder="카테고리 이름"
            />
            {categoryModalError && <Text style={styles.modalError}>{categoryModalError}</Text>}
            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalCancelButton} onPress={() => setShowCategoryModal(false)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={styles.modalSaveButton} onPress={handleSubmitCategory} disabled={categorySubmitting}>
                {categorySubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </RNView>
      </Modal>

      <Modal visible={showTrashModal} animationType="slide" transparent onRequestClose={() => setShowTrashModal(false)}>
        <RNView style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowTrashModal(false)} />
          <View style={styles.trashModalSheet}>
            <Text style={styles.modalTitle}>삭제된 카테고리</Text>
            {trashLoading ? (
              <ActivityIndicator style={styles.loading} />
            ) : (
              <ScrollView>
                <Text style={styles.modalDesc}>
                  내가 만든 카테고리는 삭제 후 3일 안에 여기서 복구할 수 있어요. 3일이 지나면 안의 영상까지 완전히
                  삭제돼요.
                </Text>
                {deletedCategories.length === 0 ? (
                  <Text style={styles.emptyText}>삭제된 카테고리가 없어요.</Text>
                ) : (
                  deletedCategories.map((cat) => (
                    <View key={cat.id} style={styles.trashRow}>
                      <View style={styles.trashRowInfo}>
                        <Text style={styles.trashRowTitle}>{cat.name}</Text>
                        <Text style={styles.trashRowMeta}>{daysUntilCategoryPurge(cat.deleted_at)}일 후 완전 삭제</Text>
                      </View>
                      <Pressable
                        style={styles.restoreButtonSmall}
                        disabled={trashBusyId === cat.id}
                        onPress={() => handleRestoreCategory(cat)}>
                        <Text style={styles.restoreButtonSmallText}>복구</Text>
                      </Pressable>
                      <Pressable
                        style={styles.trashHardDeleteButton}
                        disabled={trashBusyId === cat.id}
                        onPress={() => handleHardDeleteCategory(cat)}>
                        <Text style={styles.trashHardDeleteText}>완전삭제</Text>
                      </Pressable>
                    </View>
                  ))
                )}

                <Text style={[styles.modalTitle, styles.trashSectionTitle]}>삭제한 기본 카테고리</Text>
                <Text style={styles.modalDesc}>
                  기본 카테고리는 3일 제한 없이 언제든 다시 만들 수 있어요. 저희가 기본 제공하는 영상은 자동으로
                  다시 채워지지만, 내가 직접 추가했던 영상은 이미 지워진 상태라 돌아오지 않아요.
                </Text>
                {hiddenDefaults.length === 0 ? (
                  <Text style={styles.emptyText}>삭제한 기본 카테고리가 없어요.</Text>
                ) : (
                  <>
                    {hiddenDefaults.map((cat) => (
                      <Text key={cat.category_id} style={styles.hiddenDefaultText}>
                        · {cat.name}
                      </Text>
                    ))}
                    <Pressable
                      style={styles.recreateButton}
                      disabled={recreatingDefaults}
                      onPress={handleRecreateDefaults}>
                      {recreatingDefaults ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.recreateButtonText}>기본 카테고리 생성</Text>
                      )}
                    </Pressable>
                  </>
                )}
              </ScrollView>
            )}
            <Pressable style={styles.modalCancelButton} onPress={() => setShowTrashModal(false)}>
              <Text style={styles.modalCancelText}>닫기</Text>
            </Pressable>
          </View>
        </RNView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: '#7C5CFC',
    borderColor: '#7C5CFC',
  },
  tabText: {
    fontSize: 13,
  },
  tabTextActive: {
    color: '#fff',
  },
  tabAdd: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabAddText: {
    fontSize: 13,
    color: '#7C5CFC',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  categoryActionButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  categoryActionText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryActionTextDanger: {
    color: '#FF6B6B',
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
    borderColor: '#eee',
    borderRadius: 10,
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
    borderRadius: 8,
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
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  restoreButtonSmallText: {
    color: '#7C5CFC',
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
  grid: {
    paddingBottom: 20,
  },
  row: {
    gap: 12,
  },
  card: {
    flex: 1,
    marginBottom: 16,
  },
  thumbnailWrap: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#eee',
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
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  cardChannel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#7C5CFC',
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
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
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
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  modalCancelText: {
    fontSize: 14,
  },
  modalSaveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#7C5CFC',
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
