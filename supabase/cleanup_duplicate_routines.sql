-- 즐겨찾기 "바로 추가"로 테스트하면서 쌓인 중복 루틴 정리용 (1회성, 정리 끝나면 지워도 됨)

-- 1) 먼저 확인만: 뭐가 중복인지, 뭐가 지워질지 미리보기
with ranked as (
  select
    id, title, block_type, scheduled_time_start, slot_id, created_at,
    row_number() over (
      partition by title, block_type, scheduled_time_start, slot_id
      order by created_at asc
    ) as rn
  from public.routines
  where user_id = (select id from public.users where email = 'leeyonghee030@gmail.com')
    and deleted_at is null
)
select * from ranked where rn > 1;

-- 2) 위 결과가 맞으면 이 UPDATE 실행 — 같은 제목/타입/시간/슬롯 조합 중
--    가장 먼저 만든 것 하나만 남기고 나머지는 소프트 삭제 (완료 기록은 안 건드림)
with ranked as (
  select
    id,
    row_number() over (
      partition by title, block_type, scheduled_time_start, slot_id
      order by created_at asc
    ) as rn
  from public.routines
  where user_id = (select id from public.users where email = 'leeyonghee030@gmail.com')
    and deleted_at is null
)
update public.routines
set deleted_at = now()
where id in (select id from ranked where rn > 1);
