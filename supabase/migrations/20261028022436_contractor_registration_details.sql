create function public.create_contractor_draft_with_details(
  p_document_type_id bigint,
  p_document_number text,
  p_name text,
  p_last_name text,
  p_phone_number text,
  p_email text,
  p_birth_date date,
  p_residence_department text,
  p_residence_city text,
  p_neighborhood text,
  p_address text,
  p_pension_fund text,
  p_eps text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_contractor_id bigint;
begin
  if (select auth.uid()) is null
    or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;

  if nullif(btrim(p_residence_department), '') is null
    or nullif(btrim(p_residence_city), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_pension_fund), '') is null
    or nullif(btrim(p_eps), '') is null then
    raise exception 'Completa departamento, ciudad, barrio, direccion, fondo de pensiones y EPS';
  end if;

  new_contractor_id := public.create_contractor_draft(
    p_document_type_id, p_document_number, p_name, p_last_name,
    p_phone_number, p_email, p_birth_date
  );

  update public.contractor
  set residence_department = btrim(p_residence_department),
      residence_city = btrim(p_residence_city),
      neighborhood = btrim(p_neighborhood),
      address = btrim(p_address),
      pension_fund = btrim(p_pension_fund),
      eps = btrim(p_eps)
  where id = new_contractor_id;

  return new_contractor_id;
end;
$$;

revoke all on function public.create_contractor_draft_with_details(bigint,text,text,text,text,text,date,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_contractor_draft_with_details(bigint,text,text,text,text,text,date,text,text,text,text,text,text) to authenticated;

create function public.complete_contractor_registration_details(
  p_contractor_id bigint,
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
begin
  if (select auth.uid()) is null
    or not (public.has_role('COORDINATOR') or public.has_role('DIRECTOR')) then
    raise exception 'No autorizado';
  end if;

  if nullif(btrim(p_residence_department), '') is null
    or nullif(btrim(p_residence_city), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_pension_fund), '') is null
    or nullif(btrim(p_eps), '') is null then
    raise exception 'Completa departamento, ciudad, barrio, direccion, fondo de pensiones y EPS';
  end if;

  update public.contractor
  set residence_department = btrim(p_residence_department),
      residence_city = btrim(p_residence_city),
      neighborhood = btrim(p_neighborhood),
      address = btrim(p_address),
      pension_fund = btrim(p_pension_fund),
      eps = btrim(p_eps)
  where id = p_contractor_id;

  if not found then
    raise exception 'Contratista no encontrado';
  end if;
end;
$$;

revoke all on function public.complete_contractor_registration_details(bigint,text,text,text,text,text,text) from public, anon;
grant execute on function public.complete_contractor_registration_details(bigint,text,text,text,text,text,text) to authenticated;
