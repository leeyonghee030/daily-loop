import { supabase } from '@/lib/supabase';

export type Category = {
  id: number;
  name: string;
  user_id: string | null;
};

export type Video = {
  id: string;
  category_id: number;
  title: string;
  youtube_url: string;
  thumbnail_url: string;
  channel_name: string;
  channel_url: string;
  user_id: string | null;
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

// "내 그리드" — 내가 직접 추가했거나(개인 영상) 추천 목록에서 가져온 영상만
export async function fetchVideosByCategory(categoryId: number, userId: string): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('category_id', categoryId)
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
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

export async function addRecommendedVideoToMyGrid(userId: string, video: Video): Promise<Video> {
  const { data, error } = await supabase
    .from('videos')
    .insert({
      category_id: video.category_id,
      title: video.title,
      youtube_url: video.youtube_url,
      thumbnail_url: video.thumbnail_url,
      channel_name: video.channel_name,
      channel_url: video.channel_url,
      user_id: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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
): Promise<Video> {
  const videoId = extractYoutubeId(youtubeUrl.trim());
  if (!videoId) throw new Error('올바른 유튜브 링크가 아니에요.');

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
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
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
