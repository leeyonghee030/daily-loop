import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';

import { Text, View } from '@/components/Themed';
import { cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { extractYoutubeId, fetchVideoById } from '@/lib/videos';

export default function VideoPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loadFailed, setLoadFailed] = useState(false);
  const { width } = useWindowDimensions();
  const accent = useAccentColor();
  const styles = useMemo(() => createStyles(accent), [accent]);

  // routine-form의 video 조회와 같은 쿼리 키를 써서 캐시를 공유한다
  const videoQuery = useQuery({
    queryKey: ['video', id],
    queryFn: () => fetchVideoById(id!),
    enabled: !!id,
  });
  const video = videoQuery.data ?? null;

  const onStateChange = useCallback((state: string) => {
    if (state === 'error') setLoadFailed(true);
  }, []);

  if (!video) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const youtubeId = extractYoutubeId(video.youtube_url);
  const playerHeight = (width * 9) / 16;

  return (
    <View style={styles.container}>
      {youtubeId && !loadFailed ? (
        <YoutubePlayer
          height={playerHeight}
          width={width}
          videoId={youtubeId}
          play={false}
          onChangeState={onStateChange}
        />
      ) : (
        <View style={[styles.player, { height: playerHeight }, styles.centered]}>
          <Text style={styles.errorText}>영상을 불러올 수 없어요</Text>
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.title}>{video.title}</Text>
        <Pressable style={styles.channelRow} onPress={() => Linking.openURL(video.channel_url)}>
          <Text style={styles.channelName}>{video.channel_name}</Text>
          <Text style={styles.channelLink}>채널 방문 ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    player: {
      width: '100%',
    },
    info: {
      padding: 20,
      paddingBottom: 48,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 12,
    },
    channelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: accent,
      borderRadius: cardRadius,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    channelName: {
      fontSize: 14,
      fontWeight: '600',
    },
    channelLink: {
      color: accent,
      fontSize: 13,
      fontWeight: '600',
    },
    errorText: {
      opacity: 0.5,
    },
  });
}
