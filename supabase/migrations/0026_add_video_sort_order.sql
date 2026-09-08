-- 영상은 id가 uuid라 추가한 순서를 알 수 없었음(정렬 기준이 사실상 무작위) — 사용자별/카테고리별로
-- 직접 순서를 매길 수 있는 컬럼을 추가한다. 기존 행은 ctid(물리적 저장 순서, 대체로 삽입 순서와
-- 비슷함) 기준으로 초기값을 채운다 — 완벽하진 않지만 지금부터는 새로 추가되는 영상이 항상
-- 마지막 순번을 받도록 코드에서 관리하므로 문제없음
alter table public.videos add column sort_order integer not null default 0;

with ordered as (
  select id, row_number() over (partition by category_id, user_id order by ctid) as rn
  from public.videos
)
update public.videos v
set sort_order = ordered.rn
from ordered
where v.id = ordered.id;
