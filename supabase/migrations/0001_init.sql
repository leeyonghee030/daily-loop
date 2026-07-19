-- Daily Loop 초기 스키마 (docs/erd.md 기반)
-- Supabase 대시보드 > SQL Editor 에서 전체 붙여넣고 Run 하면 됩니다.

create extension if not exists pgcrypto;

-- =========================================================
-- 1. categories (6개 고정, 시드 데이터)
-- =========================================================
create table public.categories (
  id smallint primary key,
  name text not null unique
);

-- =========================================================
-- 2. streak_emoji_configs (전역 설정, 시드 데이터)
-- =========================================================
create table public.streak_emoji_configs (
  id smallint primary key,
  min_days integer not null,
  max_days integer,
  emoji text not null,
  label text not null
);

-- =========================================================
-- 3. users (Supabase Auth의 auth.users를 그대로 확장하는 프로필 테이블)
--    id가 auth.users.id를 그대로 참조 — 별도 회원가입 로직 없이
--    구글/카카오 로그인 성공 시 auth.users에 자동 생성되는 행을 따라감
-- =========================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  auth_provider text not null check (auth_provider in ('google', 'kakao')),
  llm_call_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 4. slots (유저당 4개 고정)
-- =========================================================
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  slot_type text not null check (slot_type in ('morning', 'lunch', 'evening', 'before_sleep')),
  start_time time not null,
  end_time time not null,
  notify_enabled boolean not null default true,
  unique (user_id, slot_type)
);

create index idx_slots_notify_time on public.slots (start_time) where notify_enabled = true;

-- =========================================================
-- 5. videos
-- =========================================================
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  category_id smallint not null references public.categories(id),
  title text not null,
  youtube_url text not null,
  thumbnail_url text not null,
  channel_name text not null,
  channel_url text not null
);

create index idx_videos_category on public.videos (category_id);

-- =========================================================
-- 6. routines
-- =========================================================
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  block_type text not null check (block_type in ('check', 'tracking')),
  repeat_type text not null check (repeat_type in ('daily', 'weekday', 'weekend', 'custom', 'once')),
  repeat_days smallint[],
  scheduled_time time,
  slot_id uuid references public.slots(id),
  is_required boolean not null default false,
  notify_enabled boolean not null default false,
  category_id smallint references public.categories(id),
  video_id uuid references public.videos(id),
  tracking_unit text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint chk_time_or_slot check ((scheduled_time is not null) <> (slot_id is not null)),
  constraint chk_custom_repeat_days check (repeat_type <> 'custom' or repeat_days is not null),
  constraint chk_tracking_unit check (block_type <> 'tracking' or tracking_unit is not null)
);

create index idx_routines_user_active on public.routines (user_id) where deleted_at is null;
create index idx_routines_required on public.routines (user_id, is_required) where deleted_at is null;

-- =========================================================
-- 7. routine_completions
-- =========================================================
create table public.routine_completions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  completed_date date not null,
  tracking_value numeric,
  completed_at timestamptz not null default now(),
  unique (routine_id, completed_date)
);

create index idx_completions_date on public.routine_completions (completed_date);

-- =========================================================
-- 8. diaries
-- =========================================================
create table public.diaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  entry_date date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index idx_diaries_user_date_active
  on public.diaries (user_id, entry_date) where deleted_at is null;

-- =========================================================
-- 9. 신규 가입자 자동 세팅 트리거
--    auth.users에 새 행이 생기면(구글/카카오 로그인 최초 성공 시)
--    public.users 프로필 + 기본 슬롯 4개를 자동으로 만들어줌
-- =========================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, auth_provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'provider', 'google')
  );

  insert into public.slots (user_id, slot_type, start_time, end_time) values
    (new.id, 'morning', '05:00', '11:00'),
    (new.id, 'lunch', '11:00', '15:00'),
    (new.id, 'evening', '15:00', '21:00'),
    (new.id, 'before_sleep', '21:00', '05:00');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- 10. Row Level Security — "내 데이터는 나만" 규칙
-- =========================================================
alter table public.users enable row level security;
alter table public.slots enable row level security;
alter table public.routines enable row level security;
alter table public.routine_completions enable row level security;
alter table public.diaries enable row level security;
alter table public.categories enable row level security;
alter table public.videos enable row level security;
alter table public.streak_emoji_configs enable row level security;

create policy "본인 프로필만 조회/수정" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "본인 슬롯만 조회/수정" on public.slots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "본인 루틴만 조회/수정" on public.routines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "본인 루틴의 완료기록만 조회/수정" on public.routine_completions
  for all using (
    exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid())
  );

create policy "본인 일기만 조회/수정" on public.diaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 카테고리/영상/스트릭 설정은 전역 공용 콘텐츠 — 로그인한 유저는 읽기만 가능, 쓰기는 대시보드(관리자)에서만
create policy "로그인 유저 전체 조회" on public.categories
  for select using (auth.role() = 'authenticated');

create policy "로그인 유저 전체 조회" on public.videos
  for select using (auth.role() = 'authenticated');

create policy "로그인 유저 전체 조회" on public.streak_emoji_configs
  for select using (auth.role() = 'authenticated');

-- =========================================================
-- 11. 시드 데이터
-- =========================================================
insert into public.categories (id, name) values
  (1, '운동'),
  (2, '뷰티'),
  (3, '독서'),
  (4, '모닝루틴'),
  (5, '마인드풀니스'),
  (6, '공부/자기계발');

insert into public.streak_emoji_configs (id, min_days, max_days, emoji, label) values
  (1, 2, 5, '🪨', '아기 돌'),
  (2, 6, 12, '🗿', '눈뜬 돌'),
  (3, 13, 24, '🔥🗿', '불붙은 돌'),
  (4, 25, null, '👑🗿', '전설의 돌');
