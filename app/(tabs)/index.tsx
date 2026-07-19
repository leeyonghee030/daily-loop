import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function TodayScreen() {
  const { session } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>오늘</Text>
      <Text style={styles.email}>{session?.user.email}</Text>
      {/* 임시 로그아웃 버튼 — 실제 설정 화면(4-14) 만들면 이쪽으로 옮길 예정 */}
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  email: {
    marginTop: 8,
    fontSize: 13,
    opacity: 0.6,
  },
  signOutButton: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signOutText: {
    color: '#FF6B6B',
  },
});
