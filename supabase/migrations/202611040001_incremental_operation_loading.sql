create index if not exists operation_history_cursor_idx
  on public.operation(operation_date desc, id desc);

create index if not exists operation_status_history_idx
  on public.operation(status, operation_date desc, id desc);

create or replace function public.get_contractor_last_operations(
  p_contractor_ids bigint[] default null
)
returns table (
  contractor_id bigint,
  last_client text,
  last_area text,
  last_operation_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (assignment.contractor_id)
    assignment.contractor_id,
    client.name::text as last_client,
    area.name::text as last_area,
    operation.operation_date as last_operation_date
  from public.operation_assignment assignment
  join public.operation operation on operation.id = assignment.operation_id
  join public.clients client on client.id = operation.client_id
  join public.area area on area.id = operation.area_id
  where public.is_active_user()
    and (
      public.has_role('ADMIN')
      or public.has_role('DIRECTOR')
      or (
        public.has_role('COORDINATOR')
        and public.has_client_access(operation.client_id)
      )
    )
    and assignment.deleted_at is null
    and (p_contractor_ids is null or assignment.contractor_id = any(p_contractor_ids))
  order by
    assignment.contractor_id,
    operation.operation_date desc,
    operation.id desc,
    assignment.id desc;
$$;

revoke all on function public.get_contractor_last_operations(bigint[]) from public, anon;
grant execute on function public.get_contractor_last_operations(bigint[]) to authenticated;

notify pgrst, 'reload schema';
