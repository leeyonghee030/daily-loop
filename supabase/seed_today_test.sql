-- 오늘 탭 UI 테스트용 더미 루틴 (3단계 개발 확인용, 필요 없어지면 지워도 됨)
-- Supabase 대시보드 > SQL Editor 에서 실행

-- 1) 시각 지정(범위) + 일반형(체크) + 필수
insert into public.routines (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, is_required, sort_order)
select id, '아침 물 8잔 마시기', 'check', 'daily', '07:00', '07:30', true, 0
from public.users where email = 'leeyonghee030@gmail.com';

-- 2) 슬롯(아침) 지정 + 일반형(체크)
insert into public.routines (user_id, title, block_type, repeat_type, slot_id, sort_order)
select u.id, '스트레칭', 'check', 'daily', s.id, 0
from public.users u
join public.slots s on s.user_id = u.id and s.slot_type = 'morning'
where u.email = 'leeyonghee030@gmail.com';

-- 3) 슬롯(저녁) 지정 + 트래킹형
insert into public.routines (user_id, title, block_type, repeat_type, slot_id, tracking_unit, sort_order)
select u.id, '책 읽기', 'tracking', 'daily', s.id, '페이지', 0
from public.users u
join public.slots s on s.user_id = u.id and s.slot_type = 'evening'
where u.email = 'leeyonghee030@gmail.com';

-- 4) 시각 지정(범위) + 트래킹형
insert into public.routines (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, tracking_unit, sort_order)
select id, '물 마시기', 'tracking', 'daily', '10:30', '11:00', '잔', 0
from public.users where email = 'leeyonghee030@gmail.com';

-- 5) 1회성 + 오늘 날짜 + 시각 범위
insert into public.routines (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, scheduled_date, sort_order)
select id, '병원 예약 확인', 'check', 'once', '14:00', '14:30', current_date, 0
from public.users where email = 'leeyonghee030@gmail.com';
