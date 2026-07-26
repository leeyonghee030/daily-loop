import { supabase } from '@/lib/supabase';

export type Category = {
  id: number;
  name: string;
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

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name').order('id');
  if (error) throw error;
  return data ?? [];
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
