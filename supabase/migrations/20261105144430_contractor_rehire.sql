alter table public.contractor_documents add column contractor_contract_id bigint references public.contractor_contract(id);
alter table public.contractor_onboarding_invites add column contractor_contract_id bigint references public.contractor_contract(id);

-- Preserve existing pending activations without assigning historical files to future contracts.
update public.contractor_documents d set contractor_contract_id = (
  select c.id from public.contractor_contract c join public.contract_status s on s.id=c.status_id
  where c.contractor_id=d.contractor_id and upper(s.name)='PENDIENTE'
  order by c.start_date desc,c.id desc limit 1
);
update public.contractor_onboarding_invites i set contractor_contract_id = coalesce(
  (select s.contractor_contract_id from public.contractor_contract_signatures s where s.invite_id=i.id),
  (select c.id from public.contractor_contract c where c.contractor_id=i.contractor_id and c.start_date <= i.created_at::date order by c.start_date desc,c.id desc limit 1)
);
create function public.bind_contractor_document_contract() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if new.contractor_contract_id is null then
    select c.id into new.contractor_contract_id from public.contractor_contract c
    where c.contractor_id=new.contractor_id and c.start_date<=public.colombia_today()
    order by c.start_date desc,c.id desc limit 1;
  end if;
  if not exists (select 1 from public.contractor_contract c where c.id=new.contractor_contract_id and c.contractor_id=new.contractor_id) then
    raise exception 'Contrato no valido para el documento';
  end if;
  return new;
end; $$;
create trigger bind_contractor_document_contract before insert on public.contractor_documents
for each row execute function public.bind_contractor_document_contract();

create or replace function public.rehire_contractor(
  p_contractor_id bigint, p_phone_number text, p_email text,
  p_residence_department text, p_residence_city text, p_neighborhood text,
  p_address text, p_pension_fund text, p_eps text
) returns bigint language plpgsql security definer
set search_path = public, pg_temp as $$
declare new_id bigint; pending_id bigint; type_id bigint;
begin
  if auth.uid() is null or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;
  perform 1 from public.contractor where id = p_contractor_id for update;
  if not found then raise exception 'Contratista no encontrado'; end if;
  if public.contractor_current_status(p_contractor_id) <> 'INACTIVO' or exists (
    select 1 from public.contractor_contract cc join public.contract_status s on s.id = cc.status_id
    where cc.contractor_id = p_contractor_id and upper(s.name) in ('PENDIENTE','PROGRAMADO')
  ) then raise exception 'El contratista ya tiene un contrato vigente o pendiente'; end if;
  if p_phone_number is null or btrim(p_phone_number) !~ '^3[0-9]{9}$' then raise exception 'Telefono no valido'; end if;
  if p_email is null or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo no valido'; end if;
  perform public.complete_contractor_registration_details(p_contractor_id,p_residence_department,p_residence_city,p_neighborhood,p_address,p_pension_fund,p_eps);
  select id into strict pending_id from public.contract_status where upper(name) = 'PENDIENTE';
  select id into strict type_id from public.contract_type where upper(name) = 'SOLO ARL';
  insert into public.contractor_contract(contractor_id,contract_type,start_date,status_id,observations)
  values(p_contractor_id,type_id,public.colombia_today(),pending_id,'Recontratacion desde app') returning id into new_id;
  update public.contractor set phone_number=btrim(p_phone_number),email=lower(btrim(p_email)),
    termination_date=null,hire_date=public.colombia_today(),disponibility=false where id=p_contractor_id;
  update public.contractor_onboarding_invites set status='EXPIRED'
    where contractor_id=p_contractor_id and status in ('PENDING','DATA_SUBMITTED');
  return new_id;
end;
$$;
revoke all on function public.rehire_contractor(bigint,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.rehire_contractor(bigint,text,text,text,text,text,text,text,text) to authenticated;
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
    and cd.contractor_contract_id = current_contract.id
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

