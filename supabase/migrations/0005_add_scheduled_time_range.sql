-- 정확한 시각 지정 루틴을 "시각 하나"가 아니라 "시작~종료 범위"로 저장하도록 변경
-- (오늘 탭에서 지금 시각이 이 범위 안이면 테두리로 강조 표시하기 위함)

alter table public.routines
  rename column scheduled_time to scheduled_time_start;

alter table public.routines
  add column scheduled_time_end time;

-- 기존 더미 데이터(seed_today_test.sql로 넣은 것) 종료 시각 채워넣기
update public.routines
  set scheduled_time_end = scheduled_time_start + interval '30 minutes'
  where scheduled_time_start is not null and scheduled_time_end is null;

alter table public.routines
  drop constraint chk_time_or_slot;

alter table public.routines
  add constraint chk_time_or_slot
  check ((scheduled_time_start is not null) <> (slot_id is not null));

alter table public.routines
  add constraint chk_scheduled_time_range
  check (scheduled_time_start is null or scheduled_time_end is not null);
