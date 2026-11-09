-- Run after learner-password-course-access.sql.
-- Later levels remain locked until every item in every earlier level is
-- marked complete. Empty earlier levels do not block progression.
begin;

create or replace function public.course_level_is_unlocked(
  p_learner_id uuid,
  p_level_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_level_sort_order integer;
  v_level_uuid uuid;
begin
  select levels.course_id, levels.sort_order, levels.id
  into v_course_id, v_level_sort_order, v_level_uuid
  from public.course_levels as levels
  where levels.id = p_level_id;

  if not found then
    return false;
  end if;

  -- Admin course-tree calls pass a null learner and should see every level.
  if p_learner_id is null then
    return true;
  end if;

  return not exists (
    select 1
    from public.course_levels as previous_levels
    where previous_levels.course_id = v_course_id
      and (previous_levels.sort_order, previous_levels.id)
        < (v_level_sort_order, v_level_uuid)
      and exists (
        select 1
        from public.course_content_items as items
        left join public.course_learner_progress as progress
          on progress.content_item_id = items.id
         and progress.learner_id = p_learner_id
        where items.level_id = previous_levels.id
          and not coalesce(progress.is_completed, false)
      )
  );
end;
$$;

create or replace function public.course_level_json(
  p_level_id uuid,
  p_learner_id uuid,
  p_include_storage_path boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', levels.id,
    'title', levels.title,
    'sortOrder', levels.sort_order,
    'isUnlocked', access.is_unlocked,
    'items', case
      when access.is_unlocked then coalesce((
        select jsonb_agg(
          public.course_content_json(
            items.id,
            p_learner_id,
            p_include_storage_path
          )
          order by items.sort_order, items.id
        )
        from public.course_content_items as items
        where items.level_id = levels.id
          and items.section_id is null
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'sections', case
      when access.is_unlocked then coalesce((
        select jsonb_agg(
          public.course_section_json(
            sections.id,
            p_learner_id,
            p_include_storage_path
          )
          order by sections.sort_order, sections.id
        )
        from public.course_sections as sections
        where sections.level_id = levels.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  )
  from public.course_levels as levels
  cross join lateral (
    select p_learner_id is null
      or public.course_level_is_unlocked(p_learner_id, levels.id) as is_unlocked
  ) as access
  where levels.id = p_level_id;
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
    and courses.published
    and (
      items.level_id is null
      or public.course_level_is_unlocked(v_learner_id, items.level_id)
    );
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
        and (
          items.level_id is null
          or public.course_level_is_unlocked(v_learner_id, items.level_id)
        )
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

revoke all on function public.course_level_is_unlocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.course_level_json(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.learner_save_progress(uuid, double precision, double precision, boolean) from public, anon, authenticated;
revoke all on function public.course_media_path(uuid, text) from public, anon, authenticated;

grant execute on function public.learner_save_progress(uuid, double precision, double precision, boolean) to authenticated;
grant execute on function public.course_media_path(uuid, text) to authenticated;

commit;
