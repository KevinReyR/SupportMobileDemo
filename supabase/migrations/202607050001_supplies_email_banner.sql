update storage.buckets
set
  public = true,
  allowed_mime_types = array['application/pdf', 'image/png']::text[]
where id = 'supplies';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'supplies',
  'supplies',
  true,
  10485760,
  array['application/pdf', 'image/png']::text[]
where not exists (
  select 1 from storage.buckets where id = 'supplies'
);

notify pgrst, 'reload schema';
