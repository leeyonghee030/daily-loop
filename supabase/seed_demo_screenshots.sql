-- 스토어 스크린샷용 데모 데이터 시딩 스크립트
-- 대상 계정(leeyonghee030@gmail.com)의 기존 루틴/기록/일기/메모/개인영상/커스텀카테고리를
-- 전부 지우고, 화면이 예쁘게 나오도록 설계된 샘플 루틴 7개 + 완료기록을 새로 채운다.
-- (계정 자체나 슬롯 설정, 관리자 기본 영상/카테고리는 건드리지 않음)

do $$
declare
  v_user_id uuid;
  v_slot_morning uuid;
  v_slot_lunch uuid;
  v_slot_evening uuid;
  v_slot_sleep uuid;
  v_today date := current_date;
  v_routine_id uuid;
  d date;
  i int;
  cnt int;
begin
  select id into v_user_id from auth.users where email = 'leeyonghee030@gmail.com';
  if v_user_id is null then
    raise exception '해당 이메일의 유저를 찾을 수 없습니다';
  end if;

  select id into v_slot_morning from public.slots where user_id = v_user_id and slot_type = 'morning';
  select id into v_slot_lunch from public.slots where user_id = v_user_id and slot_type = 'lunch';
  select id into v_slot_evening from public.slots where user_id = v_user_id and slot_type = 'evening';
  select id into v_slot_sleep from public.slots where user_id = v_user_id and slot_type = 'before_sleep';

  -- 기존 데이터 정리 (완료기록/건너뛴날짜는 routines cascade로 함께 삭제됨)
  delete from public.routines where user_id = v_user_id;
  delete from public.routine_presets where user_id = v_user_id;
  delete from public.routine_favorites where user_id = v_user_id;
  delete from public.diaries where user_id = v_user_id;
  delete from public.date_memos where user_id = v_user_id;
  delete from public.videos where user_id = v_user_id;
  delete from public.categories where user_id = v_user_id;
  delete from public.hidden_default_categories where user_id = v_user_id;

  -- 1) 미라클모닝 기상 — 시각 체크(is_instant), 필수, 최근 3일 완료(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, is_instant, is_required, sort_order, created_at)
  values
    (v_user_id, '미라클모닝 기상', 'check', 'daily', '06:30', '06:30', true, true, 0, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 3, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
  end loop;

  -- 2) 아침 스트레칭 — 정확한 시각, 필수, 평일만, 최근 14 평일 연속 완료(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, is_required, sort_order, created_at)
  values
    (v_user_id, '아침 스트레칭', 'check', 'weekday', '07:00', '07:15', true, 1, now() - interval '30 days')
  returning id into v_routine_id;
  d := v_today - 1;
  for i in 1..14 loop
    while extract(isodow from d) in (6, 7) loop
      d := d - 1;
    end loop;
    insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
    d := d - 1;
  end loop;

  -- 3) 물 마시기 — 트래킹(잔), 슬롯(아침), 매일, 21일 연속(오늘은 미완료 → 입력창 노출)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, tracking_unit, sort_order, created_at)
  values
    (v_user_id, '물 마시기', 'tracking', 'daily', v_slot_morning, '잔', 2, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 21, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date, tracking_value) values (v_routine_id, d, 8);
  end loop;

  -- 4) 영양제 챙기기 — 체크, 슬롯(점심), 평일, 최근 15 평일 중 2번만 빠짐(현실감)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, sort_order, created_at)
  values
    (v_user_id, '영양제 챙기기', 'check', 'weekday', v_slot_lunch, 3, now() - interval '30 days')
  returning id into v_routine_id;
  d := v_today - 1;
  for i in 1..15 loop
    while extract(isodow from d) in (6, 7) loop
      d := d - 1;
    end loop;
    if i not in (5, 11) then
      insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
    end if;
    d := d - 1;
  end loop;

  -- 5) 독서 30분 — 트래킹(분), 슬롯(저녁), 매일, 9일 연속(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, tracking_unit, sort_order, created_at)
  values
    (v_user_id, '독서 30분', 'tracking', 'daily', v_slot_evening, '분', 4, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 9, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date, tracking_value) values (v_routine_id, d, 30);
  end loop;

  -- 6) 저녁 러닝 — 체크, 정확한 시각, 월수금만, 최근 4회 완료
  insert into public.routines
    (user_id, title, block_type, repeat_type, repeat_days, scheduled_time_start, scheduled_time_end, sort_order, created_at)
  values
    (v_user_id, '저녁 러닝', 'check', 'custom', array[1,3,5]::smallint[], '19:00', '19:30', 5, now() - interval '30 days')
  returning id into v_routine_id;
  d := v_today - 1;
  cnt := 0;
  while cnt < 4 loop
    if extract(isodow from d) in (1, 3, 5) then
      insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
      cnt := cnt + 1;
    end if;
    d := d - 1;
  end loop;

  -- 7) 일기 쓰기 — 체크, 슬롯(자기전), 매일, 필수, 7일 연속(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, is_required, sort_order, created_at)
  values
    (v_user_id, '일기 쓰기', 'check', 'daily', v_slot_sleep, true, 6, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 7, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
  end loop;

  -- 8) "내 영상" 그리드 — 카테고리 6개에 1개씩만 채워서 "사용자가 직접 추가한" 느낌으로
  -- (관리자 기본 영상과 같은 콘텐츠지만 user_id를 채워 내 그리드용 개인 사본으로 넣음)
  insert into public.videos (user_id, category_id, title, youtube_url, thumbnail_url, channel_name, channel_url)
  select v_user_id, v.category_id, v.title, v.youtube_url, v.thumbnail_url, v.channel_name, v.channel_url
  from (values
    (1, '하루 한 번! 기초체력 기르는 20분 유산소 운동👑 (2025)', 'https://www.youtube.com/watch?v=sCNLSplatoA', 'https://i.ytimg.com/vi/sCNLSplatoA/hqdefault.jpg', '빵느', 'https://www.youtube.com/channel/UCRrZ5RYIalHLiHq5ftzxM6A'),
    (2, '따라하면 무조건 피부 좋아지는 한혜진 관리법 (주름,탄력,꿀팁,스킨케어루틴)', 'https://www.youtube.com/watch?v=ntsiwrBkRHs', 'https://i.ytimg.com/vi/ntsiwrBkRHs/hqdefault.jpg', '한혜진 Han Hye Jin', 'https://www.youtube.com/channel/UCkvh3vrWsoi_cd7HyiikzIQ'),
    (3, '초보도 금세 읽는 책 추천📚 l 유명한만큼 좋았던 책 /유명한데 별로였던 책 /여운 오래가는 책', 'https://www.youtube.com/watch?v=45NYWrCtLRU', 'https://i.ytimg.com/vi/45NYWrCtLRU/hqdefault.jpg', '피글로그 Pigle''s Vlog', 'https://www.youtube.com/channel/UCwdZgECLGRyHszZemaxgXJA'),
    (4, '[시즌2] 500만이 인정한 밀라논나의 New! 아침 루틴 ☀️', 'https://www.youtube.com/watch?v=wwaWcQIZ3Cg', 'https://i.ytimg.com/vi/wwaWcQIZ3Cg/hqdefault.jpg', '밀라논나 Milanonna', 'https://www.youtube.com/channel/UCXXlcPH1stsP3VwYG90s4wg'),
    (5, '누워서 하는 10분 명상 | 호흡명상, 마음챙김 명상 가이드', 'https://www.youtube.com/watch?v=inxAScz0PTM', 'https://i.ytimg.com/vi/inxAScz0PTM/hqdefault.jpg', '에일린 mind yoga', 'https://www.youtube.com/channel/UCKmEDAD5k5KFMcY5wvGIeGQ'),
    (6, '올해 최고의 공부자극 영상 (동기부여)', 'https://www.youtube.com/watch?v=p8300mqnSI0', 'https://i.ytimg.com/vi/p8300mqnSI0/hqdefault.jpg', '공부의신 강성태', 'https://www.youtube.com/channel/UCsLgKKiv8kDDGy1stC8BxVA')
  ) as v(category_id, title, youtube_url, thumbnail_url, channel_name, channel_url);

end $$;
