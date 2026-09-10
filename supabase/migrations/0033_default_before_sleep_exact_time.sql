-- 신규 가입자 기본 슬롯 4개가 전부 체크형이면 "정확한 시간" 모드가 있다는 걸 처음부터
-- 보여줄 방법이 없었음. "자기전" 슬롯만 정확한 시간(is_instant=false)으로 기본 설정해서,
-- 처음 시간대 설정 화면을 열었을 때 체크형 3개+정확한 시간 1개가 같이 보이게 한다.
-- 기존 가입자의 슬롯은 손대지 않음 — 이 마이그레이션 이후 새로 가입하는 유저부터만 적용됨.
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

  insert into public.slots (user_id, slot_type, start_time, end_time, is_instant) values
    (new.id, 'morning', '07:00', '08:00', true),
    (new.id, 'lunch', '12:00', '13:00', true),
    (new.id, 'evening', '18:00', '19:00', true),
    (new.id, 'before_sleep', '22:00', '23:00', false);

  return new;
end;
$$;
