-- Weli-Link Market — private product image bucket
-- Run this in the Supabase SQL Editor after selecting the correct project.
-- The application uses its Fastify backend as the trusted storage gateway
-- because the current app authentication is a local JWT, not Supabase Auth.
-- Do not create a browser upload with the secret server key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep RLS enabled. No anon/authenticated write policy is granted: uploads,
-- replacement and deletion are authorized by the Fastify route after it checks
-- the producerId in the application database. The server key is server-only.
alter table storage.objects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Weli backend can manage product images'
  ) then
    create policy "Weli backend can manage product images"
      on storage.objects
      for all
      to service_role
      using (bucket_id = 'product-images')
      with check (bucket_id = 'product-images');
  end if;
end
$$;
