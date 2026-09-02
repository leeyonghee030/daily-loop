import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
} from 'react-native';

// 내용이 짧아 화면을 안 채울 때도 드래그 제스처가 스크롤로 인식되도록 확보하는 여백 높이
const SCROLL_SPACER_HEIGHT = Math.round(Dimensions.get('window').height * 0.8);

import { Text, View } from '@/components/Themed';
import { accent, border, cardRadius } from '@/constants/theme';
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

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<string | null>(null);
  const [content, setContent] = useState('');

  const diaryQuery = useQuery({
    queryKey: ['diary', userId, date],
    queryFn: () => fetchDiary(userId!, date),
    enabled: !!userId && !!date,
  });
  const isLoading = diaryQuery.isLoading;

  useEffect(() => {
    const diary = diaryQuery.data;
    if (!diary) return;
    setDiaryId(diary.id);
    setContent(diary.content);
  }, [diaryQuery.data]);

  useEffect(() => {
    if (diaryQuery.isError) setErrorMessage('일기를 불러오지 못했어요.');
  }, [diaryQuery.isError]);

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
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}>
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

          <View style={{ height: SCROLL_SPACER_HEIGHT }} />
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
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
  inner: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  textArea: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    padding: 14,
    fontSize: 15,
  },
  error: {
    color: '#FF6B6B',
    marginTop: 12,
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: accent,
    borderRadius: cardRadius,
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
    borderRadius: cardRadius,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
