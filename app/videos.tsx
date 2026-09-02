import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { CategoryVideoGrid } from '@/components/CategoryVideoGrid';
import { RecommendedVideoGrid } from '@/components/RecommendedVideoGrid';
import { Text, View } from '@/components/Themed';
import { accent, cardRadius } from '@/constants/theme';

export default function VideosScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'recommended'>('mine');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>영상</Text>

      <View style={styles.tabRow}>
        <Pressable style={[styles.tabButton, tab === 'mine' && styles.tabButtonActive]} onPress={() => setTab('mine')}>
          <Text style={[styles.tabButtonText, tab === 'mine' && styles.tabButtonTextActive]}>내 영상</Text>
        </Pressable>
        <Pressable
          style={[styles.tabButton, tab === 'recommended' && styles.tabButtonActive]}
          onPress={() => setTab('recommended')}>
          <Text style={[styles.tabButtonText, tab === 'recommended' && styles.tabButtonTextActive]}>추천 영상</Text>
        </Pressable>
      </View>

      {tab === 'mine' ? (
        <CategoryVideoGrid
          onSelectVideo={(video) => router.push({ pathname: '/video-player', params: { id: video.id } })}
        />
      ) : (
        <RecommendedVideoGrid
          onSelectVideo={(video) => router.push({ pathname: '/video-player', params: { id: video.id } })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tabButton: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabButtonActive: {
    backgroundColor: accent,
  },
  tabButtonText: {
    color: accent,
    fontSize: 14,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#fff',
  },
});
