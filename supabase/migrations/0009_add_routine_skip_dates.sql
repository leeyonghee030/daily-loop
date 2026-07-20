-- 루틴 "오늘 하루만 건너뛰기" — 반복 규칙은 그대로 두고 특정 날짜만 오늘 탭에서 빼기 위한 테이블
-- (전체 삭제는 기존처럼 routines.deleted_at 소프트 삭제 그대로 사용)

create table public.routine_skip_dates (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  skip_date date not null,
  unique (routine_id, skip_date)
);

alter table public.routine_skip_dates enable row level security;

create policy "본인 루틴의 건너뛰기 날짜만 조회/수정" on public.routine_skip_dates
  for all using (
    exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid())
  );
