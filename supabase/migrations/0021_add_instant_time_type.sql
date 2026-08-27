-- "8시에 기상"처럼 시간을 차지하지 않고 그 순간에 체크만 하는 루틴을 위한 타입.
-- 기존 "정확한 시각(범위)" 타입은 시작=끝으로 저장하면 끝이 시작보다 뒤가 아니라고 판단해
-- 자정(다음날)까지 이어지는 것으로 잘못 계산되던 문제가 있어, 별도 플래그로 구분한다.
alter table routines add column is_instant boolean not null default false;
alter table preset_items add column is_instant boolean not null default false;
alter table routine_favorites add column is_instant boolean not null default false;
