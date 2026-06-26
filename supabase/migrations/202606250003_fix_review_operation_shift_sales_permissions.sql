-- Allow review_operation to materialize shift sales without exposing operation_assignment directly.

create or replace function public.review_operation(
  p_operation_id bigint,
  p_decision varchar,
  p_observations text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_operation record;
  extra_hour_sale_price numeric;
begin
  if not public.has_role('DIRECTOR') then
    raise exception 'Not authorized';
  end if;
  if p_decision not in ('CERRADO', 'CAMBIOS_SOLICITADOS') then
    raise exception 'Invalid decision';
  end if;
  if p_decision = 'CAMBIOS_SOLICITADOS' and nullif(trim(p_observations), '') is null then
    raise exception 'Review observations are required';
  end if;

  select o.id, o.operation_date, o.area_id
  into target_operation
  from public.operation o
  where o.id = p_operation_id
    and o.status = 'PENDIENTE'
  for update;

  if target_operation.id is null then
    raise exception 'Pending operation not found';
  end if;

  if p_decision = 'CERRADO' then
    select sale_price
    into extra_hour_sale_price
    from public.current_area_extra_hour_rate(target_operation.area_id, target_operation.operation_date);

    if extra_hour_sale_price is null then
      raise exception 'La tarifa de hora extra del area no esta configurada';
    end if;

    insert into public.shift_sales(
      sale_at,
      operation_id,
      operation_assignment_id,
      contractor_id,
      client_service_id,
      worked_quantity,
      extra_hours,
      unit_shift_sale_price,
      unit_extra_hour_sale_price,
      total_sale,
      created_by
    )
    select
      public.colombia_now(),
      oa.operation_id,
      oa.id,
      oa.contractor_id,
      oa.client_service_id,
      coalesce(oa.worked_quantity, 1),
      coalesce(oa.extra_hours, 0),
      coalesce(oa.unit_sale_price, 0),
      extra_hour_sale_price,
      (coalesce(oa.worked_quantity, 1) * coalesce(oa.unit_sale_price, 0))
        + (coalesce(oa.extra_hours, 0) * extra_hour_sale_price),
      auth.uid()
    from public.operation_assignment oa
    where oa.operation_id = p_operation_id
      and oa.deleted_at is null
    on conflict (operation_assignment_id) do update set
      sale_at = excluded.sale_at,
      operation_id = excluded.operation_id,
      contractor_id = excluded.contractor_id,
      client_service_id = excluded.client_service_id,
      worked_quantity = excluded.worked_quantity,
      extra_hours = excluded.extra_hours,
      unit_shift_sale_price = excluded.unit_shift_sale_price,
      unit_extra_hour_sale_price = excluded.unit_extra_hour_sale_price,
      total_sale = excluded.total_sale,
      created_by = excluded.created_by,
      updated_at = public.colombia_now();
  end if;

  update public.operation
  set status = p_decision,
      review_observations = nullif(trim(p_observations), ''),
      verify_by = auth.uid(),
      verify_at = public.colombia_now(),
      closed_by = case when p_decision = 'CERRADO' then auth.uid() else null end,
      closed_at = case when p_decision = 'CERRADO' then public.colombia_now() else null end
  where id = p_operation_id
    and status = 'PENDIENTE';

  if not found then
    raise exception 'Pending operation not found';
  end if;
end;
$$;

revoke execute on function public.review_operation(bigint,varchar,text)
  from public, anon;
grant execute on function public.review_operation(bigint,varchar,text)
  to authenticated;

notify pgrst, 'reload schema';
