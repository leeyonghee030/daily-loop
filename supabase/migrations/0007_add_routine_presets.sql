-- 루틴 프리셋(모음집) — "평일 일정", "주말", "학원" 처럼 자주 쓰는 루틴 묶음을
-- 미리 만들어두고 한 번에 적용(=그 안의 항목들을 실제 routines로 복사 생성)하기 위한 테이블
--
-- 반복 규칙(매일/평일/주말/특정요일)과 공휴일 제외 여부는 모음집 전체에 하나로 적용됨
-- (개별 항목마다 다르게 줄 필요가 없다는 전제 — project-spec.md 참고)

create table public.routine_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  repeat_type text not null check (repeat_type in ('daily', 'weekday', 'weekend', 'custom')),
  repeat_days smallint[],
  skip_holidays boolean not null default false,
  created_at timestamptz not null default now(),

  constraint chk_preset_custom_repeat_days check (repeat_type <> 'custom' or repeat_days is not null)
);

create table public.preset_items (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references public.routine_presets(id) on delete cascade,
  title text not null,
  block_type text not null check (block_type in ('check', 'tracking')),
  scheduled_time_start time,
  scheduled_time_end time,
  slot_id uuid references public.slots(id),
  is_required boolean not null default false,
  tracking_unit text,
  sort_order integer not null default 0,

  constraint chk_preset_item_time_or_slot check ((scheduled_time_start is not null) <> (slot_id is not null)),
  constraint chk_preset_item_scheduled_time_range check (scheduled_time_start is null or scheduled_time_end is not null),
  constraint chk_preset_item_tracking_unit check (block_type <> 'tracking' or tracking_unit is not null)
);

create index idx_preset_items_preset on public.preset_items (preset_id);

alter table public.routine_presets enable row level security;
alter table public.preset_items enable row level security;

create policy "본인 프리셋만 조회/수정" on public.routine_presets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "본인 프리셋의 항목만 조회/수정" on public.preset_items
  for all using (
    exists (select 1 from public.routine_presets p where p.id = preset_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.routine_presets p where p.id = preset_id and p.user_id = auth.uid())
  );
