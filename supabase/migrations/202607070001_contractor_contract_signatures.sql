-- Contractor onboarding contract signature.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]::text[],
    file_size_limit = greatest(coalesce(file_size_limit, 0), 10485760)
where id = 'supplies';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'contractor-contracts',
    'contractor-contracts',
    false,
    10485760,
    array['application/pdf', 'image/png']::text[]
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.contractor_onboarding_invites
  drop constraint if exists contractor_onboarding_invites_status_check;

alter table public.contractor_onboarding_invites
  add constraint contractor_onboarding_invites_status_check
  check (status in ('PENDING', 'DATA_SUBMITTED', 'SUBMITTED', 'EXPIRED'));

create table if not exists public.contractor_contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contractor_id bigint not null references public.contractor(id) on delete cascade,
  contractor_contract_id bigint references public.contractor_contract(id) on delete set null,
  invite_id uuid not null references public.contractor_onboarding_invites(id) on delete cascade,
  unsigned_contract_file_id uuid references public.app_files(id),
  signature_file_id uuid references public.app_files(id),
  signed_contract_file_id uuid references public.app_files(id),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SIGNED', 'CANCELLED')),
  signed_at timestamp without time zone,
  ip_address text,
  browser text,
  operating_system text,
  user_agent text,
  device_fingerprint text,
  location_latitude numeric,
  location_longitude numeric,
  location_accuracy numeric,
  evidence jsonb not null default '{}'::jsonb,
  acceptance_text text not null default 'El firmante declaró haber leído, entendido y aceptado el contenido del documento antes de firmar',
  created_at timestamp without time zone not null default public.colombia_now(),
  updated_at timestamp without time zone not null default public.colombia_now(),
  constraint contractor_contract_signatures_invite_key unique (invite_id)
);

create index if not exists contractor_contract_signatures_contractor_idx
  on public.contractor_contract_signatures(contractor_id);
create index if not exists contractor_contract_signatures_contract_idx
  on public.contractor_contract_signatures(contractor_contract_id);

drop trigger if exists contractor_contract_signatures_set_updated_at
  on public.contractor_contract_signatures;
create trigger contractor_contract_signatures_set_updated_at
before update on public.contractor_contract_signatures
for each row execute function public.set_updated_at();

alter table public.contractor_contract_signatures enable row level security;

drop policy if exists contractor_contract_signatures_internal_read
  on public.contractor_contract_signatures;
create policy contractor_contract_signatures_internal_read
on public.contractor_contract_signatures
for select to authenticated
using (public.has_role('DIRECTOR') or public.has_role('ADMIN'));

drop policy if exists app_files_contracts_internal_read on public.app_files;
create policy app_files_contracts_internal_read
on public.app_files
for select to authenticated
using (
  bucket = 'contractor-contracts'
  and (
    public.has_role('DIRECTOR')
    or public.has_role('ADMIN')
  )
);

drop policy if exists contractor_contracts_internal_read on storage.objects;
create policy contractor_contracts_internal_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'contractor-contracts'
  and (
    public.has_role('DIRECTOR')
    or public.has_role('ADMIN')
  )
);

grant select on public.contractor_contract_signatures to authenticated;

notify pgrst, 'reload schema';
