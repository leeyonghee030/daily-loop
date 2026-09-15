-- 사진일기 붙여넣기 스티커 모음집: 클립보드로 붙여넣은 이미지 중 사용자가 "모음집에
-- 저장"을 눌러 직접 고른 것만 저장되는 개인 보관함(자동 저장 아님). 저장해두면 다른
-- 날짜의 사진일기에서도 다시 꺼내 붙여 쓸 수 있다.
create table public.sticker_collection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_sticker_collection_user_active
  on public.sticker_collection (user_id, created_at desc) where deleted_at is null;

alter table public.sticker_collection enable row level security;

create policy "본인 스티커 모음집만 조회/수정" on public.sticker_collection
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 이미지 파일은 이미 있는 photo-diaries 버킷을 재사용(본인 폴더 하위 어디든 쓰기 가능한
-- 정책이 이미 걸려 있어 새 버킷/정책이 필요 없음) — 경로만 `${userId}/stickers/...`로 구분
