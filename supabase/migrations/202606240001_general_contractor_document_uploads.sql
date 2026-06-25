-- Allow internal users to upload general contractor documents and show latest per type.

insert into public.contractor_document_types(code, name) values
  ('PILA', 'PILA')
on conflict (code) do update set
  name = excluded.name,
  is_active = true,
  updated_at = public.colombia_now();

create or replace function public.can_upload_contractor_document_object(
  p_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  contractor_id bigint;
  document_code text;
  current_status text;
begin
  if p_path !~ '^contractor/[0-9]+/[A-Z0-9_]+/[^/]+\.pdf$' then
    return false;
  end if;

  contractor_id := split_part(p_path, '/', 2)::bigint;
  document_code := split_part(p_path, '/', 3);
  current_status := public.contractor_current_status(contractor_id);

  if not exists (
    select 1
    from public.contractor_document_types cdt
    where cdt.code = document_code
      and cdt.is_active
  ) then
    return false;
  end if;

  if current_status in ('ACTIVO', 'INACTIVO') then
    return public.has_role('COORDINATOR') or public.has_role('DIRECTOR');
  end if;

  if document_code = 'CEDULA' then
    return public.has_role('COORDINATOR') or public.has_role('DIRECTOR');
  end if;

  if document_code in ('CERTIFICADO_ARL', 'ANTECEDENTES_POLICIA', 'ANTECEDENTES_PROCURADURIA') then
    return public.has_role('DIRECTOR')
      and current_status = 'PENDIENTE';
  end if;

  return false;
end;
$$;

revoke execute on function public.can_upload_contractor_document_object(text)
  from public, anon;
grant execute on function public.can_upload_contractor_document_object(text)
  to authenticated;

create or replace function public.register_contractor_document(
  p_contractor_id bigint,
  p_document_type_code text,
  p_bucket text,
  p_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  document_type_id bigint;
  new_file_id uuid;
  new_document_id uuid;
  active_status_id bigint;
  current_status text;
  required_activation_codes text[] := array[
    'CERTIFICADO_ARL',
    'ANTECEDENTES_POLICIA',
    'ANTECEDENTES_PROCURADURIA'
  ];
  completed_activation_documents integer;
begin
  normalized_code := upper(trim(p_document_type_code));
  current_status := public.contractor_current_status(p_contractor_id);

  select id into document_type_id
  from public.contractor_document_types
  where code = normalized_code
    and is_active
  limit 1;

  if document_type_id is null then
    raise exception 'Contractor document type is not configured';
  end if;

  if p_bucket <> 'contractor-documents'
    or p_mime_type <> 'application/pdf'
    or p_size_bytes is null
    or p_size_bytes <= 0
    or p_size_bytes > 1048576
    or p_path !~ ('^contractor/' || p_contractor_id || '/' || normalized_code || '/[^/]+\.pdf$') then
    raise exception 'Invalid contractor document file';
  end if;

  if not exists (
    select 1
    from storage.objects so
    where so.bucket_id = p_bucket
      and so.name = p_path
  ) then
    raise exception 'Uploaded file was not found';
  end if;

  if current_status in ('ACTIVO', 'INACTIVO') then
    if not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
      raise exception 'Not authorized';
    end if;
  elsif normalized_code = 'CEDULA' then
    if not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
      raise exception 'Not authorized';
    end if;
  elsif normalized_code = any(required_activation_codes) then
    if not (public.has_role('DIRECTOR') and current_status = 'PENDIENTE') then
      raise exception 'Not authorized';
    end if;
  else
    raise exception 'Document type is not allowed in this flow';
  end if;

  insert into public.app_files(
    provider,
    bucket,
    path,
    original_name,
    mime_type,
    size_bytes,
    created_by,
    updated_by
  )
  values (
    'supabase',
    p_bucket,
    p_path,
    nullif(trim(p_original_name), ''),
    p_mime_type,
    p_size_bytes,
    auth.uid(),
    auth.uid()
  )
  on conflict (provider, bucket, path) do update
  set original_name = excluded.original_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      updated_by = auth.uid(),
      updated_at = public.colombia_now()
  returning id into new_file_id;

  insert into public.contractor_documents(
    contractor_id,
    document_type_id,
    file_id
  )
  values (
    p_contractor_id,
    document_type_id,
    new_file_id
  )
  on conflict (file_id) do update
  set document_type_id = excluded.document_type_id,
      updated_at = public.colombia_now()
  returning id into new_document_id;

  if current_status = 'PENDIENTE'
    and normalized_code = any(required_activation_codes) then
    select count(distinct cdt.code)
    into completed_activation_documents
    from public.contractor_documents cd
    join public.contractor_document_types cdt on cdt.id = cd.document_type_id
    where cd.contractor_id = p_contractor_id
      and cdt.code = any(required_activation_codes)
      and cdt.is_active;

    if completed_activation_documents = array_length(required_activation_codes, 1) then
      select id into active_status_id
      from public.contract_status
      where upper(name) = 'ACTIVO'
      order by id
      limit 1;

      update public.contractor_contract cc
      set status_id = active_status_id,
          updated_at = public.colombia_now(),
          observations = coalesce(cc.observations, '') || case
            when coalesce(cc.observations, '') = '' then 'Activado por documentación completa'
            else E'\nActivado por documentación completa'
          end
      where cc.id = (
        select latest.id
        from public.contractor_contract latest
        where latest.contractor_id = p_contractor_id
        order by latest.start_date desc nulls last, latest.id desc
        limit 1
      )
        and public.contractor_current_status(p_contractor_id) = 'PENDIENTE';

      update public.contractor
      set disponibility = true,
          updated_at = public.colombia_now()
      where id = p_contractor_id;
    end if;
  end if;

  return new_document_id;
end;
$$;

revoke execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  from public, anon;
grant execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  to authenticated;

create or replace function public.get_contractor_documents(
  p_contractor_id bigint
)
returns table (
  document_id uuid,
  document_type_code text,
  document_type_name text,
  file_id uuid,
  provider text,
  bucket text,
  path text,
  original_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with latest_by_type as (
    select distinct on (cd.document_type_id)
      cd.id as document_id,
      cdt.code as document_type_code,
      cdt.name as document_type_name,
      af.id as file_id,
      af.provider,
      af.bucket,
      af.path,
      af.original_name,
      af.mime_type,
      af.size_bytes,
      cd.created_at,
      greatest(cd.updated_at, af.updated_at) as updated_at
    from public.contractor_documents cd
    join public.contractor_document_types cdt on cdt.id = cd.document_type_id
    join public.app_files af on af.id = cd.file_id
    where cd.contractor_id = p_contractor_id
      and cdt.is_active
      and af.provider = 'supabase'
      and public.can_access_contractor_documents(p_contractor_id)
    order by cd.document_type_id, greatest(cd.updated_at, af.updated_at) desc, cd.created_at desc, cd.id desc
  )
  select
    document_id,
    document_type_code,
    document_type_name,
    file_id,
    provider,
    bucket,
    path,
    original_name,
    mime_type,
    size_bytes,
    created_at,
    updated_at
  from latest_by_type
  order by document_type_name, updated_at desc, document_id;
$$;

revoke execute on function public.get_contractor_documents(bigint)
  from public, anon;
grant execute on function public.get_contractor_documents(bigint)
  to authenticated;

notify pgrst, 'reload schema';
