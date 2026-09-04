import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View as RNView,
} from 'react-native';

import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import {
  addRecommendedVideoToMyGrid,
  fetchCategories,
  fetchDefaultCategories,
  fetchRecommendedVideosByCategory,
  type Video,
} from '@/lib/videos';

export function RecommendedVideoGrid({ onSelectVideo }: { onSelectVideo: (video: Video) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const styles = useMemo(() => createStyles(accent), [accent]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  // "내 그리드에 추가" 대상 카테고리를 고르는 중인 영상 — null이면 모달 닫힘
  const [pickerVideo, setPickerVideo] = useState<Video | null>(null);

  // "내 영상" 탭(CategoryVideoGrid)과 같은 쿼리 키를 써서 캐시를 공유한다 —
  // 내가 숨긴 기본 카테고리는 여기서도 제외되므로, 이미 숨긴 카테고리에는 추가할 수 없다
  const myCategoriesQuery = useQuery({
    queryKey: ['video-categories', userId],
    queryFn: () => fetchCategories(userId!),
    enabled: !!userId,
  });
  const myCategories = myCategoriesQuery.data ?? [];

  // 관리자가 큐레이션한 기본 카테고리/추천 영상이라 자주 안 바뀜 — 5분 정도는 캐시된 값 재사용
  // (원래 1시간이었는데, 콘텐츠를 계속 채워나가는 중엔 방금 추가한 게 한참 안 보이는 혼란을 줘서 줄임)
  const categoriesQuery = useQuery({
    queryKey: ['default-video-categories'],
    queryFn: fetchDefaultCategories,
    staleTime: 5 * 60 * 1000,
  });
  const categories = categoriesQuery.data ?? [];
  const hasSetInitialCategoryRef = useRef(false);
  useEffect(() => {
    if (!categoriesQuery.data || hasSetInitialCategoryRef.current) return;
    hasSetInitialCategoryRef.current = true;
    setSelectedId(categoriesQuery.data[0]?.id ?? null);
  }, [categoriesQuery.data]);

  const videosQuery = useQuery({
    queryKey: ['recommended-videos', selectedId],
    queryFn: () => fetchRecommendedVideosByCategory(selectedId!),
    enabled: selectedId !== null,
    staleTime: 5 * 60 * 1000,
  });
  const videos = videosQuery.data ?? [];
  const isLoading = videosQuery.isLoading;

  async function handleAdd(video: Video, categoryId: number) {
    if (!userId) return;
    setPickerVideo(null);
    setAddingId(video.id);
    try {
      await addRecommendedVideoToMyGrid(userId, video, categoryId);
      queryClient.invalidateQueries({ queryKey: ['videos-by-category', categoryId, userId] });
      Alert.alert('추가했어요', `"${video.title}"이(가) 내 그리드에 추가됐어요.`);
    } catch (err) {
      Alert.alert('추가 실패', err instanceof Error ? err.message : '영상을 추가하지 못했어요.');
    } finally {
      setAddingId(null);
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

      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : videos.length === 0 ? (
        <Text style={styles.emptyText}>준비 중입니다</Text>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <ShadowCard style={styles.cardOuter} contentStyle={styles.card}>
              <Pressable onPress={() => onSelectVideo(item)}>
                <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.cardChannel} numberOfLines={1}>
                  {item.channel_name}
                </Text>
                <Pressable
                  style={styles.addButton}
                  onPress={() => setPickerVideo(item)}
                  disabled={addingId === item.id}>
                  {addingId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.addButtonText}>+ 내 그리드에 추가</Text>
                  )}
                </Pressable>
              </Pressable>
            </ShadowCard>
          )}
        />
      )}

      <Modal visible={!!pickerVideo} animationType="slide" transparent onRequestClose={() => setPickerVideo(null)}>
        <RNView style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPickerVideo(null)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>어느 카테고리에 추가할까요?</Text>
            {myCategories.length === 0 ? (
              <Text style={styles.modalDesc}>
                "내 영상" 탭에서 카테고리를 먼저 만들어주세요.
              </Text>
            ) : (
              <ScrollView>
                {myCategories.map((cat) => (
                  <Pressable
                    key={cat.id}
                    style={styles.categoryOption}
                    onPress={() => pickerVideo && handleAdd(pickerVideo, cat.id)}>
                    <Text style={styles.categoryOptionText}>{cat.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
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
  cardOuter: {
    flex: 1,
    marginBottom: 16,
  },
  card: {
    padding: 8,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: cardRadius,
    backgroundColor: border,
  },
  cardTitle: {
    fontSize: 13,
    lineHeight: 17,
    height: 34, // 2줄 고정 — 제목이 1줄이든 2줄이든 카드 높이가 항상 같게
    fontWeight: '600',
    marginTop: 6,
  },
  cardChannel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  addButton: {
    marginTop: 8,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 6,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 12,
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
    maxHeight: '70%',
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
  categoryOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: border,
  },
  categoryOptionText: {
    fontSize: 15,
  },
  });
}
