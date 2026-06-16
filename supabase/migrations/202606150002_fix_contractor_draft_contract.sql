-- Fix contractor draft creation after seeded IDs and non-generated contract IDs.

select setval(
  pg_get_serial_sequence('public.contractor', 'id'),
  greatest(
    coalesce((select max(id) from public.contractor), 0),
    (select last_value from public.contractor_id_seq)
  ),
  true
);

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
    current_date
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
    1,
    current_date,
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
