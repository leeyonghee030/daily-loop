-- 루틴 즐겨찾기 — 자주 쓰는 개별 루틴을 "제목/타입/시간/필수여부" 템플릿으로 저장해두고
-- 나중에 루틴 추가 화면이나 모음집 항목 추가 시 바로 불러다 쓰기 위한 테이블
-- (모음집(routine_presets)과 달리 반복 규칙이 없음 — 낱개 루틴 하나의 템플릿이기 때문)

create table public.routine_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  block_type text not null check (block_type in ('check', 'tracking')),
  scheduled_time_start time,
  scheduled_time_end time,
  slot_id uuid references public.slots(id),
  is_required boolean not null default false,
  tracking_unit text,
  created_at timestamptz not null default now(),

  constraint chk_favorite_time_or_slot check ((scheduled_time_start is not null) <> (slot_id is not null)),
  constraint chk_favorite_scheduled_time_range check (scheduled_time_start is null or scheduled_time_end is not null),
  constraint chk_favorite_tracking_unit check (block_type <> 'tracking' or tracking_unit is not null)
);

alter table public.routine_favorites enable row level security;

create policy "본인 즐겨찾기만 조회/수정" on public.routine_favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
