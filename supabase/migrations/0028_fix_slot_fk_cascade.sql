-- 회원탈퇴 시 auth.users -> public.users -> slots까지는 on delete cascade로 잘 지워지는데,
-- slots를 참조하는 routines/preset_items/routine_favorites의 slot_id 외래키에
-- on delete cascade가 빠져 있어서 "슬롯이 아직 참조되고 있다"는 FK 위반으로 삭제가 막히던 문제.
-- 슬롯은 유저당 4개 고정(아침/점심/저녁/자기전)이라 개별 삭제 기능이 없고, 슬롯이 지워지는
-- 유일한 경로는 계정 전체 삭제뿐이라 slot_id를 가진 행도 함께 지워지는 게 맞다.

alter table public.routines drop constraint routines_slot_id_fkey;
alter table public.routines add constraint routines_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete cascade;

alter table public.preset_items drop constraint preset_items_slot_id_fkey;
alter table public.preset_items add constraint preset_items_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete cascade;

alter table public.routine_favorites drop constraint routine_favorites_slot_id_fkey;
alter table public.routine_favorites add constraint routine_favorites_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete cascade;
