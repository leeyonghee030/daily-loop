-- =========================================================
-- 사용자 개인 영상 추가 (project-spec.md 4-10-1)
-- videos.user_id가 비어있으면 관리자 공용 영상, 채워져 있으면 그 사용자 전용 개인 영상(비공개)
-- =========================================================

alter table public.videos
  add column user_id uuid null references public.users(id) on delete cascade;

create index idx_videos_user on public.videos (user_id) where user_id is not null;

drop policy "로그인 유저 전체 조회" on public.videos;

create policy "공용 영상 또는 본인 영상만 조회" on public.videos
  for select using (user_id is null or auth.uid() = user_id);

create policy "본인 영상만 추가" on public.videos
  for insert with check (auth.uid() = user_id);

create policy "본인 영상만 수정" on public.videos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "본인 영상만 삭제" on public.videos
  for delete using (auth.uid() = user_id);
