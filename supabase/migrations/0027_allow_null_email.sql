-- 카카오 로그인은 계정에 이메일이 없거나 동의를 안 하면 이메일 없이 로그인될 수 있음
-- (Supabase의 "Allow users without an email" 옵션과 짝을 이루는 변경).
-- public.users.email이 not null이면 이런 경우 회원가입 트리거(handle_new_user)가
-- insert 시점에 제약 위반으로 실패해서 가입 자체가 막힌다 — nullable로 풀어준다.
-- unique 제약은 유지해도 문제없음(Postgres는 null끼리는 서로 다른 값으로 취급해 중복 허용).
alter table public.users alter column email drop not null;
