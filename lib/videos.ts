import type { TranslationKey } from '@/lib/language';
import { supabase } from '@/lib/supabase';

export type Category = {
  id: number;
  name: string;
  user_id: string | null;
};

// 관리자가 기본 제공하는 카테고리 6종 — 유저가 만든 커스텀 카테고리는 그대로 원문 이름을 보여주고,
// 이 이름과 정확히 일치하는 기본 카테고리만 화면 언어에 맞춰 번역해서 보여준다
const DEFAULT_CATEGORY_NAME_KEYS: Record<string, TranslationKey> = {
  운동: 'videoCategory.exercise',
  뷰티: 'videoCategory.beauty',
  독서: 'videoCategory.reading',
  모닝루틴: 'videoCategory.morningRoutine',
  마인드풀니스: 'videoCategory.mindfulness',
  '공부/자기계발': 'videoCategory.study',
};

export function categoryDisplayName(name: string, t: (key: TranslationKey) => string): string {
  const key = DEFAULT_CATEGORY_NAME_KEYS[name];
  return key ? t(key) : name;
}

export type Video = {
  id: string;
  category_id: number;
  title: string;
  youtube_url: string;
  thumbnail_url: string;
  channel_name: string;
  channel_url: string;
  user_id: string | null;
  sort_order: number;
};

// 기본 카테고리(내가 숨긴 건 제외) + 내가 만든 카테고리 (RLS가 기본+내 것으로 조회를 좁혀줌)
export async function fetchCategories(userId: string): Promise<Category[]> {
  const [{ data: cats, error: catErr }, { data: hidden, error: hiddenErr }] = await Promise.all([
    supabase.from('categories').select('id, name, user_id').is('deleted_at', null).order('id'),
    supabase.from('hidden_default_categories').select('category_id').eq('user_id', userId),
  ]);
  if (catErr) throw catErr;
  if (hiddenErr) throw hiddenErr;
  const hiddenIds = new Set((hidden ?? []).map((h) => h.category_id));
  return (cats ?? []).filter((c) => !(c.user_id === null && hiddenIds.has(c.id)));
}

// 기본 카테고리를 "삭제"할 때 사용 — 공용 행이라 진짜로 지우지 않고 이 유저에게서만 숨긴다.
// 그 안에 내가 직접 추가한 영상은 이 자리에서 바로 지워짐(복구 불가) — 대신 저희가 기본 제공하는
// 영상(추천 카탈로그)은 "기본 카테고리 생성" 시 자동으로 다시 채워준다.
export async function hideDefaultCategory(userId: string, categoryId: number): Promise<void> {
  const { error: videoErr } = await supabase
    .from('videos')
    .delete()
    .eq('category_id', categoryId)
    .eq('user_id', userId);
  if (videoErr) throw videoErr;

  const { error } = await supabase
    .from('hidden_default_categories')
    .insert({ user_id: userId, category_id: categoryId });
  if (error) throw error;
}

export type HiddenDefaultCategory = { category_id: number; name: string };

// "삭제된 카테고리" 화면에서 내가 숨긴 기본 카테고리 목록을 보여줄 때 사용
export async function fetchHiddenDefaultCategories(userId: string): Promise<HiddenDefaultCategory[]> {
  const { data, error } = await supabase
    .from('hidden_default_categories')
    .select('category_id, categories(name)')
    .eq('user_id', userId)
    .returns<{ category_id: number; categories: { name: string } | null }[]>();
  if (error) throw error;
  return (data ?? []).map((row) => ({
    category_id: row.category_id,
    name: row.categories?.name ?? '',
  }));
}

