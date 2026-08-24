-- 모음집도 루틴처럼 소프트 삭제로 바꾼다. 기존엔 모음집을 지우면 즉시 하드 삭제되면서
-- 연결된 루틴들의 preset_id도 FK(on delete set null)로 같이 끊어져버려서,
-- "모음집을 통째로 복구"하는 기능을 만들 수 없었음(연결 정보가 이미 사라진 뒤라서).
-- 소프트 삭제로 바꾸면 모음집 행이 실제로는 남아있어서 연결이 유지되고, 나중에 되살릴 수 있다.
alter table public.routine_presets add column deleted_at timestamptz;
