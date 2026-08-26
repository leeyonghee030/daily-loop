-- 기본 카테고리도 유저가 "삭제"할 수 있게 함. 기본 카테고리는 모든 유저가 공유하는 행이라
-- 진짜로 지우면 다른 유저에게도 영향이 가므로, 유저별로 숨김 처리하는 방식으로 구현한다.
-- 삭제 시 그 안에 내가 직접 추가한 영상은 즉시 지워지고(복구 불가), 저희가 기본 제공하는
-- 추천 카탈로그 영상은 "기본 카테고리 생성" 버튼으로 다시 보이게 하면 자동으로 다시 채워진다.
create table public.hidden_default_categories (
  user_id uuid not null references public.users(id) on delete cascade,
  category_id smallint not null references public.categories(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table public.hidden_default_categories enable row level security;

create policy "본인 것만 조회/수정" on public.hidden_default_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
