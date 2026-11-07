create or replace function public.update_contractor_information(
  p_contractor_id bigint,
  p_phone_number text,
  p_email text,
  p_residence_department text,
  p_residence_city text,
  p_neighborhood text,
  p_address text,
  p_pension_fund text,
  p_eps text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_email text;
  normalized_pension_fund text;
  normalized_eps text;
begin
  if auth.uid() is null
    or not public.is_active_user()
    or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;

  if p_phone_number is null or btrim(p_phone_number) !~ '^3[0-9]{9}$' then
    raise exception 'Telefono no valido';
  end if;
  if p_email is null or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Correo no valido';
  end if;
  if nullif(btrim(p_residence_department), '') is null
    or nullif(btrim(p_residence_city), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_pension_fund), '') is null
    or nullif(btrim(p_eps), '') is null then
    raise exception 'Completa telefono, correo, residencia y seguridad social';
  end if;

  select name
  into normalized_pension_fund
  from public.pension_funds
  where name = upper(btrim(p_pension_fund)) and is_active;
  if normalized_pension_fund is null then
    raise exception 'Fondo de pensiones: selecciona una opcion activa del catalogo';
  end if;

  select name
  into normalized_eps
  from public.health_insurers
  where name = upper(btrim(p_eps)) and is_active;
  if normalized_eps is null then
    raise exception 'EPS: selecciona una opcion activa del catalogo';
  end if;

  select email
  into previous_email
  from public.contractor
  where id = p_contractor_id
  for update;
  if not found then
    raise exception 'Contratista no encontrado';
  end if;

  update public.contractor
  set phone_number = btrim(p_phone_number),
      email = lower(btrim(p_email)),
      residence_department = btrim(p_residence_department),
      residence_city = btrim(p_residence_city),
      neighborhood = upper(btrim(p_neighborhood)),
      address = btrim(p_address),
      pension_fund = normalized_pension_fund,
      eps = normalized_eps
  where id = p_contractor_id;

  if lower(btrim(coalesce(previous_email, ''))) is distinct from lower(btrim(p_email)) then
    update public.contractor_onboarding_invites
    set status = 'EXPIRED',
        updated_at = public.colombia_now()
    where contractor_id = p_contractor_id
      and status in ('PENDING', 'DATA_SUBMITTED');
  end if;
end;
$$;

revoke all on function public.update_contractor_information(
  bigint, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.update_contractor_information(
  bigint, text, text, text, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