// "기본 카테고리 생성" 버튼용 — 내가 숨긴 기본 카테고리를 전부 다시 보이게 하고,
// 그 카테고리들의 기본 제공(추천) 영상을 내 그리드에 자동으로 다시 채워준다.
// 내가 직접 추가했던 영상은 이미 지워진 상태라 돌아오지 않는다.
export async function recreateDefaultCategories(userId: string): Promise<void> {
  const { data: hidden, error: hiddenErr } = await supabase
    .from('hidden_default_categories')
    .select('category_id')
    .eq('user_id', userId);
  if (hiddenErr) throw hiddenErr;
  const categoryIds = (hidden ?? []).map((h) => h.category_id);

  if (categoryIds.length > 0) {
    const [{ data: defaultVideos, error: defaultErr }, { data: myVideos, error: myErr }] = await Promise.all([
      supabase.from('videos').select('*').in('category_id', categoryIds).is('user_id', null),
      supabase.from('videos').select('youtube_url, category_id').eq('user_id', userId).in('category_id', categoryIds),
    ]);
    if (defaultErr) throw defaultErr;
    if (myErr) throw myErr;

    // 이미 같은 카테고리에 같은 영상을 갖고 있으면 중복 추가하지 않는다
    const existing = new Set((myVideos ?? []).map((v) => `${v.category_id}:${v.youtube_url}`));
    const toInsert = (defaultVideos ?? [])
      .filter((v) => !existing.has(`${v.category_id}:${v.youtube_url}`))
      .map((v) => ({
        category_id: v.category_id,
        title: v.title,
        youtube_url: v.youtube_url,
        thumbnail_url: v.thumbnail_url,
        channel_name: v.channel_name,
        channel_url: v.channel_url,
        user_id: userId,
      }));

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from('videos').insert(toInsert);
      if (insertErr) throw insertErr;
    }
  }

  const { error } = await supabase.from('hidden_default_categories').delete().eq('user_id', userId);
  if (error) throw error;
}

// "추천 영상" 탭용 — 관리자 큐레이션 콘텐츠는 기본 카테고리에만 달려있어서 기본 카테고리만 보여준다
export async function fetchDefaultCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, user_id')
    .is('user_id', null)
    .order('id');
  if (error) throw error;
  return data ?? [];
}

export async function createCategory(userId: string, name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, name })
    .select('id, name, user_id')
    .single();
  if (error) throw error;
  return data;
}

export async function renameCategory(categoryId: number, name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update({ name })
    .eq('id', categoryId)
    .select('id, name, user_id')
    .single();
  if (error) throw error;
  return data;
}

export type DeletedCategory = Category & { deleted_at: string };

// "삭제된 카테고리" 목록용 — 3일 안에 복구 가능
export async function fetchDeletedCategories(userId: string): Promise<DeletedCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, user_id, deleted_at')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function softDeleteCategory(categoryId: number): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', categoryId);
  if (error) throw error;
}

export async function restoreCategory(categoryId: number): Promise<void> {
  const { error } = await supabase.from('categories').update({ deleted_at: null }).eq('id', categoryId);
  if (error) throw error;
}

// "삭제된 카테고리" 화면에서 3일을 안 기다리고 즉시 완전 삭제할 때 사용 (안의 영상도 같이 삭제됨)
export async function hardDeleteCategory(categoryId: number): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', categoryId);
  if (error) throw error;
}

// 소프트 삭제된 지 3일 지난 카테고리를 완전히 지운다 — 앱 열 때 하루 한 번 조용히 실행되는 용도
export async function purgeOldDeletedCategories(userId: string): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff.toISOString());
  if (error) throw error;
}

// "내 그리드" — 내가 직접 추가했거나(개인 영상) 추천 목록에서 가져온 영상만.
// sort_order(추가한 순서) 기준으로 정렬한다
export async function fetchVideosByCategory(categoryId: number, userId: string): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('category_id', categoryId)
    .eq('user_id', userId)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// 드래그 정렬 결과 저장 — sort_order를 새 순서(0,1,2...)로 일괄 반영(routines와 동일한 패턴)
export async function updateVideoSortOrder(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) => supabase.from('videos').update({ sort_order: index }).eq('id', id))
  );
}

// 이 카테고리에 새로 추가되는 영상이 항상 맨 뒤(추가한 순서)에 오도록, 지금 있는 것 중 가장 큰
// sort_order + 1을 구한다
async function nextVideoSortOrder(categoryId: number, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('videos')
    .select('sort_order')
    .eq('category_id', categoryId)
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.sort_order ?? -1) + 1;
}

// "추천 영상" — 관리자가 큐레이션한 공용 영상 카탈로그 (아직 내 그리드엔 없는 상태)
export async function fetchRecommendedVideosByCategory(categoryId: number): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('category_id', categoryId)
    .is('user_id', null);
  if (error) throw error;
  return data ?? [];
}

