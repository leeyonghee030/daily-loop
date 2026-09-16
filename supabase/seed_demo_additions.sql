-- 스토어 스크린샷 보강용 — 기존 데이터는 그대로 두고(삭제 없음) 추가만 한다
-- ① 루틴 3개 더 추가(지금 4개 + 이 3개 = 7개 정도) ② 모음집(프리셋) 2개 샘플(미적용, 목록만)
-- ③ 캘린더용 컬러 메모 3개 ④ AI(LLM) 무료 호출 한도를 10/10으로 리셋
-- 대상 계정: leeyonghee030@gmail.com

do $$
declare
  v_user_id uuid;
  v_slot_morning uuid;
  v_slot_evening uuid;
  v_slot_sleep uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_routine_id uuid;
  v_preset_id uuid;
  d date;
  i int;
begin
  select id into v_user_id from auth.users where email = 'leeyonghee030@gmail.com';
  if v_user_id is null then
    raise exception '해당 이메일의 유저를 찾을 수 없습니다';
  end if;

  select id into v_slot_morning from public.slots where user_id = v_user_id and slot_type = 'morning';
  select id into v_slot_evening from public.slots where user_id = v_user_id and slot_type = 'evening';
  select id into v_slot_sleep from public.slots where user_id = v_user_id and slot_type = 'before_sleep';

  -- 루틴 1) 산책 20분 — 트래킹(분), 슬롯(저녁), 매일, 12일 연속(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, tracking_unit, sort_order, created_at)
  values
    (v_user_id, '산책 20분', 'tracking', 'daily', v_slot_evening, '분', 100, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 12, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date, tracking_value) values (v_routine_id, d, 20);
  end loop;

  -- 루틴 2) 감사일기 쓰기 — 체크, 슬롯(자기전), 매일, 필수, 6일 연속(오늘은 미완료)
  insert into public.routines
    (user_id, title, block_type, repeat_type, slot_id, is_required, sort_order, created_at)
  values
    (v_user_id, '감사일기 쓰기', 'check', 'daily', v_slot_sleep, true, 101, now() - interval '30 days')
  returning id into v_routine_id;
  for d in select generate_series(v_today - 6, v_today - 1, interval '1 day')::date loop
    insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
  end loop;

  -- 루틴 3) 물건 정리하기 — 체크, 시각 체크(아침 8시), 평일, 최근 10 평일 중 1일만 빠짐(현실감)
  insert into public.routines
    (user_id, title, block_type, repeat_type, scheduled_time_start, scheduled_time_end, is_instant, sort_order, created_at)
  values
    (v_user_id, '물건 정리하기', 'check', 'weekday', '08:00', '08:00', true, 102, now() - interval '30 days')
  returning id into v_routine_id;
  d := v_today - 1;
  for i in 1..10 loop
    while extract(isodow from d) in (6, 7) loop
      d := d - 1;
    end loop;
    if i <> 4 then
      insert into public.routine_completions (routine_id, completed_date) values (v_routine_id, d);
    end if;
    d := d - 1;
  end loop;

  -- 모음집(프리셋) 샘플 2개 — 적용(실제 루틴 생성)은 안 하고 "모음집" 목록 화면용으로만 만든다
  insert into public.routine_presets (user_id, name, repeat_type, skip_holidays)
  values (v_user_id, '평일 아침 루틴', 'weekday', false)
  returning id into v_preset_id;
  insert into public.preset_items (preset_id, title, block_type, scheduled_time_start, scheduled_time_end, sort_order)
  values
    (v_preset_id, '기상 스트레칭', 'check', '07:00', '07:10', 0),
    (v_preset_id, '아침 식사', 'check', '07:30', '08:00', 1);
  insert into public.preset_items (preset_id, title, block_type, slot_id, tracking_unit, sort_order)
  values (v_preset_id, '물 마시기', 'tracking', v_slot_morning, '잔', 2);

  insert into public.routine_presets (user_id, name, repeat_type, skip_holidays)
  values (v_user_id, '주말 루틴', 'weekend', false)
  returning id into v_preset_id;
  insert into public.preset_items (preset_id, title, block_type, slot_id, sort_order)
  values
    (v_preset_id, '집 청소', 'check', v_slot_morning, 0),
    (v_preset_id, '한 주 계획 세우기', 'check', v_slot_evening, 1);

  -- 캘린더용 컬러 메모 3개(최근 며칠) — 월/주간뷰에 색 점이 보이도록
  insert into public.date_memos (user_id, memo_date, content, color)
  values
    (v_user_id, v_today - 2, '컨디션 좋음 👍', 'mint'),
    (v_user_id, v_today - 5, '친구랑 저녁 약속', 'yellow'),
    (v_user_id, v_today - 8, '루틴 다시 세팅', 'blue');

  -- AI(LLM) 무료 호출 한도 10/10으로 리셋(스크린샷용)
  update public.users set llm_call_limit = 10, llm_call_count = 0 where id = v_user_id;

end $$;
