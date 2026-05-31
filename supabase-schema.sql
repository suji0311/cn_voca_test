create extension if not exists pgcrypto;

create table if not exists public.registered_students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  student_number text not null,
  section text not null,
  created_at timestamptz not null default now(),
  unique (student_number, section)
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  section text not null,
  minutes integer not null check (minutes > 0),
  unique (exam_id, section)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  sort_order integer not null,
  type text not null check (type in ('auto', 'manual')),
  category text not null,
  prompt text not null,
  points numeric not null check (points > 0),
  accepted_answers jsonb not null default '[]'::jsonb
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registered_students(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  deadline timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (student_id, exam_id)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registered_students(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  details jsonb not null default '[]'::jsonb,
  auto_score numeric not null default 0,
  auto_max numeric not null default 0,
  manual_max numeric not null default 0,
  manual_scores jsonb not null default '{}'::jsonb,
  auto_submitted boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (student_id, exam_id)
);

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = auth.uid()
  );
$$;

create or replace function public.verify_student_access(
  p_name text,
  p_student_number text,
  p_section text,
  p_exam_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.registered_students%rowtype;
  v_exam public.exams%rowtype;
  v_minutes integer;
  v_attempt public.attempts%rowtype;
  v_submitted boolean;
  v_questions jsonb;
  v_deadline timestamptz;
begin
  select *
  into v_student
  from public.registered_students
  where name = btrim(p_name)
    and student_number = btrim(p_student_number)
    and section = btrim(p_section);

  select *
  into v_exam
  from public.exams
  where title = btrim(p_exam_title)
    and is_active = true;

  if v_student.id is null or v_exam.id is null then
    return jsonb_build_object('allowed', false, 'message', '등록 정보가 일치하지 않습니다.');
  end if;

  select minutes
  into v_minutes
  from public.exam_sections
  where exam_id = v_exam.id
    and section = v_student.section;

  if v_minutes is null then
    return jsonb_build_object('allowed', false, 'message', '해당 분반에 열린 시험이 없습니다.');
  end if;

  select exists (
    select 1
    from public.submissions
    where student_id = v_student.id
      and exam_id = v_exam.id
  )
  into v_submitted;

  if v_submitted then
    return jsonb_build_object('allowed', false, 'message', '이미 제출된 시험입니다.');
  end if;

  select *
  into v_attempt
  from public.attempts
  where student_id = v_student.id
    and exam_id = v_exam.id;

  if v_attempt.id is null then
    v_deadline := now() + make_interval(mins => v_minutes);
    insert into public.attempts (student_id, exam_id, deadline)
    values (v_student.id, v_exam.id, v_deadline)
    returning * into v_attempt;
  else
    v_deadline := v_attempt.deadline;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'category', category,
      'prompt', prompt,
      'points', points,
      'accepted_answers', accepted_answers
    )
    order by sort_order
  )
  into v_questions
  from public.questions
  where exam_id = v_exam.id;

  return jsonb_build_object(
    'allowed', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'student_number', v_student.student_number,
      'section', v_student.section
    ),
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'title', v_exam.title
    ),
    'questions', coalesce(v_questions, '[]'::jsonb),
    'attempt', jsonb_build_object(
      'answers', v_attempt.answers,
      'deadline', v_attempt.deadline
    ),
    'deadline', v_deadline
  );
end;
$$;

