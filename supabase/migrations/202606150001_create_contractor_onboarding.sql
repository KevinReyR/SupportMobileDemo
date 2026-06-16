-- Contractor onboarding: draft creation, PDF registration, and active-contract enforcement.

insert into public.contract_status(id, name, description)
values (3, 'PENDIENTE', 'Contrato pendiente por validacion documental')
on conflict (id) do update
set name = excluded.name,
    description = excluded.description;

update storage.buckets
set file_size_limit = 1048576,
    allowed_mime_types = array['application/pdf']::text[],
    public = false
where id = 'contractor-documents';

create or replace function public.contractor_current_status(
  p_contractor_id bigint
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(cs.name)
  from public.contractor_contract cc
  join public.contract_status cs on cs.id = cc.status_id
  where cc.contractor_id = p_contractor_id
  order by cc.start_date desc nulls last, cc.id desc
  limit 1;
$$;

create or replace function public.contractor_has_active_contract(
  p_contractor_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.contractor_current_status(p_contractor_id), '') = 'ACTIVO';
$$;

revoke execute on function public.contractor_current_status(bigint) from public, anon;
revoke execute on function public.contractor_has_active_contract(bigint) from public, anon;
grant execute on function public.contractor_current_status(bigint) to authenticated;
grant execute on function public.contractor_has_active_contract(bigint) to authenticated;

create or replace function public.create_contractor_draft(
  p_document_type_id bigint,
  p_document_number text,
  p_name text,
  p_last_name text,
  p_phone_number text,
  p_email text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_contractor_id bigint;
  pending_status_id bigint;
begin
  if not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'Not authorized';
  end if;

  if nullif(trim(p_document_number), '') is null
    or nullif(trim(p_name), '') is null
    or nullif(trim(p_last_name), '') is null
    or nullif(trim(p_phone_number), '') is null
    or nullif(trim(p_email), '') is null then
    raise exception 'Required contractor fields are missing';
  end if;

  if trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Invalid email format';
  end if;

  if not exists (
    select 1 from public.document_type dt where dt.id = p_document_type_id
  ) then
    raise exception 'Invalid document type';
  end if;

  select id into pending_status_id
  from public.contract_status
  where upper(name) = 'PENDIENTE'
  order by id
  limit 1;

  if pending_status_id is null then
    raise exception 'Pending contract status is not configured';
  end if;

  insert into public.contractor(
    name,
    last_name,
    document_type_id,
    document_number,
    phone_number,
    email,
    disponibility,
    hire_date
  )
  values (
    trim(p_name),
    trim(p_last_name),
    p_document_type_id,
    trim(p_document_number),
    trim(p_phone_number),
    lower(trim(p_email)),
    false,
    current_date
  )
  returning id into new_contractor_id;

  insert into public.contractor_contract(
    contractor_id,
    contract_type,
    start_date,
    status_id,
    observations
  )
  values (
    new_contractor_id,
    1,
    current_date,
    pending_status_id,
    'Creado desde app movil'
  );

  return new_contractor_id;
exception
  when unique_violation then
    raise exception 'Ya existe un contratista con ese documento';
end;
$$;

revoke execute on function public.create_contractor_draft(bigint,text,text,text,text,text)
  from public, anon;
grant execute on function public.create_contractor_draft(bigint,text,text,text,text,text)
  to authenticated;

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
begin
  if p_path !~ '^contractor/[0-9]+/(CEDULA|CERTIFICADO_ARL)/[^/]+\.pdf$' then
    return false;
  end if;

  contractor_id := split_part(p_path, '/', 2)::bigint;
  document_code := split_part(p_path, '/', 3);

  if document_code = 'CEDULA' then
    return public.has_role('COORDINATOR') or public.has_role('DIRECTOR');
  end if;

  if document_code = 'CERTIFICADO_ARL' then
    return public.has_role('DIRECTOR')
      and public.contractor_current_status(contractor_id) = 'PENDIENTE';
  end if;

  return false;
end;
$$;

revoke execute on function public.can_upload_contractor_document_object(text)
  from public, anon;
grant execute on function public.can_upload_contractor_document_object(text)
  to authenticated;

drop policy if exists contractor_documents_storage_insert
  on storage.objects;
create policy contractor_documents_storage_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'contractor-documents'
  and public.can_upload_contractor_document_object(name)
);

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
begin
  normalized_code := upper(trim(p_document_type_code));

  if normalized_code not in ('CEDULA', 'CERTIFICADO_ARL') then
    raise exception 'Document type is not allowed in this flow';
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

  if normalized_code = 'CEDULA'
    and not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'Not authorized';
  end if;

  if normalized_code = 'CERTIFICADO_ARL'
    and not (
      public.has_role('DIRECTOR')
      and public.contractor_current_status(p_contractor_id) = 'PENDIENTE'
    ) then
    raise exception 'Not authorized';
  end if;

  select id into document_type_id
  from public.contractor_document_types
  where code = normalized_code
    and is_active
  limit 1;

  if document_type_id is null then
    raise exception 'Contractor document type is not configured';
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
      updated_at = now()
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
      updated_at = now()
  returning id into new_document_id;

  if normalized_code = 'CERTIFICADO_ARL' then
    select id into active_status_id
    from public.contract_status
    where upper(name) = 'ACTIVO'
    order by id
    limit 1;

    update public.contractor_contract cc
    set status_id = active_status_id,
        updated_at = now(),
        observations = coalesce(cc.observations, '') || case
          when coalesce(cc.observations, '') = '' then 'Activado por Certificado ARL'
          else E'\nActivado por Certificado ARL'
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
        updated_at = now()
    where id = p_contractor_id;
  end if;

  return new_document_id;
end;
$$;

revoke execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  from public, anon;
grant execute on function public.register_contractor_document(bigint,text,text,text,text,text,bigint)
  to authenticated;

create or replace function public.get_available_contractors_for_operation(
  p_operation_id bigint
)
returns table(contractor_id bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from public.contractor c
  join public.operation target on target.id = p_operation_id
  where public.has_role('COORDINATOR')
    and public.has_client_access(target.client_id)
    and target.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.contractor_has_active_contract(c.id)
    and not exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = c.id
        and oa.deleted_at is null
        and o.operation_date = target.operation_date
        and o.id <> target.id
    )
  order by c.name, c.last_name;
$$;

revoke execute on function public.get_available_contractors_for_operation(bigint) from public, anon;
grant execute on function public.get_available_contractors_for_operation(bigint) to authenticated;

create or replace function public.create_operation_with_assignments(
  p_operation_date date,
  p_client_id bigint,
  p_area_id bigint,
  p_assignments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_operation_id bigint;
  item jsonb;
  selected_contractor_id bigint;
begin
  if not public.has_role('COORDINATOR') or not public.has_client_access(p_client_id) then
    raise exception 'Not authorized';
  end if;

  for item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_contractor_id = (item ->> 'contractor_id')::bigint;

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception 'Contractor is not active';
    end if;

    if exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = selected_contractor_id
        and oa.deleted_at is null
        and o.operation_date = p_operation_date
    ) then
      raise exception 'Contractor % is already assigned to another operation on this date',
        selected_contractor_id;
    end if;
  end loop;

  insert into public.operation(operation_date, client_id, area_id, created_by, status)
  values (p_operation_date, p_client_id, p_area_id, auth.uid(), 'EN_CURSO')
  returning id into new_operation_id;

  insert into public.operation_assignment(
    operation_id, contractor_id, client_service_id, planned_quantity, planned_by
  )
  select
    new_operation_id,
    (item ->> 'contractor_id')::bigint,
    (item ->> 'client_service_id')::bigint,
    coalesce((item ->> 'planned_quantity')::numeric, 1),
    auth.uid()
  from jsonb_array_elements(p_assignments) item;

  return new_operation_id;
end;
$$;

revoke execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb) from public, anon;
grant execute on function public.create_operation_with_assignments(date,bigint,bigint,jsonb) to authenticated;

