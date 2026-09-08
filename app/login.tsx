import { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { signInWithGoogle } from '@/lib/google-signin';
import { signInWithKakao } from '@/lib/kakao-signin';
import { useTranslation } from '@/lib/language';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [isSigningIn, setIsSigningIn] = useState<'google' | 'kakao' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsSigningIn('google');
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('구글 로그인 실패:', error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSigningIn(null);
    }
  };

  const handleKakaoSignIn = async () => {
    setErrorMessage(null);
    setIsSigningIn('kakao');
    try {
      await signInWithKakao();
    } catch (error) {
      console.error('카카오 로그인 실패:', error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSigningIn(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Daily Loop</Text>
      <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

      <AnimatedPressable style={styles.googleButton} onPress={handleGoogleSignIn} disabled={!!isSigningIn}>
        {isSigningIn === 'google' ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.googleButtonText}>{t('login.google')}</Text>
        )}
      </AnimatedPressable>

      <AnimatedPressable style={styles.kakaoButton} onPress={handleKakaoSignIn} disabled={!!isSigningIn}>
        {isSigningIn === 'kakao' ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.kakaoButtonText}>{t('login.kakao')}</Text>
        )}
      </AnimatedPressable>

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
  kakaoButton: {
    width: '100%',
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FEE500',
    alignItems: 'center',
  },
  kakaoButtonText: {
    color: '#191919',
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
