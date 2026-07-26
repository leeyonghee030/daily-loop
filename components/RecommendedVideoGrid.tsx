import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  addRecommendedVideoToMyGrid,
  fetchCategories,
  fetchRecommendedVideosByCategory,
  type Category,
  type Video,
} from '@/lib/videos';

export function RecommendedVideoGrid({ onSelectVideo }: { onSelectVideo: (video: Video) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories().then((cats) => {
      setCategories(cats);
      setSelectedId(cats[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    setIsLoading(true);
    fetchRecommendedVideosByCategory(selectedId)
      .then(setVideos)
      .finally(() => setIsLoading(false));
  }, [selectedId]);

  async function handleAdd(video: Video) {
    if (!userId) return;
    setAddingId(video.id);
    try {
      await addRecommendedVideoToMyGrid(userId, video);
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
            <Pressable style={styles.card} onPress={() => onSelectVideo(item)}>
              <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardChannel} numberOfLines={1}>
                {item.channel_name}
              </Text>
              <Pressable style={styles.addButton} onPress={() => handleAdd(item)} disabled={addingId === item.id}>
                {addingId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addButtonText}>+ 내 그리드에 추가</Text>
                )}
              </Pressable>
            </Pressable>
          )}
        />
      )}
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
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#eee',
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
    marginTop: 8,
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
