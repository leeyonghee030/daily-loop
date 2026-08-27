-- 루틴은 완료기록 보존을 위해 완전삭제(hard delete)를 하지 않기로 했지만(0021 이후),
-- 그래도 "루틴 복구" 화면이 계속 쌓이면 지저분하니 목록에서만 치우는 용도의 컬럼을 추가한다.
-- deleted_at과 별개 — 이 값이 있어도 캘린더/통계 기록은 그대로 살아있고, "루틴 복구" 목록에만 안 보임.
alter table routines add column archived_at timestamptz;
