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
  createUserVideo,
  deleteUserVideo,
  fetchCategories,
  fetchVideosByCategory,
  type Category,
  type Video,
} from '@/lib/videos';

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

  useEffect(() => {
    fetchCategories().then((cats) => {
      setCategories(cats);
      setSelectedId(cats[0]?.id ?? null);
    });
  }, []);

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
      </ScrollView>

      {userId && selectedId !== null && (
        <Pressable style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Text style={styles.addButtonText}>+ 내 영상 추가</Text>
        </Pressable>
      )}

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
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
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
