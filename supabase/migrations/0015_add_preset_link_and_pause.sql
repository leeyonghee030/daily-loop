-- "내 루틴"에서 모음집별로 묶어보고, 모음집 단위 일괄 액션(활성화/비활성화/삭제)을 하기 위해
-- 어떤 모음집에서 만들어진 루틴인지 추적 (모음집이 삭제돼도 루틴 자체는 남도록 SET NULL)
alter table public.routines
  add column preset_id uuid references public.routine_presets(id) on delete set null;

-- 삭제와 다른 "일시정지" 상태 — 켜두면 오늘 탭/캘린더/통계 어디에도 예정으로 안 잡히고,
-- 그 기간은 수행률 계산에서도 빠짐(공휴일 제외와 동일한 방식으로 취급)
alter table public.routines
  add column is_paused boolean not null default false;
