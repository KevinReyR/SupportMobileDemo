-- Allow Directors to resolve signed contract storage objects while keeping the type hidden from manual uploads.

drop policy if exists contractor_document_types_read
  on public.contractor_document_types;
create policy contractor_document_types_read
on public.contractor_document_types
for select to authenticated
using (
  public.is_active_user()
  and is_active
  and (
    code <> 'CONTRATO_FIRMADO'
    or public.has_role('DIRECTOR')
  )
);

notify pgrst, 'reload schema';
