-- Normalize business dates to Colombia while keeping audit timestamps as timestamptz.

create or replace function public.colombia_now()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

create or replace function public.colombia_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = public.colombia_now();
  return new;
end;
$$;

alter table public.operation
  alter column updated_at set default public.colombia_now();

alter table public.personnel_request
  alter column created_at set default public.colombia_now(),
  alter column updated_at set default public.colombia_now();

alter table public.contractor_document_types
  alter column created_at set default public.colombia_now(),
  alter column updated_at set default public.colombia_now();

alter table public.app_files
  alter column created_at set default public.colombia_now(),
  alter column updated_at set default public.colombia_now();

alter table public.contractor_documents
  alter column created_at set default public.colombia_now(),
  alter column updated_at set default public.colombia_now();

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
  solo_arl_contract_type_id bigint;
  normalized_document text;
begin
  if not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'Not authorized';
  end if;

  normalized_document := trim(p_document_number);

  if nullif(normalized_document, '') is null
    or nullif(trim(p_name), '') is null
    or nullif(trim(p_last_name), '') is null
    or nullif(trim(p_phone_number), '') is null
    or nullif(trim(p_email), '') is null then
    raise exception 'Required contractor fields are missing';
  end if;

  if trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Invalid email format';
  end if;

  if exists (
    select 1
    from public.contractor c
    where c.document_number = normalized_document
  ) then
    raise exception 'Ya existe un contratista con ese documento';
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

  select id into solo_arl_contract_type_id
  from public.contract_type
  where upper(name) = 'SOLO ARL'
  order by id
  limit 1;

  if solo_arl_contract_type_id is null then
    raise exception 'SOLO ARL contract type is not configured';
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
    normalized_document,
    trim(p_phone_number),
    lower(trim(p_email)),
    false,
    public.colombia_today()
  )
  returning id into new_contractor_id;

  insert into public.contractor_contract(
    id,
    contractor_id,
    contract_type,
    start_date,
    status_id,
    observations
  )
  values (
    new_contractor_id,
    new_contractor_id,
    solo_arl_contract_type_id,
    public.colombia_today(),
    pending_status_id,
    'Creado desde app movil'
  );

  return new_contractor_id;
end;
$$;

revoke execute on function public.create_contractor_draft(bigint,text,text,text,text,text)
  from public, anon;
grant execute on function public.create_contractor_draft(bigint,text,text,text,text,text)
  to authenticated;

notify pgrst, 'reload schema';
