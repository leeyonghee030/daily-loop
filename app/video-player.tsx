import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { Text, View } from '@/components/Themed';
import { extractYoutubeId, fetchVideoById, type Video } from '@/lib/videos';

export default function VideoPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [video, setVideo] = useState<Video | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchVideoById(id).then(setVideo);
  }, [id]);

  if (!video) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const youtubeId = extractYoutubeId(video.youtube_url);

  return (
    <View style={styles.container}>
      {youtubeId ? (
        <WebView
          style={styles.player}
          source={{ uri: `https://www.youtube.com/embed/${youtubeId}` }}
          allowsFullscreenVideo
        />
      ) : (
        <View style={[styles.player, styles.centered]}>
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

const styles = StyleSheet.create({
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
    aspectRatio: 16 / 9,
  },
  info: {
    padding: 20,
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
    borderColor: '#7C5CFC',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  channelName: {
    fontSize: 14,
    fontWeight: '600',
  },
  channelLink: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    opacity: 0.5,
  },
});
