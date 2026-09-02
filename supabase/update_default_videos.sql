-- 기본 카테고리 추천 영상 교체 (2026-09-02) — 모닝루틴/뷰티
-- 관리자 공용 영상(user_id is null)만 대상으로 함. 이미 "내 그리드에 추가"로 각자 복사해간 개인 영상(user_id 있음)은 안 건드림
-- Supabase 대시보드의 SQL Editor에서 실행할 것 (RLS가 본인 영상만 수정 가능하게 막아둬서 앱 로그인 상태로는 실행 불가)

update public.videos
set
  title = '[시즌2] 500만이 인정한 밀라논나의 New! 아침 루틴 ☀️',
  youtube_url = 'https://www.youtube.com/watch?v=wwaWcQIZ3Cg',
  thumbnail_url = 'https://i.ytimg.com/vi/wwaWcQIZ3Cg/hqdefault.jpg',
  channel_name = '밀라논나 Milanonna',
  channel_url = 'https://www.youtube.com/channel/UCXXlcPH1stsP3VwYG90s4wg'
where category_id = 4 and user_id is null;

update public.videos
set
  title = '따라하면 무조건 피부 좋아지는 한혜진 관리법 (주름,탄력,꿀팁,스킨케어루틴)',
  youtube_url = 'https://www.youtube.com/watch?v=ntsiwrBkRHs',
  thumbnail_url = 'https://i.ytimg.com/vi/ntsiwrBkRHs/hqdefault.jpg',
  channel_name = '한혜진 Han Hye Jin',
  channel_url = 'https://www.youtube.com/channel/UCkvh3vrWsoi_cd7HyiikzIQ'
where category_id = 2 and user_id is null;
