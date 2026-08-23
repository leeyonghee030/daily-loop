-- 루틴에 메모(자유 텍스트)와 사진 첨부 기능 추가
alter table routines add column memo text;
alter table routines add column photo_url text;

-- 사진 저장용 스토리지 버킷 (공개 읽기, 본인 폴더에만 쓰기 가능)
insert into storage.buckets (id, name, public)
values ('routine-photos', 'routine-photos', true)
on conflict (id) do nothing;

create policy "routine photos: owner can insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'routine-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "routine photos: owner can update"
on storage.objects for update
to authenticated
using (bucket_id = 'routine-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "routine photos: owner can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'routine-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "routine photos: public read"
on storage.objects for select
to public
using (bucket_id = 'routine-photos');
