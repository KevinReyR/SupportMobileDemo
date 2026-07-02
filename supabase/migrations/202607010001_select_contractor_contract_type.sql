-- Allow Directors to select the pending contractor contract type during document activation.

create or replace function public.activate_pending_contractor_if_ready(
  p_contractor_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  active_status_id bigint;
  current_contract record;
  required_activation_codes text[] := array[
    'CERTIFICADO_ARL',
    'ANTECEDENTES_POLICIA',
    'ANTECEDENTES_PROCURADURIA'
  ];
  completed_activation_documents integer;
begin
  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;

  select latest.id, latest.contract_type
  into current_contract
  from public.contractor_contract latest
  join public.contract_status cs on cs.id = latest.status_id
  where latest.contractor_id = p_contractor_id
    and upper(cs.name) = 'PENDIENTE'
  order by latest.start_date desc nulls last, latest.id desc
  limit 1;

  if current_contract.id is null then
    return false;
  end if;

  if current_contract.contract_type is null then
    return false;
  end if;

  select count(distinct cdt.code)
  into completed_activation_documents
  from public.contractor_documents cd
  join public.contractor_document_types cdt on cdt.id = cd.document_type_id
  where cd.contractor_id = p_contractor_id
    and cdt.code = any(required_activation_codes)
    and cdt.is_active;

  if completed_activation_documents <> array_length(required_activation_codes, 1) then
    return false;
  end if;

  select id into active_status_id
  from public.contract_status
  where upper(name) = 'ACTIVO'
  order by id
  limit 1;

  if active_status_id is null then
    raise exception 'Active contract status is not configured';
  end if;

  update public.contractor_contract cc
  set status_id = active_status_id,
      updated_at = public.colombia_now(),
      observations = coalesce(cc.observations, '') || case
        when coalesce(cc.observations, '') = '' then 'Activado por documentacion completa'
        else E'\nActivado por documentacion completa'
      end
  where cc.id = current_contract.id
    and public.contractor_current_status(p_contractor_id) = 'PENDIENTE';

  if found then
    update public.contractor
    set disponibility = true,
        updated_at = public.colombia_now()
    where id = p_contractor_id;

    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.activate_pending_contractor_if_ready(bigint)
  from public, anon;
grant execute on function public.activate_pending_contractor_if_ready(bigint)
  to authenticated;

create or replace function public.select_contractor_contract_type(
  p_contractor_id bigint,
  p_contract_type_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_contract_id bigint;
begin
  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.contract_type ct
    where ct.id = p_contract_type_id
  ) then
    raise exception 'Tipo de contrato no valido';
  end if;

  select latest.id
  into pending_contract_id
  from public.contractor_contract latest
  join public.contract_status cs on cs.id = latest.status_id
  where latest.contractor_id = p_contractor_id
    and upper(cs.name) = 'PENDIENTE'
  order by latest.start_date desc nulls last, latest.id desc
  limit 1;

  if pending_contract_id is null then
    raise exception 'No hay un contrato pendiente para este contratista';
  end if;

  update public.contractor_contract
  set contract_type = p_contract_type_id,
      updated_at = public.colombia_now()
  where id = pending_contract_id;

  return public.activate_pending_contractor_if_ready(p_contractor_id);
end;
$$;

revoke execute on function public.select_contractor_contract_type(bigint,bigint)
  from public, anon;
grant execute on function public.select_contractor_contract_type(bigint,bigint)
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
  current_status text;
  required_activation_codes text[] := array[
    'CERTIFICADO_ARL',
    'ANTECEDENTES_POLICIA',
    'ANTECEDENTES_PROCURADURIA'
  ];
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
    perform public.activate_pending_contractor_if_ready(p_contractor_id);
  end if;

  return new_document_id;
end;
$$;

revoke execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  from public, anon;
grant execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  to authenticated;

notify pgrst, 'reload schema';
