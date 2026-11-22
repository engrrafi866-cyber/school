-- Separate backend for the school-management repository.
-- The browser receives only the Supabase publishable key; RLS protects every row.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.schools (
  id uuid primary key,
  name text not null,
  motto text not null default '',
  session text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.schools (id, name, motto, session, phone, email, address)
values (
  '10000000-0000-4000-8000-000000000001',
  'আলোকিত প্রাথমিক বিদ্যালয়',
  'জ্ঞান, শৃঙ্খলা ও মানবিকতার আলোয়',
  '২০২৬ শিক্ষাবর্ষ',
  '', '', ''
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  display_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.school_bootstrap_state (
  id boolean primary key default true check (id),
  school_id uuid not null references public.schools(id) on delete cascade,
  token_hash text,
  claimed_at timestamptz
);

insert into private.school_bootstrap_state (id, school_id, token_hash)
values (true, '10000000-0000-4000-8000-000000000001', 'ab46c864205a432a86825470e17d2363b93e4335d782c8e5d03cfb026e3009a1');

alter table private.school_bootstrap_state enable row level security;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on table private.school_bootstrap_state from public, anon, authenticated;

create or replace function private.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.school_id
  from public.profiles as p
  where p.user_id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

create or replace function private.is_school_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.user_id = (select auth.uid())
      and p.role = 'admin'
      and p.is_active = true
  )
$$;

revoke all on function private.current_school_id() from public, anon;
revoke all on function private.is_school_admin() from public, anon;
grant execute on function private.current_school_id() to authenticated;
grant execute on function private.is_school_admin() to authenticated;

create or replace function public.claim_school_admin(p_token text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  bootstrap_row private.school_bootstrap_state%rowtype;
begin
  if caller_id is null then
    raise exception 'Sign in before completing admin setup.' using errcode = '28000';
  end if;

  if length(trim(coalesce(p_display_name, ''))) < 2 then
    raise exception 'Enter an admin name.' using errcode = '22023';
  end if;

  select * into bootstrap_row
  from private.school_bootstrap_state
  where id = true
  for update;

  if bootstrap_row.claimed_at is not null or bootstrap_row.token_hash is null then
    raise exception 'Initial admin setup has already been completed.' using errcode = '55000';
  end if;

  if bootstrap_row.token_hash <> encode(
    extensions.digest(convert_to(trim(coalesce(p_token, '')), 'UTF8'), 'sha256'), 'hex'
  ) then
    raise exception 'The one-time setup key is not valid.' using errcode = '28000';
  end if;

  insert into public.profiles (user_id, school_id, role, display_name, is_active)
  values (caller_id, bootstrap_row.school_id, 'admin', trim(p_display_name), true);

  update private.school_bootstrap_state
  set token_hash = null, claimed_at = now()
  where id = true;

  return bootstrap_row.school_id;
end;
$$;

revoke all on function public.claim_school_admin(text, text) from public, anon;
grant execute on function public.claim_school_admin(text, text) to authenticated;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  name text not null,
  teacher text not null default '',
  room text not null default '',
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (school_id, id)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  name text not null,
  guardian text not null default '',
  class_id uuid references public.classes(id) on delete set null,
  roll integer not null check (roll > 0),
  phone text not null default '',
  admission date not null default current_date,
  status text not null default 'সক্রিয়',
  created_at timestamptz not null default now(),
  unique (school_id, class_id, roll)
);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  name text not null,
  subject text not null default '',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  unique (school_id, student_id, attendance_date)
);

create table public.fee_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  month text not null,
  amount_due numeric(12,2) not null default 0 check (amount_due >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  paid_at date,
  created_at timestamptz not null default now(),
  unique (school_id, student_id, month)
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  title text not null,
  date date not null default current_date,
  type text not null default 'ঘোষণা',
  body text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null default private.current_school_id() references public.schools(id) on delete cascade,
  name text not null,
  category text not null default 'সাধারণ',
  note text not null default '',
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text not null default 'application/octet-stream',
  uploaded_at timestamptz not null default now()
);

create index students_school_class_idx on public.students (school_id, class_id);
create index attendance_school_date_idx on public.attendance (school_id, attendance_date);
create index fees_school_month_idx on public.fee_records (school_id, month);
create index notices_public_date_idx on public.notices (school_id, is_published, date desc);
create index documents_school_uploaded_idx on public.documents (school_id, uploaded_at desc);

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.attendance enable row level security;
alter table public.fee_records enable row level security;
alter table public.notices enable row level security;
alter table public.documents enable row level security;

grant select on public.schools, public.notices to anon;
grant usage on schema public to anon, authenticated;
grant select, update on public.schools to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.classes, public.students, public.teachers,
  public.attendance, public.fee_records, public.notices, public.documents to authenticated;

create policy schools_public_read on public.schools
  for select to anon, authenticated
  using (is_public = true);
create policy schools_admin_update on public.schools
  for update to authenticated
  using (id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy notices_public_read on public.notices
  for select to anon, authenticated
  using (is_published = true and school_id = '10000000-0000-4000-8000-000000000001');

create policy classes_school_admin_all on public.classes
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy students_school_admin_all on public.students
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy teachers_school_admin_all on public.teachers
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy attendance_school_admin_all on public.attendance
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy fees_school_admin_all on public.fee_records
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy notices_school_admin_all on public.notices
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));
create policy documents_school_admin_all on public.documents
  for all to authenticated
  using (school_id = (select private.current_school_id()) and (select private.is_school_admin()))
  with check (school_id = (select private.current_school_id()) and (select private.is_school_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-documents', 'school-documents', false, 10485760,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

create policy school_documents_private_access on storage.objects
  for all to authenticated
  using (
    bucket_id = 'school-documents'
    and (select private.is_school_admin())
    and (storage.foldername(name))[1] = (select private.current_school_id())::text
  )
  with check (
    bucket_id = 'school-documents'
    and (select private.is_school_admin())
    and (storage.foldername(name))[1] = (select private.current_school_id())::text
  );
