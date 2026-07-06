drop policy if exists app_files_profile_photos_read on public.app_files;
create policy app_files_profile_photos_read
on public.app_files
for select to authenticated
using (
  bucket = 'contractor-profile-photos'
  and exists (
    select 1
    from public.contractor c
    where c.profile_photo_file_id = app_files.id
      and (
        public.has_role('COORDINATOR')
        or public.has_role('DIRECTOR')
        or public.has_role('ADMIN')
        or exists (
          select 1
          from public.operation_assignment oa
          join public.operation o on o.id = oa.operation_id
          where oa.contractor_id = c.id
            and oa.deleted_at is null
            and public.has_client_access(o.client_id)
        )
      )
  )
);

drop policy if exists contractor_profile_photos_internal_read on storage.objects;
drop policy if exists contractor_profile_photos_authorized_read on storage.objects;
create policy contractor_profile_photos_authorized_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'contractor-profile-photos'
  and exists (
    select 1
    from public.app_files af
    join public.contractor c on c.profile_photo_file_id = af.id
    where af.provider = 'supabase'
      and af.bucket = storage.objects.bucket_id
      and af.path = storage.objects.name
      and (
        public.has_role('COORDINATOR')
        or public.has_role('DIRECTOR')
        or public.has_role('ADMIN')
        or exists (
          select 1
          from public.operation_assignment oa
          join public.operation o on o.id = oa.operation_id
          where oa.contractor_id = c.id
            and oa.deleted_at is null
            and public.has_client_access(o.client_id)
        )
      )
  )
);

notify pgrst, 'reload schema';

drop function if exists public.get_client_contractors();
create function public.get_client_contractors()
returns table (
  contractor_id bigint,
  first_name text,
  last_name text,
  document_number text,
  profile_photo_file_id uuid,
  birth_date date,
  rh text,
  civil_state text,
  eps text,
  arl text,
  last_area text,
  last_operation_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (c.id)
    c.id,
    c.name::text,
    c.last_name::text,
    c.document_number::text,
    c.profile_photo_file_id,
    c.birth_date,
    c.rh::text,
    cst.name::text,
    c.eps::text,
    c.arl::text,
    a.name::text,
    o.operation_date
  from public.contractor c
  join public.operation_assignment oa on oa.contractor_id = c.id
  join public.operation o on o.id = oa.operation_id
  join public.area a on a.id = o.area_id
  left join public.civil_state_type cst on cst.id = c.civil_state_id
  where public.has_role('CLIENT')
    and public.has_client_access(o.client_id)
    and oa.deleted_at is null
  order by c.id, o.operation_date desc, oa.id desc;
$$;

revoke execute on function public.get_client_contractors() from public, anon;
grant execute on function public.get_client_contractors() to authenticated;

notify pgrst, 'reload schema';
