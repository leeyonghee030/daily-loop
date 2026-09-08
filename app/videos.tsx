import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { BackHandler, StyleSheet } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { CategoryVideoGrid } from '@/components/CategoryVideoGrid';
import { RecommendedVideoGrid } from '@/components/RecommendedVideoGrid';
import { Text, View } from '@/components/Themed';
import { cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useTranslation } from '@/lib/language';

export default function VideosScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'recommended'>('mine');
  const accent = useAccentColor();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);

  // 추천 영상 탭을 보고 있을 때 뒤로가기를 누르면 화면째로 나가버리지 않고 "내 영상" 탭으로만
  // 돌아오게 한다 — "내 영상" 탭에서 누를 때는 원래대로 화면을 나간다
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (tab === 'recommended') {
          setTab('mine');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [tab])
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <AnimatedPressable style={[styles.tabButton, tab === 'mine' && styles.tabButtonActive]} onPress={() => setTab('mine')}>
          <Text style={[styles.tabButtonText, tab === 'mine' && styles.tabButtonTextActive]}>{t('videos.myVideos')}</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.tabButton, tab === 'recommended' && styles.tabButtonActive]}
          onPress={() => setTab('recommended')}>
          <Text style={[styles.tabButtonText, tab === 'recommended' && styles.tabButtonTextActive]}>{t('videos.recommended')}</Text>
        </AnimatedPressable>
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

function createStyles(accent: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: 20,
      paddingHorizontal: 20,
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
}
