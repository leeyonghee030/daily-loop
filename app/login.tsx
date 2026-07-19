import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { signInWithGoogle } from '@/lib/google-signin';

export default function LoginScreen() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('구글 로그인 실패:', error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Daily Loop</Text>
      <Text style={styles.subtitle}>말하듯 적으면 루틴이 짜여요</Text>

      <Pressable style={styles.googleButton} onPress={handleGoogleSignIn} disabled={isSigningIn}>
        {isSigningIn ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.googleButtonText}>구글로 시작하기</Text>
        )}
      </Pressable>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 48,
    fontSize: 14,
    opacity: 0.6,
  },
  googleButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  googleButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
  },
});
