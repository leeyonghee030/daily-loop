-- 0033(자기전 슬롯 정확한 시간 기본값 추가)가 handle_new_user()를 통째로 재정의하면서,
-- 바로 전 마이그레이션인 0029(가입 시 관리자 기본 영상을 내 그리드로 복사)에서 추가했던
-- "insert into public.videos ... select ... from public.videos where user_id is null" 블록을
-- 빠뜨린 채(0029 이전의 옛 버전을 베이스로 작성된 것으로 보임) 덮어써버렸다. 그 결과
-- 0033 이후 가입한 모든 신규 유저는 "영상" 화면의 기본 영상(카테고리별 1개)이 하나도
-- 안 채워진 채로 시작하게 됐다(2026-10-02, 폰 QA로 발견) — 0033의 슬롯 기본값은 그대로
-- 유지하면서 0029의 영상 복사 블록만 다시 합쳐 넣는다.
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

  insert into public.videos (category_id, title, youtube_url, thumbnail_url, channel_name, channel_url, user_id)
  select category_id, title, youtube_url, thumbnail_url, channel_name, channel_url, new.id
  from public.videos
  where user_id is null;

  return new;
end;
$$;
