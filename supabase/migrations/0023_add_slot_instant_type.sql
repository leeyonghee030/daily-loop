-- 슬롯(아침/점심/저녁/자기전)도 루틴처럼 "몇시~몇시" 범위 대신 "정확히 이 시각에 체크"만
-- 하는 시각 체크 타입을 고를 수 있게 함. 기본값은 체크형(is_instant=true) — 기존
-- start_time~end_time 범위는 그대로 DB에 남아있고(슬롯 기반 루틴의 시간대 강조 등에서 계속
-- 쓰임), 이 컬럼은 설정 화면에서 "이 슬롯을 몇시~몇시 범위로 보여줄지, 아니면 한 시각만
-- 보여줄지"를 결정하는 표시용 스위치다.
alter table public.slots
  add column if not exists is_instant boolean not null default true;
