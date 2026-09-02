-- 기본 카테고리(운동/뷰티/독서/모닝루틴/마인드풀니스/공부/자기계발) 초기 콘텐츠 1개씩 시드 (2026-09-02)
-- user_id를 비워둬야 관리자 공용 영상(모든 유저의 "추천 영상" 탭에 노출)으로 취급됨
-- RLS가 본인 영상(auth.uid() = user_id)만 추가하도록 막아뒀어서 앱 로그인 상태로는 실행 불가 —
-- 반드시 Supabase 대시보드의 SQL Editor(서비스 권한)에서 실행할 것. 이미 넣은 것과 겹치면 건너뛰어서 재실행해도 안전함

insert into public.videos (category_id, title, youtube_url, thumbnail_url, channel_name, channel_url)
select v.category_id, v.title, v.youtube_url, v.thumbnail_url, v.channel_name, v.channel_url
from (values
  (1, '하루 한 번! 기초체력 기르는 20분 유산소 운동👑 (2025)', 'https://www.youtube.com/watch?v=sCNLSplatoA', 'https://i.ytimg.com/vi/sCNLSplatoA/hqdefault.jpg', '빵느', 'https://www.youtube.com/channel/UCRrZ5RYIalHLiHq5ftzxM6A'),
  (2, '이 한 편이면 끝! 알려주기 아까운 스킨케어 루틴 공개합니다!ㅣ집에서 홈케어만으로 피부 좋아지는 방법', 'https://www.youtube.com/watch?v=0VkrVRvWCe8', 'https://i.ytimg.com/vi/0VkrVRvWCe8/hqdefault.jpg', '일타의사 박영진', 'https://www.youtube.com/channel/UCK7v-eIsfif6b-Df8jJ343Q'),
  (3, '초보도 금세 읽는 책 추천📚 l 유명한만큼 좋았던 책 /유명한데 별로였던 책 /여운 오래가는 책', 'https://www.youtube.com/watch?v=45NYWrCtLRU', 'https://i.ytimg.com/vi/45NYWrCtLRU/hqdefault.jpg', '피글로그 Pigle''s Vlog', 'https://www.youtube.com/channel/UCwdZgECLGRyHszZemaxgXJA'),
  (4, '조금만 투자하면 인생이 바뀌는 아침일상? 아침루틴 BEST 3 ! 맑은기운, 몸 준비, 중심을 잡아라', 'https://www.youtube.com/watch?v=CIilqziUgvY', 'https://i.ytimg.com/vi/CIilqziUgvY/hqdefault.jpg', '김교수의 세 가지', 'https://www.youtube.com/channel/UCswZ-im6-XORrZatRoUvPYA'),
  (5, '누워서 하는 10분 명상 | 호흡명상, 마음챙김 명상 가이드', 'https://www.youtube.com/watch?v=inxAScz0PTM', 'https://i.ytimg.com/vi/inxAScz0PTM/hqdefault.jpg', '에일린 mind yoga', 'https://www.youtube.com/channel/UCKmEDAD5k5KFMcY5wvGIeGQ'),
  (6, '올해 최고의 공부자극 영상 (동기부여)', 'https://www.youtube.com/watch?v=p8300mqnSI0', 'https://i.ytimg.com/vi/p8300mqnSI0/hqdefault.jpg', '공부의신 강성태', 'https://www.youtube.com/channel/UCsLgKKiv8kDDGy1stC8BxVA')
) as v(category_id, title, youtube_url, thumbnail_url, channel_name, channel_url)
where not exists (
  select 1 from public.videos existing
  where existing.category_id = v.category_id and existing.youtube_url = v.youtube_url
);
