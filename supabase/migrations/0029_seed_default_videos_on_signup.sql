-- 신규 가입 시 "내 영상" 그리드가 항상 비어있어서, 카테고리를 지웠다가 "기본 카테고리 생성"으로
-- 되살렸을 때만(recreateDefaultCategories) 추천 카탈로그 영상이 채워지는 것과 앞뒤가 안 맞았음.
-- 가입 시점에도 관리자 기본 영상(user_id is null)을 내 그리드로 복사해 처음부터 채워준다.
-- 기존 가입자는 건드리지 않음 — 이 마이그레이션 이후 새로 가입하는 유저부터만 적용됨.
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

  insert into public.videos (category_id, title, youtube_url, thumbnail_url, channel_name, channel_url, user_id)
  select category_id, title, youtube_url, thumbnail_url, channel_name, channel_url, new.id
  from public.videos
  where user_id is null;

  return new;
end;
$$;
