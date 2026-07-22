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
};

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name').order('id');
  if (error) throw error;
  return data ?? [];
}

export async function fetchVideosByCategory(categoryId: number): Promise<Video[]> {
  const { data, error } = await supabase.from('videos').select('*').eq('category_id', categoryId);
  if (error) throw error;
  return data ?? [];
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
