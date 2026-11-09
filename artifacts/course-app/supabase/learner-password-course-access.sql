-- Run after schema.sql and courses.sql.
-- Learners authenticate with Supabase Auth. Course access codes are scoped to
-- one learner and one course, and become unusable when redeemed.
begin;

alter table public.course_learners
  add column if not exists auth_user_id uuid
    references auth.users (id) on delete cascade;

create unique index if not exists course_learners_auth_user_unique
  on public.course_learners (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.course_course_access_codes (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.course_learners (id) on delete cascade,
  course_id uuid not null references public.course_courses (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists course_one_pending_access_code_per_learner_course
  on public.course_course_access_codes (learner_id, course_id)
  where redeemed_at is null and revoked_at is null;

create index if not exists course_course_access_codes_lookup_idx
  on public.course_course_access_codes (learner_id, course_id, created_at desc)
  where redeemed_at is null and revoked_at is null;

create table if not exists public.course_learner_enrollments (
  learner_id uuid not null references public.course_learners (id) on delete cascade,
  course_id uuid not null references public.course_courses (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  access_code_id uuid references public.course_course_access_codes (id) on delete set null,
  primary key (learner_id, course_id)
);

create table if not exists public.course_code_redemption_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  blocked_until timestamptz
);

alter table public.course_course_access_codes enable row level security;
alter table public.course_learner_enrollments enable row level security;
alter table public.course_code_redemption_attempts enable row level security;

revoke all on table public.course_course_access_codes from public, anon, authenticated;
revoke all on table public.course_learner_enrollments from public, anon, authenticated;
revoke all on table public.course_code_redemption_attempts from public, anon, authenticated;

-- Retire the old shared learner-code and local-session RPCs.
drop function if exists public.admin_create_learner(text, text, text);
drop function if exists public.admin_generate_learner_code(uuid, text);
drop function if exists public.admin_revoke_learner_sessions(uuid);
drop function if exists public.redeem_learner_access(text, text, text);
drop function if exists public.validate_learner_session(text);
drop function if exists public.learner_course_tree(text);
drop function if exists public.learner_save_progress(text, uuid, double precision, double precision, boolean);
drop function if exists public.course_media_path(uuid, text);
drop function if exists public.course_media_path(uuid, text, text);

create or replace function public.learner_current_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', learners.id,
    'name', learners.name,
    'email', learners.email
  )
  from public.course_learners as learners
  where learners.auth_user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.learner_course_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_learner_id uuid;
  v_courses jsonb;
begin
  select learners.id
  into v_learner_id
  from public.course_learners as learners
  where learners.auth_user_id = (select auth.uid())
  limit 1;

  if v_learner_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', courses.id,
        'name', courses.name,
        'sortOrder', courses.sort_order,
        'hasAccess', enrollment.learner_id is not null,
        'enrolledAt', enrollment.granted_at
      )
      order by courses.sort_order, courses.created_at, courses.id
    ),
    '[]'::jsonb
  )
  into v_courses
  from public.course_courses as courses
  left join public.course_learner_enrollments as enrollment
    on enrollment.course_id = courses.id
   and enrollment.learner_id = v_learner_id
  where courses.published;

  return v_courses;
end;
$$;

create or replace function public.admin_list_learners()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_learners jsonb;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', learners.id,
        'auth_user_id', learners.auth_user_id,
        'name', learners.name,
        'email', learners.email,
        'created_at', learners.created_at,
        'has_account', learners.auth_user_id is not null,
        'pending_code_count', (
          select count(*)::integer
          from public.course_course_access_codes as codes
          where codes.learner_id = learners.id
            and codes.redeemed_at is null
            and codes.revoked_at is null
        ),
        'enrolled_courses', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', courses.id, 'name', courses.name)
            order by courses.sort_order, courses.created_at, courses.id
          )
          from public.course_learner_enrollments as enrollments
          join public.course_courses as courses
            on courses.id = enrollments.course_id
          where enrollments.learner_id = learners.id
        ), '[]'::jsonb),
        'last_sign_in_at', users.last_sign_in_at
      )
      order by learners.created_at desc, learners.id
    ),
    '[]'::jsonb
  )
  into v_learners
  from public.course_learners as learners
  left join auth.users as users on users.id = learners.auth_user_id;

  return v_learners;
end;
$$;

