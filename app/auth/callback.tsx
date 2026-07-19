import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';

// WebBrowser.openAuthSessionAsync가 리다이렉트를 가로채서 보통 이 화면까지
// 오지 않지만, 실제로 딥링크로 진입하는 예외 상황을 대비한 안전망
export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/(tabs)' : '/login');
    });
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
