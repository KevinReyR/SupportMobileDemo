-- Keep onboarding contracts and their private signature evidence in the contractor folder.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'contractor-documents',
  'contractor-documents',
  false,
  10485760,
  array['application/pdf', 'image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit),
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists app_files_contracts_internal_read
  on public.app_files;
drop policy if exists contractor_contracts_internal_read
  on storage.objects;

drop policy if exists app_files_contract_signatures_internal_read
  on public.app_files;
create policy app_files_contract_signatures_internal_read
on public.app_files
for select to authenticated
using (
  bucket = 'contractor-documents'
  and public.is_active_user()
  and (public.has_role('DIRECTOR') or public.has_role('ADMIN'))
  and exists (
    select 1
    from public.contractor_contract_signatures ccs
    where ccs.signature_file_id = app_files.id
  )
);

drop policy if exists contractor_contract_signature_storage_read
  on storage.objects;
create policy contractor_contract_signature_storage_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'contractor-documents'
  and public.is_active_user()
  and (public.has_role('DIRECTOR') or public.has_role('ADMIN'))
  and exists (
    select 1
    from public.app_files af
    join public.contractor_contract_signatures ccs
      on ccs.signature_file_id = af.id
    where af.provider = 'supabase'
      and af.bucket = storage.objects.bucket_id
      and af.path = storage.objects.name
  )
);

notify pgrst, 'reload schema';
