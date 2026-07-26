-- 영상을 삭제할 때, 연결된 루틴이 있어도 삭제를 막지 않고 그 루틴의 영상 연결만 해제되도록 변경
alter table public.routines
  drop constraint routines_video_id_fkey;

alter table public.routines
  add constraint routines_video_id_fkey
  foreign key (video_id) references public.videos(id) on delete set null;
