import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { deleteDiary, fetchDiary, saveDiary } from '@/lib/diary';

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 일기`;
}

export default function DiaryFormScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<string | null>(null);
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!userId || !date) return;
    fetchDiary(userId, date)
      .then((diary) => {
        if (diary) {
          setDiaryId(diary.id);
          setContent(diary.content);
        }
      })
      .catch(() => setErrorMessage('일기를 불러오지 못했어요.'))
      .finally(() => setIsLoading(false));
  }, [userId, date]);

  async function handleSave() {
    if (!userId || !date) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveDiary(userId, date, content, diaryId);
      router.back();
    } catch (err) {
      setErrorMessage('저장에 실패했어요. 다시 시도해주세요.');
      setIsSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert('일기를 삭제할까요?', '삭제하면 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          if (!diaryId) return;
          setIsSaving(true);
          try {
            await deleteDiary(diaryId);
            router.back();
          } catch (err) {
            setErrorMessage('삭제에 실패했어요.');
            setIsSaving(false);
          }
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={styles.title}>{formatDateLabel(date)}</Text>

      <TextInput
        style={styles.textArea}
        value={content}
        onChangeText={setContent}
        placeholder="오늘 하루 어땠나요?"
        multiline
        textAlignVertical="top"
      />

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>저장</Text>}
      </Pressable>

      {diaryId && (
        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
          <Text style={styles.deleteButtonText}>일기 삭제</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  textArea: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
  },
  error: {
    color: '#FF6B6B',
    marginTop: 12,
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
