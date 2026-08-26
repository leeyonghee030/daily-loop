-- 메모 알림 토글 — 아침 슬롯의 notify_enabled(루틴 알림)와는 독립된 채널.
-- 둘 다 켜져 있고 그날 메모가 있으면 아침 슬롯 시각에 알림 하나로 합쳐서 보낸다.
alter table public.slots add column memo_notify_enabled boolean not null default true;
