-- 캘린더 아무 날짜에나 짧은 포스트잇 메모를 여러 개 남길 수 있는 기능.
-- 하루당 일기(diaries)는 하나뿐이지만, 이 메모는 하루에 여러 개(색상 구분) 가능.
create table public.date_memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  memo_date date not null,
  content text not null,
  color text not null check (color in ('yellow', 'red', 'mint', 'blue', 'purple')),
  created_at timestamptz not null default now()
);

create index idx_date_memos_user_date on public.date_memos (user_id, memo_date);

alter table public.date_memos enable row level security;

create policy "본인 메모만 조회/수정" on public.date_memos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