create or replace function public.admin_generate_course_access_code(
  p_learner_id uuid,
  p_course_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_auth_user_id uuid;
begin
  if not public.is_course_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{10}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  select learners.auth_user_id
  into v_auth_user_id
  from public.course_learners as learners
  where learners.id = p_learner_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'learner_not_found');
  end if;
  if v_auth_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'learner_account_required');
  end if;
  if not exists (
    select 1
    from public.course_courses as courses
    where courses.id = p_course_id
      and courses.published
  ) then
    return jsonb_build_object('ok', false, 'error', 'course_not_available');
  end if;
  if exists (
    select 1
    from public.course_learner_enrollments as enrollments
    where enrollments.learner_id = p_learner_id
      and enrollments.course_id = p_course_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'course_already_unlocked');
  end if;
  if exists (
    select 1
    from public.course_course_access_codes as prior_codes
    where prior_codes.learner_id = p_learner_id
      and extensions.crypt(v_code, prior_codes.code_hash) = prior_codes.code_hash
  ) then
    return jsonb_build_object('ok', false, 'error', 'code_collision');
  end if;

  update public.course_course_access_codes
  set revoked_at = now()
  where learner_id = p_learner_id
    and course_id = p_course_id
    and redeemed_at is null
    and revoked_at is null;

  insert into public.course_course_access_codes (
    learner_id,
    course_id,
    code_hash,
    created_by
  )
  values (
    p_learner_id,
    p_course_id,
    extensions.crypt(v_code, extensions.gen_salt('bf', 12)),
    (select auth.uid())
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.redeem_course_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_learner_id uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_code_id uuid;
  v_course_id uuid;
  v_created_by uuid;
  v_attempt public.course_code_redemption_attempts%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select learners.id
  into v_learner_id
  from public.course_learners as learners
  where learners.auth_user_id = v_user_id;
  if v_learner_id is null then
    return jsonb_build_object('ok', false, 'error', 'learner_not_found');
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{10}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  insert into public.course_code_redemption_attempts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select *
  into v_attempt
  from public.course_code_redemption_attempts
  where user_id = v_user_id
  for update;

  if v_attempt.blocked_until is not null and v_attempt.blocked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if v_attempt.window_started_at < now() - interval '15 minutes' then
    update public.course_code_redemption_attempts
    set window_started_at = now(), attempts = 0, blocked_until = null
    where user_id = v_user_id;
  end if;

  select codes.id, codes.course_id, codes.created_by
  into v_code_id, v_course_id, v_created_by
  from public.course_course_access_codes as codes
  join public.course_courses as courses on courses.id = codes.course_id
  where codes.learner_id = v_learner_id
    and codes.redeemed_at is null
    and codes.revoked_at is null
    and courses.published
    and extensions.crypt(v_code, codes.code_hash) = codes.code_hash
  order by codes.created_at desc
  limit 1
  for update of codes;

  if v_code_id is null then
    update public.course_code_redemption_attempts
    set attempts = attempts + 1,
        blocked_until = case
          when attempts + 1 >= 8 then now() + interval '15 minutes'
          else null
        end
    where user_id = v_user_id;

    return jsonb_build_object(
      'ok', false,
      'error', case
        when (select attempts from public.course_code_redemption_attempts where user_id = v_user_id) >= 8
          then 'too_many_attempts'
        else 'invalid_access_code'
      end
    );
  end if;

  update public.course_course_access_codes
  set redeemed_at = now()
  where id = v_code_id
    and redeemed_at is null
    and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  insert into public.course_learner_enrollments (
    learner_id,
    course_id,
    granted_by,
    access_code_id
  )
  values (v_learner_id, v_course_id, v_created_by, v_code_id)
  on conflict (learner_id, course_id) do nothing;

  update public.course_code_redemption_attempts
  set attempts = 0, window_started_at = now(), blocked_until = null
  where user_id = v_user_id;

  return jsonb_build_object('ok', true, 'course_id', v_course_id);
end;
$$;

create or replace function public.learner_course_tree()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_learner_id uuid;
  v_courses jsonb;
begin
  select learners.id
  into v_learner_id
  from public.course_learners as learners
  where learners.auth_user_id = (select auth.uid())
  limit 1;

  if v_learner_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      tree.course
      order by (tree.course ->> 'sortOrder')::integer,
        tree.course ->> 'createdAt',
        tree.course ->> 'id'
    ),
    '[]'::jsonb
  )
  into v_courses
  from jsonb_array_elements(
    public.course_tree_json(v_learner_id, true, false)
  ) as tree(course)
  join public.course_learner_enrollments as enrollments
    on enrollments.course_id = (tree.course ->> 'id')::uuid
   and enrollments.learner_id = v_learner_id;

  return v_courses;
end;
$$;

