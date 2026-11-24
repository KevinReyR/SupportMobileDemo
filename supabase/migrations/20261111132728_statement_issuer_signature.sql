alter table public.statement_issuer
  add column manager_name text check (manager_name is null or length(btrim(manager_name)) between 1 and 160),
  add column signature_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('statement-signatures', 'statement-signatures', false, 524288, array['image/png', 'image/jpeg']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy statement_signatures_admin_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'statement-signatures' and public.is_active_user() and public.has_role('ADMIN')
);
create policy statement_signatures_staff_read on storage.objects
for select to authenticated using (
  bucket_id = 'statement-signatures' and public.is_active_user()
  and (public.has_role('ADMIN') or public.has_role('DIRECTOR'))
);

create function public.save_statement_settings_v2(
  p_legal_name text, p_nit text, p_manager_name text, p_signature_path text,
  p_client_id bigint, p_city text, p_next_number bigint
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.statement_require_role('ADMIN');
  if nullif(btrim(p_manager_name),'') is null or length(btrim(p_manager_name))>160 then
    raise exception 'Indica el nombre del gerente emisor';
  end if;
  if p_signature_path is not null and (
    p_signature_path not like 'manager/%' or
    not exists (select 1 from storage.objects where bucket_id='statement-signatures' and name=p_signature_path)
  ) then raise exception 'Firma del gerente no válida'; end if;
  perform public.save_statement_settings(p_legal_name,p_nit,p_client_id,p_city,p_next_number);
  update public.statement_issuer set manager_name=btrim(p_manager_name),signature_path=p_signature_path,
    updated_by=auth.uid(),updated_at=now() where id=true;
end $$;

revoke all on function public.save_statement_settings_v2(text,text,text,text,bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.save_statement_settings_v2(text,text,text,text,bigint,text,bigint) to authenticated;
notify pgrst,'reload schema';
