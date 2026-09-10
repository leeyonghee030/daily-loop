-- 사진일기 "루틴 고르기" 모드를 세로 리스트에서 자유 캔버스(사진 위 포함 아무 곳에나
-- 드래그해서 배치)로 바꾸면서, 단순 순서 배열(routine_ids)로는 위치(x,y)를 담을 수 없어
-- 각 블록(루틴 또는 자유 메모)의 위치까지 담는 jsonb 배열로 교체한다.
alter table public.photo_diaries drop column routine_ids;
alter table public.photo_diaries add column blocks jsonb;
alter table public.photo_diaries add column routine_color_enabled boolean not null default true;
-- 카메라로 찍은 사진에만 "옛날 카메라" 느낌(흐림+테마색 틴트)을 다시 열었을 때도 유지하기 위해 기록
alter table public.photo_diaries add column photo_source text check (photo_source in ('camera', 'library'));