create or replace function public.save_student_attempt(
  p_student_id uuid,
  p_exam_id uuid,
  p_answers jsonb,
  p_deadline timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.attempts
  set answers = p_answers,
      deadline = p_deadline,
      updated_at = now()
  where student_id = p_student_id
    and exam_id = p_exam_id;
end;
$$;

create or replace function public.submit_student_exam(
  p_student_id uuid,
  p_exam_id uuid,
  p_answers jsonb,
  p_auto_score numeric,
  p_auto_max numeric,
  p_manual_max numeric,
  p_details jsonb,
  p_auto_submitted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.submissions (
    student_id,
    exam_id,
    answers,
    details,
    auto_score,
    auto_max,
    manual_max,
    auto_submitted
  )
  values (
    p_student_id,
    p_exam_id,
    p_answers,
    p_details,
    p_auto_score,
    p_auto_max,
    p_manual_max,
    p_auto_submitted
  )
  on conflict (student_id, exam_id) do update
  set answers = excluded.answers,
      details = excluded.details,
      auto_score = excluded.auto_score,
      auto_max = excluded.auto_max,
      manual_max = excluded.manual_max,
      auto_submitted = excluded.auto_submitted,
      submitted_at = now();

  delete from public.attempts
  where student_id = p_student_id
    and exam_id = p_exam_id;
end;
$$;

alter table public.registered_students enable row level security;
alter table public.exams enable row level security;
alter table public.exam_sections enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.submissions enable row level security;
alter table public.admin_profiles enable row level security;

drop policy if exists "admins read registered students" on public.registered_students;
create policy "admins read registered students"
on public.registered_students for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins insert registered students" on public.registered_students;
create policy "admins insert registered students"
on public.registered_students for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "admins update registered students" on public.registered_students;
create policy "admins update registered students"
on public.registered_students for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "admins delete registered students" on public.registered_students;
create policy "admins delete registered students"
on public.registered_students for delete
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins read exams" on public.exams;
create policy "admins read exams"
on public.exams for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins insert exams" on public.exams;
create policy "admins insert exams"
on public.exams for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "admins update exams" on public.exams;
create policy "admins update exams"
on public.exams for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "admins delete exams" on public.exams;
create policy "admins delete exams"
on public.exams for delete
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins read exam sections" on public.exam_sections;
create policy "admins read exam sections"
on public.exam_sections for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins insert exam sections" on public.exam_sections;
create policy "admins insert exam sections"
on public.exam_sections for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "admins update exam sections" on public.exam_sections;
create policy "admins update exam sections"
on public.exam_sections for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "admins delete exam sections" on public.exam_sections;
create policy "admins delete exam sections"
on public.exam_sections for delete
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins read questions" on public.questions;
create policy "admins read questions"
on public.questions for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins insert questions" on public.questions;
create policy "admins insert questions"
on public.questions for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "admins update questions" on public.questions;
create policy "admins update questions"
on public.questions for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "admins delete questions" on public.questions;
create policy "admins delete questions"
on public.questions for delete
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins read submissions" on public.submissions;
create policy "admins read submissions"
on public.submissions for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "admins update manual scores" on public.submissions;
create policy "admins update manual scores"
on public.submissions for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "admins read admin profiles" on public.admin_profiles;
create policy "admins read admin profiles"
on public.admin_profiles for select
to authenticated
using (public.current_user_is_admin());

grant execute on function public.current_user_is_admin() to anon, authenticated;
grant execute on function public.verify_student_access(text, text, text, text) to anon, authenticated;
grant execute on function public.save_student_attempt(uuid, uuid, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.submit_student_exam(uuid, uuid, jsonb, numeric, numeric, numeric, jsonb, boolean) to anon, authenticated;

insert into public.registered_students (name, student_number, section)
values
  ('김민지', '20240101', 'A'),
  ('이준호', '20240102', 'A'),
  ('박서연', '20240201', 'B'),
  ('최도윤', '20240202', 'B')
on conflict (student_number, section) do update
set name = excluded.name;

insert into public.exams (title, is_active)
values ('중간고사 1차', true)
on conflict (title) do update
set is_active = excluded.is_active;

insert into public.exam_sections (exam_id, section, minutes)
select id, 'A', 20 from public.exams where title = '중간고사 1차'
on conflict (exam_id, section) do update set minutes = excluded.minutes;

insert into public.exam_sections (exam_id, section, minutes)
select id, 'B', 25 from public.exams where title = '중간고사 1차'
on conflict (exam_id, section) do update set minutes = excluded.minutes;

delete from public.questions
where exam_id = (select id from public.exams where title = '중간고사 1차');

insert into public.questions (exam_id, sort_order, type, category, prompt, points, accepted_answers)
select id, 1, 'auto', '병음 숫자 표기', '你好의 병음을 성조 숫자로 쓰세요.', 2, '["ni3 hao3", "ni3hao3"]'::jsonb
from public.exams where title = '중간고사 1차'
union all
select id, 2, 'auto', '품사', '很의 품사를 쓰세요.', 2, '["부사", "副词", "adverb"]'::jsonb
from public.exams where title = '중간고사 1차'
union all
select id, 3, 'auto', '단어 뜻', '学习의 한국어 뜻을 쓰세요.', 2, '["공부하다", "배우다", "학습하다"]'::jsonb
from public.exams where title = '중간고사 1차'
union all
select id, 4, 'manual', '서술형', '중국어의 성조가 의미 구별에 중요한 이유를 예시와 함께 설명하세요.', 5, '[]'::jsonb
from public.exams where title = '중간고사 1차'
union all
select id, 5, 'manual', '작문', '''나는 도서관에서 중국어를 공부합니다.''를 중국어로 쓰세요.', 4, '[]'::jsonb
from public.exams where title = '중간고사 1차';

-- 교수자 계정 등록 방법:
-- 1. Supabase Dashboard > Authentication > Users에서 교수자 이메일 계정을 생성합니다.
-- 2. 생성된 user id를 아래 SQL의 USER_ID_HERE에 넣고 실행합니다.
-- insert into public.admin_profiles (user_id, display_name)
-- values ('USER_ID_HERE', '담당 교수')
-- on conflict (user_id) do update set display_name = excluded.display_name;
