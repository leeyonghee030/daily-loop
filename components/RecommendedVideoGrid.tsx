import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View as RNView,
} from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { useToast } from '@/components/Toast';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/language';
import {
  addRecommendedVideoToMyGrid,
  categoryDisplayName,
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
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  // "내 그리드에 추가" 대상 카테고리를 고르는 중인 영상 — null이면 모달 닫힘
  const [pickerVideo, setPickerVideo] = useState<Video | null>(null);
  // Alert.alert(네이티브 모달)는 뜨고 닫힐 때 버벅이고 확인 버튼을 눌러야만 닫혀서, 결과 안내는
  // 화면을 막지 않는 토스트로 대신한다 — 떠 있는 동안에도 뒤로가기/다른 조작이 그대로 가능함
  const { show: showToast, toastNode } = useToast();

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

  // 카테고리 선택 모달이 "슬라이드로 사라지는" 애니메이션 도중엔 그 모달이 화면 전체를 덮고
  // 있어서, 모달을 막 닫자마자 토스트를 띄우면 닫히는 애니메이션에 잠깐 가려 안 보일 수 있다
  // — 애니메이션이 끝날 정도의 짧은 지연을 두고 띄운다
  function showToastAfterModalCloses(text: string) {
    setTimeout(() => showToast(text), 350);
  }

  async function handleAdd(video: Video, categoryId: number) {
    if (!userId) return;
    setPickerVideo(null);
    setAddingId(video.id);
    try {
      const { video: added, alreadyAdded } = await addRecommendedVideoToMyGrid(userId, video, categoryId);
      if (alreadyAdded) {
        showToastAfterModalCloses(t('categoryVideoGrid.alreadyAddedError'));
        return;
      }
      // 캐시를 직접 손으로 조작(setQueryData로 배열에 끼워넣기)하는 대신, 그냥 "내 영상"
      // 그리드의 해당 카테고리 쿼리를 무효화한다 — 화면에 떠있으면 바로 새로고침되고, 안 떠있으면
      // 나중에 그 화면을 열 때 새로 받아온다(staleTime 0이라 마운트 시 항상 새로 받아옴).
      // 여러 영상을 연달아 추가해도 react-query가 항상 "가장 나중에 보낸 요청"의 응답만
      // 반영하도록 보장해주므로, 직접 배열을 이어붙이다가 카테고리가 꼬이는 문제를 피할 수 있다
      queryClient.invalidateQueries({ queryKey: ['videos-by-category', categoryId, userId] });
      showToastAfterModalCloses(
        language === 'ko' ? `"${video.title}"이(가) 내 그리드에 추가됐어요.` : `"${video.title}" was added to your grid.`
      );
    } catch (err) {
      Alert.alert(t('recommendedVideoGrid.addFailedTitle'), err instanceof Error ? err.message : t('recommendedVideoGrid.addFailedDefault'));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <View style={styles.container}>
      {toastNode}
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
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : videos.length === 0 ? (
        <Text style={styles.emptyText}>{t('recommendedVideoGrid.notReady')}</Text>
      ) : (
        <FlatList
          style={styles.list}
          data={videos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <AnimatedPressable
              style={[styles.cardSlot, videos.length === 1 && styles.cardSlotSingle]}
              onPress={() => onSelectVideo(item)}>
              <ShadowCard style={styles.cardOuter} contentStyle={styles.card}>
                <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.cardChannel} numberOfLines={1}>
                  {item.channel_name}
                </Text>
                <AnimatedPressable
                  style={styles.addButton}
                  onPress={() => setPickerVideo(item)}
                  disabled={addingId === item.id}>
                  {addingId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.addButtonText}>{t('recommendedVideoGrid.addToMyGrid')}</Text>
                  )}
                </AnimatedPressable>
              </ShadowCard>
            </AnimatedPressable>
          )}
        />
      )}

      <Modal visible={!!pickerVideo} animationType="slide" transparent onRequestClose={() => setPickerVideo(null)}>
        <RNView style={styles.modalBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setPickerVideo(null)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t('recommendedVideoGrid.pickCategoryTitle')}</Text>
            {myCategories.length === 0 ? (
              <Text style={styles.modalDesc}>{t('recommendedVideoGrid.pickCategoryEmpty')}</Text>
            ) : (
              <ScrollView>
                {myCategories.map((cat) => (
                  <AnimatedPressable
                    key={cat.id}
                    style={styles.categoryOption}
                    onPress={() => pickerVideo && handleAdd(pickerVideo, cat.id)}>
                    <Text style={styles.categoryOptionText}>{categoryDisplayName(cat.name, t)}</Text>
                  </AnimatedPressable>
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
  list: {
    flex: 1,
  },
  grid: {
    paddingBottom: 20,
  },
  // gap 대신 space-between + 카드 고정폭(48%)을 쓴다 — flex:1로 폭을 나누면 마지막 줄에
  // 카드가 하나만 남았을 때 그 카드가 혼자 줄 전체 폭으로 늘어나 다른 카드보다 커 보였음.
  // 폭은 ShadowCard(안쪽)가 아니라 이 슬롯(바깥 Pressable)에 줘야 한다 — 안쪽에 주면 퍼센트가
  // "폭 미지정인 바깥 요소" 기준으로 다시 계산되어 훨씬 작게(4분의 1 크기로) 나오는 문제가 있었음
  row: {
    justifyContent: 'space-between',
  },
  cardSlot: {
    width: '48%',
    marginBottom: 16,
  },
  // 딱 1개뿐일 때는 절반 폭 대신 꽉 채운 크기로 크게 보여준다
  cardSlotSingle: {
    width: '100%',
  },
  cardOuter: {
    width: '100%',
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
