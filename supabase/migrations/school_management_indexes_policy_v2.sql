-- Tighten the notices read policy and cover foreign-key lookup paths.
drop policy if exists notices_public_read on public.notices;
create policy notices_public_read on public.notices
  for select to anon
  using (is_published = true and school_id = '10000000-0000-4000-8000-000000000001');

create index if not exists school_bootstrap_state_school_id_idx on private.school_bootstrap_state (school_id);
create index if not exists profiles_school_id_idx on public.profiles (school_id);
create index if not exists teachers_school_id_idx on public.teachers (school_id);
create index if not exists students_class_id_idx on public.students (class_id);
create index if not exists attendance_student_id_idx on public.attendance (student_id);
create index if not exists fee_records_student_id_idx on public.fee_records (student_id);
