-- 사진일기 모드에 'routines_memo'(루틴을 메모 형식으로 불러오기) 추가
alter table photo_diaries drop constraint photo_diaries_mode_check;
alter table photo_diaries
  add constraint photo_diaries_mode_check check (mode in ('text', 'routines', 'routines_memo'));
