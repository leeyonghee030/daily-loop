-- 신규 가입자 기본 슬롯 시각을 "체크형"에 어울리는 값으로 변경: 기존엔 05~11시대처럼 넓은
-- 범위였는데, 0023에서 슬롯 기본이 체크형(is_instant=true)으로 바뀌었으니 그 체크 시각도
-- 아침 7시/점심 12시/저녁 18시/자기전 22시처럼 실제로 체크할 법한 시각으로 맞춘다.
-- end_time도 나중에 "정확한 시간"으로 바꿀 때 쓸 1시간 범위로 같이 채워둔다.
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
    (new.id, 'before_sleep', '22:00', '23:00', true);

  return new;
end;
$$;
