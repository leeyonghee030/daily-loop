-- 1회성(once) 루틴이 "언제" 할 루틴인지 저장할 날짜 컬럼 추가
-- (project-spec.md 4-9, domain-model.md 2-5에는 있었지만 최초 스키마에 날짜 컬럼이 누락돼 있었음)

alter table public.routines
  add column scheduled_date date;

alter table public.routines
  add constraint chk_once_scheduled_date
  check (repeat_type <> 'once' or scheduled_date is not null);
