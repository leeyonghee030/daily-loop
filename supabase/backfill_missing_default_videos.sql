-- 2026-10-02: 0033가 0029의 영상 시딩을 덮어써버린 버그(0038로 수정) 때문에, 그 사이에
-- 가입해서 기본 영상이 하나도 없는 계정들을 한 번만 채워준다. "영상을 하나도 안 가진 유저"만
-- 대상이라 여러 번 실행해도 안전함(이미 있는 유저는 다시 안 채움).
insert into public.videos (category_id, title, youtube_url, thumbnail_url, channel_name, channel_url, user_id)
select v.category_id, v.title, v.youtube_url, v.thumbnail_url, v.channel_name, v.channel_url, u.id
from public.users u
cross join (select * from public.videos where user_id is null) v
where not exists (select 1 from public.videos existing where existing.user_id = u.id);
