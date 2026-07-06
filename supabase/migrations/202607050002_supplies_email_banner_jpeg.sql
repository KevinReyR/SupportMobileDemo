update storage.buckets
set
  public = true,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg']::text[]
where id = 'supplies';

notify pgrst, 'reload schema';
