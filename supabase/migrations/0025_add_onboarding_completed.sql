-- 온보딩(테마색/폰트 선택) 완료 여부를 계정당 1회로 만들기 위해 서버에 저장
-- (기존엔 AsyncStorage에만 저장돼서 앱 재설치/기기 변경 시 같은 계정이어도 온보딩이 다시 떴음)
alter table public.users
  add column if not exists onboarding_completed boolean not null default false;
