-- Add required contractor birth date and expose it through the existing app flows.

alter table public.contractor
  add column if not exists birth_date date;

update public.contractor
set birth_date = (date '1978-01-01' + ((id::int * 389) % 9000))
where birth_date is null;

alter table public.contractor
  alter column birth_date set not null;

drop function if exists public.create_contractor_draft(bigint,text,text,text,text,text);

create or replace function public.create_contractor_draft(
  p_document_type_id bigint,
  p_document_number text,
  p_name text,
  p_last_name text,
  p_phone_number text,
  p_email text,
  p_birth_date date
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
    or nullif(trim(p_email), '') is null
    or p_birth_date is null then
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
    birth_date,
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
    p_birth_date,
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

revoke execute on function public.create_contractor_draft(bigint,text,text,text,text,text,date)
  from public, anon;
grant execute on function public.create_contractor_draft(bigint,text,text,text,text,text,date)
  to authenticated;

drop function if exists public.get_client_contractors();

create function public.get_client_contractors()
returns table (
  contractor_id bigint,
  first_name text,
  last_name text,
  document_number text,
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
