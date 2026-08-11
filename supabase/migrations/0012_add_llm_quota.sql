-- LLM 무료 호출 한도: 가입 순번 기반 평생 한도
--   1~10,000번째 가입자 = 10회, 10,001번째부터 = 5회 (월 초기화 없음)
-- project-spec.md 3번·4-13 참고.

-- 1. 가입 순번용 시퀀스
create sequence if not exists public.users_signup_order_seq;

-- 2. users 테이블에 컬럼 추가 (llm_call_count는 0001에서 이미 있음)
alter table public.users
  add column if not exists signup_order bigint,
  add column if not exists llm_call_limit integer not null default 10;

-- 3. 기존 유저 백필: created_at 순서대로 순번 부여, 한도는 10 (초기 가입자)
do $$
declare
  r record;
begin
  for r in select id from public.users where signup_order is null order by created_at loop
    update public.users
      set signup_order = nextval('public.users_signup_order_seq'),
          llm_call_limit = 10
      where id = r.id;
  end loop;
end $$;

-- 4. 신규 가입 트리거 갱신: 순번 발급 + 한도 자동 세팅
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_order bigint := nextval('public.users_signup_order_seq');
  v_limit int := case when v_order <= 10000 then 10 else 5 end;
begin
  insert into public.users (id, email, auth_provider, signup_order, llm_call_limit)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'provider', 'google'),
    v_order,
    v_limit
  );

  insert into public.slots (user_id, slot_type, start_time, end_time) values
    (new.id, 'morning', '05:00', '11:00'),
    (new.id, 'lunch', '11:00', '15:00'),
    (new.id, 'evening', '15:00', '21:00'),
    (new.id, 'before_sleep', '21:00', '05:00');

  return new;
end;
$$;

-- 5. 남은 LLM 호출 횟수 조회 (앱 표시용)
create or replace function public.get_llm_quota()
returns json
language sql
security definer set search_path = public
as $$
  select json_build_object(
    'limit', llm_call_limit,
    'used', llm_call_count,
    'remaining', greatest(llm_call_limit - llm_call_count, 0)
  )
  from public.users where id = auth.uid();
$$;

-- 6. LLM 호출 1회 소진 (원자적 증가). 한도 초과면 allowed=false 반환
create or replace function public.consume_llm_call()
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_limit int;
  v_remaining int;
begin
  if uid is null then
    return json_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  update public.users
    set llm_call_count = llm_call_count + 1
    where id = uid and llm_call_count < llm_call_limit
    returning llm_call_limit, llm_call_limit - llm_call_count into v_limit, v_remaining;

  if not found then
    select llm_call_limit into v_limit from public.users where id = uid;
    return json_build_object('allowed', false, 'reason', 'quota_exceeded', 'limit', v_limit, 'remaining', 0);
  end if;

  return json_build_object('allowed', true, 'limit', v_limit, 'remaining', v_remaining);
end;
$$;

-- 7. 함수 실행 권한 (로그인 유저)
grant execute on function public.get_llm_quota() to authenticated;
grant execute on function public.consume_llm_call() to authenticated;
