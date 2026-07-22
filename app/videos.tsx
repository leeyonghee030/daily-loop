import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { CategoryVideoGrid } from '@/components/CategoryVideoGrid';
import { Text, View } from '@/components/Themed';

export default function VideosScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>영상</Text>
      <CategoryVideoGrid
        onSelectVideo={(video) => router.push({ pathname: '/video-player', params: { id: video.id } })}
      />
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
});
