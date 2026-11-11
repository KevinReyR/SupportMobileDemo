-- Always bind new contractor documents to the contract that represents the
-- contractor's current state. This matters when an inactive contract and a new
-- pending rehire contract share the same start date but their ids are not
-- chronological.
create or replace function public.bind_contractor_document_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_status text;
begin
  if new.contractor_contract_id is null then
    current_status := public.contractor_current_status(new.contractor_id);

    select contract.id
    into new.contractor_contract_id
    from public.contractor_contract contract
    join public.contract_status status on status.id = contract.status_id
    where contract.contractor_id = new.contractor_id
      and contract.start_date <= public.colombia_today()
      and (
        (current_status = 'PENDIENTE' and upper(status.name) = 'PENDIENTE')
        or (
          current_status = 'ACTIVO'
          and (
            upper(status.name) = 'ACTIVO'
            or (
              upper(status.name) = 'PROGRAMADO'
              and exists (
                select 1
                from public.contractor_contract_transitions transition
                where transition.new_contract_id = contract.id
                  and transition.status = 'SCHEDULED'
              )
            )
          )
        )
        or (current_status = 'INACTIVO' and upper(status.name) = 'INACTIVO')
      )
    order by contract.start_date desc nulls last,
      contract.created_at desc,
      contract.id desc
    limit 1;
  end if;

  if new.contractor_contract_id is null
    or not exists (
      select 1
      from public.contractor_contract contract
      where contract.id = new.contractor_contract_id
        and contract.contractor_id = new.contractor_id
    ) then
    raise exception 'Contrato no valido para el documento';
  end if;

  return new;
end;
$$;

-- Give the application the same authoritative contract resolution used by the
-- document trigger. The role check prevents exposing another contractor's
-- contract through a privileged function.
create or replace function public.get_current_contractor_contract_id(
  p_contractor_id bigint
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  current_contract_id bigint;
begin
  if auth.uid() is null
    or not public.is_active_user()
    or not (
      public.has_role('COORDINATOR')
      or public.has_role('DIRECTOR')
      or public.has_role('ADMIN')
    ) then
    raise exception 'No autorizado';
  end if;

  current_status := public.contractor_current_status(p_contractor_id);

  select contract.id
  into current_contract_id
  from public.contractor_contract contract
  join public.contract_status status on status.id = contract.status_id
  where contract.contractor_id = p_contractor_id
    and contract.start_date <= public.colombia_today()
    and (
      (current_status = 'PENDIENTE' and upper(status.name) = 'PENDIENTE')
      or (
        current_status = 'ACTIVO'
        and (
          upper(status.name) = 'ACTIVO'
          or (
            upper(status.name) = 'PROGRAMADO'
            and exists (
              select 1
              from public.contractor_contract_transitions transition
              where transition.new_contract_id = contract.id
                and transition.status = 'SCHEDULED'
            )
          )
        )
      )
      or (current_status = 'INACTIVO' and upper(status.name) = 'INACTIVO')
    )
  order by contract.start_date desc nulls last,
    contract.created_at desc,
    contract.id desc
  limit 1;

  return current_contract_id;
end;
$$;

revoke all on function public.get_current_contractor_contract_id(bigint)
  from public, anon;
grant execute on function public.get_current_contractor_contract_id(bigint)
  to authenticated;

-- Repair only activation documents uploaded after a rehire contract was
-- created. Historical files from the previous contract remain untouched.
with pending_contracts as (
  select distinct on (contract.contractor_id)
    contract.contractor_id,
    contract.id,
    contract.created_at
  from public.contractor_contract contract
  join public.contract_status status on status.id = contract.status_id
  where upper(status.name) = 'PENDIENTE'
  order by contract.contractor_id,
    contract.start_date desc nulls last,
    contract.created_at desc,
    contract.id desc
), recoverable_documents as (
  select document.id, pending.id as pending_contract_id
  from public.contractor_documents document
  join public.contractor_document_types type on type.id = document.document_type_id
  join pending_contracts pending on pending.contractor_id = document.contractor_id
  where type.code in (
    'CERTIFICADO_ARL',
    'ANTECEDENTES_POLICIA',
    'ANTECEDENTES_PROCURADURIA'
  )
    and document.created_at >= pending.created_at
    and document.contractor_contract_id is distinct from pending.id
)
update public.contractor_documents document
set contractor_contract_id = recoverable.pending_contract_id,
    updated_at = public.colombia_now()
from recoverable_documents recoverable
where document.id = recoverable.id;

notify pgrst, 'reload schema';
