-- 통계 화면에서 특정 루틴 카드만 숨길 수 있게(루틴 자체는 그대로 유지)
alter table routines add column hide_from_stats boolean not null default false;