create or replace function public.finalize_operation(
  p_operation_id bigint,
  p_assignments jsonb,
  p_observations text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  target_date date;
  target_area_id bigint;
  selected_service_id bigint;
  selected_contractor_id bigint;
  selected_assignment_id bigint;
begin
  select o.operation_date, o.area_id
  into target_date, target_area_id
  from public.operation o
  where o.id = p_operation_id
    and o.status in ('EN_CURSO', 'CAMBIOS_SOLICITADOS')
    and public.has_role('COORDINATOR')
    and public.has_client_access(o.client_id)
  for update;

  if target_date is null then
    raise exception 'Operation cannot be finalized';
  end if;

  select cs.id
  into selected_service_id
  from public.client_services cs
  where cs.area_id = target_area_id
  order by cs.id
  limit 1;

  if selected_service_id is null then
    raise exception 'Operation service is not configured';
  end if;

  for item in select * from jsonb_array_elements(p_assignments)
  loop
    selected_assignment_id = nullif(item ->> 'assignment_id', '')::bigint;
    selected_contractor_id = (item ->> 'contractor_id')::bigint;

    if not public.contractor_has_active_contract(selected_contractor_id) then
      raise exception 'Contractor is not active';
    end if;

    if exists (
      select 1
      from public.operation_assignment oa
      join public.operation o on o.id = oa.operation_id
      where oa.contractor_id = selected_contractor_id
        and oa.deleted_at is null
        and o.operation_date = target_date
        and o.id <> p_operation_id
    ) then
      raise exception 'Contractor % is already assigned to another operation on this date',
        selected_contractor_id;
    end if;

    if selected_assignment_id is null then
      insert into public.operation_assignment(
        operation_id,
        contractor_id,
        client_service_id,
        planned_quantity,
        worked_quantity,
        attendance_status_id,
        extra_hours,
        observations,
        planned_by
      )
      values (
        p_operation_id,
        selected_contractor_id,
        selected_service_id,
        1,
        coalesce((item ->> 'worked_quantity')::numeric, 0),
        (item ->> 'attendance_status_id')::bigint,
        coalesce((item ->> 'extra_hours')::numeric, 0),
        nullif(item ->> 'observations', ''),
        auth.uid()
      );
    else
      update public.operation_assignment
      set attendance_status_id = (item ->> 'attendance_status_id')::bigint,
          worked_quantity = coalesce((item ->> 'worked_quantity')::numeric, 0),
          extra_hours = coalesce((item ->> 'extra_hours')::numeric, 0),
          observations = nullif(item ->> 'observations', ''),
          updated_at = now()
      where id = selected_assignment_id
        and contractor_id = selected_contractor_id
        and operation_id = p_operation_id;

      if not found then
        raise exception 'Invalid operation assignment';
      end if;
    end if;
  end loop;

  update public.operation
  set status = 'PENDIENTE',
      observations = p_observations,
      review_observations = null,
      verify_by = null,
      verify_at = null
  where id = p_operation_id;
end;
$$;

revoke execute on function public.finalize_operation(bigint,jsonb,text) from public, anon;
grant execute on function public.finalize_operation(bigint,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
