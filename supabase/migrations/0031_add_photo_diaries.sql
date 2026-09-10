-- 사진일기: 기존 텍스트 일기(diaries)와 별개로, 하루에 1개까지 추가로 남길 수 있는
-- "사진 + 글(직접 작성 또는 그날 루틴 목록)" 형태의 기록.
create table public.photo_diaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  entry_date date not null,
  photo_url text not null,
  mode text not null check (mode in ('text', 'routines')),
  -- mode='text'일 때만 사용
  content text,
  -- mode='routines'일 때만 사용 — 화면에 보여줄(숨기지 않은) 루틴만, 보여줄 순서 그대로 담는다
  routine_ids uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index idx_photo_diaries_user_date_active
  on public.photo_diaries (user_id, entry_date) where deleted_at is null;

alter table public.photo_diaries enable row level security;

create policy "본인 사진일기만 조회/수정" on public.photo_diaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 사진 저장용 스토리지 버킷 (공개 읽기, 본인 폴더에만 쓰기 가능) — routine-photos와 동일 패턴
insert into storage.buckets (id, name, public)
values ('photo-diaries', 'photo-diaries', true)
on conflict (id) do nothing;

create policy "photo diaries: owner can insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'photo-diaries' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo diaries: owner can update"
on storage.objects for update
to authenticated
using (bucket_id = 'photo-diaries' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo diaries: owner can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'photo-diaries' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo diaries: public read"
on storage.objects for select
to public
using (bucket_id = 'photo-diaries');
