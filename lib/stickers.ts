import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

// 사진일기 "붙여넣기"로 캔버스에 올린 이미지 중 사용자가 직접 "모음집에 저장"을 눌러
// 골라둔 것만 여기 쌓인다(자동 저장 아님) — 요즘 스티커 꾸미기 앱들처럼, 한 번 저장해두면
// 다른 날짜 사진일기에서도 다시 꺼내 붙여 쓸 수 있는 개인 보관함
export type StickerItem = {
  id: string;
  image_url: string;
  created_at: string;
};

export async function fetchStickerCollection(userId: string): Promise<StickerItem[]> {
  const { data, error } = await supabase
    .from('sticker_collection')
    .select('id, image_url, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// isLocal이면 아직 기기 안에만 있는 이미지라 업로드부터 해야 하고, 이미 사진일기 저장 등으로
// 업로드된(https://) 이미지면 같은 파일을 다시 올리지 않고 그 주소를 그대로 재사용한다
export async function saveStickerToCollection(userId: string, uri: string, isLocal: boolean): Promise<StickerItem> {
  let imageUrl = uri;
  if (isLocal) {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    // photo-diaries 버킷을 그대로 재사용 — 본인 폴더 하위에는 어디든 쓸 수 있는 정책이
    // 이미 걸려 있어서 새 버킷을 만들 필요가 없다(sticker_collection 마이그레이션 참고)
    const path = `${userId}/stickers/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('photo-diaries')
      .upload(path, decode(base64), { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('photo-diaries').getPublicUrl(path);
    imageUrl = data.publicUrl;
  }
  const { data, error } = await supabase
    .from('sticker_collection')
    .insert({ user_id: userId, image_url: imageUrl })
    .select('id, image_url, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStickerFromCollection(id: string): Promise<void> {
  const { error } = await supabase
    .from('sticker_collection')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
