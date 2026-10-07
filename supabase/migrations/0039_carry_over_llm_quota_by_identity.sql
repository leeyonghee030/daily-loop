-- 회원탈퇴 후 같은 구글/카카오 계정으로 재가입하면 AI 무료 호출 횟수가 매번 10회로 리셋되는
-- 문제 수정(2026-10-07, 사용자 요청) — 지금까지는 한도가 우리 쪽 내부 계정(public.users.id,
-- 가입할 때마다 새로 생기는 uuid)에만 묶여 있어서, 탈퇴로 그 행이 cascade 삭제되면 사용 기록도
-- 같이 사라지고 재가입은 완전히 새 계정 취급돼 10회가 다시 채워지고 있었다.
--
-- 구글/카카오가 주는 영구 식별자(provider + sub, 탈퇴와 무관하게 그 외부 계정 고유의 값)
-- 기준으로 사용량을 별도 테이블에 보존해뒀다가, 가입 시점에 같은 식별자의 기록이 있으면
-- 그 사용량을 그대로 이어받도록 가입 트리거(handle_new_user)에만 로직을 추가한다.
-- 기존 로그인/가입 로직(슬롯 기본값, 기본 영상 복사 등, 0038 기준)은 전혀 건드리지 않고
-- 그대로 유지 — 다른 기능에 영향 없게 "한도 계산 부분"만 바꾼다.
-- sub 정보를 못 찾는 극히 드문 경우(일부 provider 메타데이터 누락 등)에도 가입 자체는
-- 절대 실패하지 않도록, 그 경우엔 기존과 동일하게 "새 계정"으로 처리한다(안전 폴백).

create table if not exists public.identity_llm_usage (
  provider text not null,
  provider_sub text not null,
  signup_order bigint not null,
  llm_call_limit integer not null,
  llm_call_count integer not null default 0,
  first_signed_up_at timestamptz not null default now(),
  primary key (provider, provider_sub)
);

-- 클라이언트가 직접 조회/수정할 일이 없는 내부 전용 테이블 — RLS만 켜두고 정책은 두지 않아서
-- (security definer 함수를 통한 접근만 허용되고) 일반 유저 권한으로는 전혀 안 보이게 한다
alter table public.identity_llm_usage enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'google');
  v_sub text := new.raw_user_meta_data ->> 'sub';
  v_order bigint;
  v_limit int;
  v_count int;
begin
  -- 같은 구글/카카오 계정으로 이전에 가입했다가 탈퇴한 기록이 있으면 그 사용량을 이어받는다
  if v_sub is not null then
    select signup_order, llm_call_limit, llm_call_count
      into v_order, v_limit, v_count
      from public.identity_llm_usage
      where provider = v_provider and provider_sub = v_sub;
  end if;

  -- 처음 보는 계정(또는 sub 정보가 없는 경우)은 기존과 동일하게 새 순번/한도를 발급
  if v_order is null then
    v_order := nextval('public.users_signup_order_seq');
    v_limit := case when v_order <= 10000 then 10 else 5 end;
    v_count := 0;
    if v_sub is not null then
      insert into public.identity_llm_usage (provider, provider_sub, signup_order, llm_call_limit, llm_call_count)
      values (v_provider, v_sub, v_order, v_limit, v_count);
    end if;
  end if;

  insert into public.users (id, email, auth_provider, signup_order, llm_call_limit, llm_call_count)
  values (
    new.id,
    new.email,
    v_provider,
    v_order,
    v_limit,
    v_count
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

-- AI 호출 소진 시, 탈퇴 대비 보존용 사용량(identity_llm_usage)도 같이 1 늘려서 실제 사용
-- 횟수가 어긋나지 않게 한다. 이 동기화가 무슨 이유로든 실패해도(권한 문제 등) 이미 끝난
-- 핵심 동작(실제 호출 소진 처리, 위에서 이미 커밋됨)에는 영향이 없도록 예외를 삼킨다
create or replace function public.consume_llm_call()
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_limit int;
  v_remaining int;
  v_provider text;
  v_sub text;
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

  begin
    select raw_app_meta_data ->> 'provider', raw_user_meta_data ->> 'sub'
      into v_provider, v_sub
      from auth.users where id = uid;
    if v_sub is not null then
      update public.identity_llm_usage
        set llm_call_count = llm_call_count + 1
        where provider = coalesce(v_provider, 'google') and provider_sub = v_sub;
    end if;
  exception when others then
    null;
  end;

  return json_build_object('allowed', true, 'limit', v_limit, 'remaining', v_remaining);
end;
$$;
