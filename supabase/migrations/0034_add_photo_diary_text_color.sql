-- 사진일기 "루틴 고르기" 모드에서 루틴/메모 글자색을 검정/흰색/주색 중 고를 수 있게 함
alter table public.photo_diaries
  add column if not exists text_color_mode text not null default 'black'
  check (text_color_mode in ('black', 'white', 'accent'));