// 같은 카테고리에 같은 영상(유튜브 URL 기준)을 이미 추가해뒀으면 중복으로 또 넣지 않고 그
// 기존 행을 그대로 돌려준다 — alreadyAdded로 호출부가 "새로 추가" / "이미 있음"을 구분한다
export async function addRecommendedVideoToMyGrid(
  userId: string,
  video: Video,
  categoryId: number
): Promise<{ video: Video; alreadyAdded: boolean }> {
  // .maybeSingle()은 일치하는 행이 2개 이상이면 에러를 던지는데, 예전(중복 방지 로직이 없던
  // 시절)에 같은 영상을 실수로 여러 번 추가해 이미 중복 행이 쌓여있는 카테고리가 있을 수 있어서
  // — 그런 경우에도 안 터지도록 배열로 받아 첫 번째 행만 본다
  const { data: existingRows, error: checkError } = await supabase
    .from('videos')
    .select()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('youtube_url', video.youtube_url)
    .limit(1);
  if (checkError) throw checkError;
  const existing = existingRows?.[0];
  if (existing) return { video: existing, alreadyAdded: true };

  const { data, error } = await supabase
    .from('videos')
    .insert({
      category_id: categoryId,
      title: video.title,
      youtube_url: video.youtube_url,
      thumbnail_url: video.thumbnail_url,
      channel_name: video.channel_name,
      channel_url: video.channel_url,
      user_id: userId,
      sort_order: await nextVideoSortOrder(categoryId, userId),
    })
    .select()
    .single();
  if (error) throw error;
  return { video: data, alreadyAdded: false };
}

export async function countRoutinesUsingVideo(videoId: string): Promise<number> {
  const { count, error } = await supabase
    .from('routines')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', videoId)
    .is('deleted_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteUserVideo(videoId: string): Promise<void> {
  const { error } = await supabase.from('videos').delete().eq('id', videoId);
  if (error) throw error;
}

export async function fetchVideoById(videoId: string): Promise<Video> {
  const { data, error } = await supabase.from('videos').select('*').eq('id', videoId).single();
  if (error) throw error;
  return data;
}

export function extractYoutubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// oEmbed의 channel_url은 최근 채널의 "@핸들" 형식이라 유튜브 앱이 딥링크를 못 받아
// 홈으로 떨어지는 경우가 있어서, 영상 페이지 HTML에서 표준 채널ID(UC...)를 직접 추출해 사용한다.
async function resolveChannelUrl(watchUrl: string, fallbackUrl: string): Promise<string> {
  try {
    const res = await fetch(watchUrl);
    if (!res.ok) return fallbackUrl;
    const html = await res.text();
    const match = html.match(/"channelId":"(UC[\w-]{10,30})"/);
    return match ? `https://www.youtube.com/channel/${match[1]}` : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export async function createUserVideo(
  userId: string,
  categoryId: number,
  youtubeUrl: string
): Promise<{ video: Video; alreadyAdded: boolean }> {
  const videoId = extractYoutubeId(youtubeUrl.trim());
  if (!videoId) throw new Error('올바른 유튜브 링크가 아니에요.');

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // 같은 카테고리에 같은 영상을 실수로(더블탭 등) 두 번 추가하지 않도록, 추천 영상 추가와
  // 동일하게 먼저 중복인지 확인한다. limit(1)을 쓰는 이유도 addRecommendedVideoToMyGrid와 같음
  const { data: existingRows, error: checkError } = await supabase
    .from('videos')
    .select()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('youtube_url', canonicalUrl)
    .limit(1);
  if (checkError) throw checkError;
  const existing = existingRows?.[0];
  if (existing) return { video: existing, alreadyAdded: true };

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

  const res = await fetch(oembedUrl);
  if (!res.ok) throw new Error('영상 정보를 가져오지 못했어요. 링크를 확인해주세요.');
  const meta = await res.json();

  const channelUrl = await resolveChannelUrl(canonicalUrl, meta.author_url);

  const { data, error } = await supabase
    .from('videos')
    .insert({
      category_id: categoryId,
      title: meta.title,
      youtube_url: canonicalUrl,
      thumbnail_url: meta.thumbnail_url,
      channel_name: meta.author_name,
      channel_url: channelUrl,
      user_id: userId,
      sort_order: await nextVideoSortOrder(categoryId, userId),
    })
    .select()
    .single();
  if (error) throw error;
  return { video: data, alreadyAdded: false };
}