create or replace function public.learner_save_progress(
  p_content_id uuid,
  p_position_seconds double precision,
  p_duration_seconds double precision,
  p_mark_done boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_learner_id uuid;
  v_duration integer;
  v_position integer;
  v_percent smallint;
  v_completed boolean;
begin
  if p_position_seconds is null or p_position_seconds < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_progress');
  end if;

  select learners.id
  into v_learner_id
  from public.course_learners as learners
  where learners.auth_user_id = (select auth.uid())
  limit 1;
  if v_learner_id is null then
    return jsonb_build_object('ok', false, 'error', 'learner_not_found');
  end if;

  select coalesce(
    case
      when p_duration_seconds > 0
        then least(floor(p_duration_seconds), 86400)::integer
      else null
    end,
    items.duration_seconds
  )
  into v_duration
  from public.course_content_items as items
  join public.course_courses as courses on courses.id = items.course_id
  join public.course_learner_enrollments as enrollments
    on enrollments.course_id = courses.id
   and enrollments.learner_id = v_learner_id
  where items.id = p_content_id
    and courses.published;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'content_not_available');
  end if;

  v_position := least(
    floor(least(p_position_seconds, 86400))::integer,
    coalesce(v_duration, 86400)
  );
  v_completed := coalesce(p_mark_done, false)
    or (v_duration is not null and v_duration > 0 and v_position >= v_duration - 5);
  v_percent := case
    when v_completed then 100
    when v_duration is null or v_duration = 0 then 0
    else least(99, floor((v_position::numeric / v_duration::numeric) * 100))::smallint
  end;

  insert into public.course_learner_progress (
    learner_id,
    content_item_id,
    position_seconds,
    duration_seconds,
    progress_percent,
    is_completed,
    completed_at,
    updated_at
  )
  values (
    v_learner_id,
    p_content_id,
    v_position,
    v_duration,
    v_percent,
    v_completed,
    case when v_completed then now() else null end,
    now()
  )
  on conflict (learner_id, content_item_id) do update
  set position_seconds = excluded.position_seconds,
      duration_seconds = coalesce(excluded.duration_seconds, course_learner_progress.duration_seconds),
      progress_percent = case
        when course_learner_progress.is_completed or excluded.is_completed then 100
        else excluded.progress_percent
      end,
      is_completed = course_learner_progress.is_completed or excluded.is_completed,
      completed_at = case
        when course_learner_progress.is_completed then course_learner_progress.completed_at
        when excluded.is_completed then now()
        else null
      end,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'progress', jsonb_build_object(
      'positionSeconds', v_position,
      'durationSeconds', v_duration,
      'progressPercent', v_percent,
      'completed', v_completed
    )
  );
end;
$$;

create or replace function public.course_media_path(
  p_content_id uuid,
  p_media_type text default 'content'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_learner_id uuid;
begin
  if p_media_type not in ('content', 'thumbnail') then
    return jsonb_build_object('ok', false);
  end if;

  if not public.is_course_admin() then
    select learners.id
    into v_learner_id
    from public.course_learners as learners
    where learners.auth_user_id = (select auth.uid())
    limit 1;

    if v_learner_id is null then
      return jsonb_build_object('ok', false);
    end if;
  end if;

  select case
    when p_media_type = 'thumbnail' then items.thumbnail_storage_path
    else items.storage_path
  end
  into v_path
  from public.course_content_items as items
  join public.course_courses as courses on courses.id = items.course_id
  where items.id = p_content_id
    and (
      (p_media_type = 'content' and items.kind in ('video', 'image', 'audio'))
      or (p_media_type = 'thumbnail' and items.kind = 'video')
    )
    and (
      public.is_course_admin()
      or (
        courses.published
        and exists (
          select 1
          from public.course_learner_enrollments as enrollments
          where enrollments.learner_id = v_learner_id
            and enrollments.course_id = courses.id
        )
      )
    );

  if v_path is null then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object('ok', true, 'storagePath', v_path);
end;
$$;

-- Remove access from every old one-time learner login code. New codes are
-- created only for a specific learner/course pair.
update public.course_learner_access_codes
set revoked_at = now()
where redeemed_at is null and revoked_at is null;

revoke all on function public.learner_current_profile() from public, anon, authenticated;
revoke all on function public.learner_course_catalog() from public, anon, authenticated;
revoke all on function public.admin_list_learners() from public, anon, authenticated;
revoke all on function public.admin_generate_course_access_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.redeem_course_access_code(text) from public, anon, authenticated;
revoke all on function public.learner_course_tree() from public, anon, authenticated;
revoke all on function public.learner_save_progress(uuid, double precision, double precision, boolean) from public, anon, authenticated;
revoke all on function public.course_media_path(uuid, text) from public, anon, authenticated;

grant execute on function public.learner_current_profile() to authenticated;
grant execute on function public.learner_course_catalog() to authenticated;
grant execute on function public.admin_list_learners() to authenticated;
grant execute on function public.admin_generate_course_access_code(uuid, uuid, text) to authenticated;
grant execute on function public.redeem_course_access_code(text) to authenticated;
grant execute on function public.learner_course_tree() to authenticated;
grant execute on function public.learner_save_progress(uuid, double precision, double precision, boolean) to authenticated;
grant execute on function public.course_media_path(uuid, text) to authenticated;

commit;
