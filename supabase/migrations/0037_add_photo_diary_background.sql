-- 사진일기 캔버스 배경(색상 또는 사진 + 투명도) 지원
alter table photo_diaries
  add column if not exists background_type text not null default 'none'
    check (background_type in ('none', 'color', 'photo')),
  add column if not exists background_color text,
  add column if not exists background_photo_url text,
  add column if not exists background_opacity numeric not null default 1
    check (background_opacity >= 0 and background_opacity <= 1),
  -- 배경 사진 중 어느 부분을 보여줄지(원본 이미지 기준 0~1 정규화 사각형) — cropW:cropH는
  -- 항상 캔버스 가로세로 비율과 같게 저장된다(app/photo-diary-form.tsx 참고). 없으면
  -- resizeMode="cover" 기본 동작(항상 캔버스 중앙 기준으로 꽉 채움)
  add column if not exists background_crop_x numeric,
  add column if not exists background_crop_y numeric,
  add column if not exists background_crop_w numeric,
  add column if not exists background_crop_h numeric;
