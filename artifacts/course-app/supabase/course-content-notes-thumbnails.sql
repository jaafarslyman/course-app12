-- Apply this once to an existing course app database.
-- Fresh installations should run courses.sql instead.
begin;

alter table public.course_content_items
  add column if not exists supplemental_note text,
  add column if not exists thumbnail_storage_path text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.course_content_items'::regclass
      and conname = 'course_content_supplemental_note_length'
  ) then
    alter table public.course_content_items
      add constraint course_content_supplemental_note_length
      check (supplemental_note is null or char_length(supplemental_note) <= 10000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.course_content_items'::regclass
      and conname = 'course_content_thumbnail_video'
  ) then
    alter table public.course_content_items
      add constraint course_content_thumbnail_video
      check (thumbnail_storage_path is null or kind = 'video');
  end if;
end;
$constraints$;

create unique index if not exists course_content_thumbnail_path_unique
  on public.course_content_items (thumbnail_storage_path)
  where thumbnail_storage_path is not null;

do $content_json$
declare
  v_definition text;
  v_old text := $old$    'body', items.body,
    'storagePath', case$old$;
  v_new text := $new$    'body', items.body,
    'supplementalNote', items.supplemental_note,
    'storagePath', case$new$;
  v_old_thumbnail text := $old_thumbnail$    end,
    'mimeType', items.mime_type,$old_thumbnail$;
  v_new_thumbnail text := $new_thumbnail$    end,
    'hasThumbnail', items.thumbnail_storage_path is not null,
    'thumbnailStoragePath', case
      when p_include_storage_path then items.thumbnail_storage_path
      else null
    end,
    'mimeType', items.mime_type,$new_thumbnail$;
begin
  v_definition := pg_get_functiondef(
    'public.course_content_json(uuid, uuid, boolean)'::regprocedure
  );
  if strpos(v_definition, v_old) > 0 then
    v_definition := replace(v_definition, v_old, v_new);
  elsif strpos(v_definition, '''supplementalNote'', items.supplemental_note') = 0 then
    raise exception 'Could not safely update course_content_json; review the function definition.';
  end if;
  if strpos(v_definition, v_old_thumbnail) > 0 then
    v_definition := replace(v_definition, v_old_thumbnail, v_new_thumbnail);
  elsif strpos(v_definition, '''hasThumbnail'', items.thumbnail_storage_path') = 0 then
    raise exception 'Could not safely add thumbnail fields to course_content_json.';
  end if;
  execute v_definition;
end;
$content_json$;

do $admin_mutate$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_thumbnail_marker text := $marker$    if p_action = 'create_content' then
      select coalesce(max(sort_order), -1) + 1$marker$;
  v_thumbnail_block text := $block$    if v_thumbnail_storage_path is not null and (
      v_kind <> 'video'
      or char_length(v_thumbnail_storage_path) not between 1 and 255
      or not exists (
        select 1
        from storage.objects as objects
        where objects.bucket_id = 'course-media'
          and objects.name = v_thumbnail_storage_path
          and lower(coalesce(objects.metadata->>'mimetype', '')) in (
            'image/jpeg', 'image/png', 'image/webp', 'image/gif'
          )
      )
    ) then
      raise exception 'invalid_content_thumbnail' using errcode = '22023';
    end if;

    if p_action = 'create_content' then
      select coalesce(max(sort_order), -1) + 1$block$;
begin
  v_definition := pg_get_functiondef(
    'public.admin_course_mutate(text, jsonb)'::regprocedure
  );
  for v_old, v_new in
    select old_text, new_text
    from (values
      (
        $old$  v_body text;
  v_storage_path text;$old$,
        $new$  v_body text;
  v_supplemental_note text;
  v_storage_path text;
  v_thumbnail_storage_path text;$new$
      ),
      (
        $old$    v_body := p_payload->>'body';
    v_storage_path := p_payload->>'storagePath';
    v_mime_type := p_payload->>'mimeType';$old$,
        $new$    v_body := p_payload->>'body';
    v_supplemental_note := nullif(trim(p_payload->>'supplementalNote'), '');
    v_storage_path := p_payload->>'storagePath';
    v_thumbnail_storage_path := nullif(trim(p_payload->>'thumbnailStoragePath'), '');
    v_mime_type := p_payload->>'mimeType';$new$
      ),
      (
        $old$      if not (p_payload ? 'body') then
        v_body := v_existing.body;
      end if;
      if not (p_payload ? 'storagePath') then
        v_storage_path := v_existing.storage_path;
      end if;$old$,
        $new$      if not (p_payload ? 'body') then
        v_body := v_existing.body;
      end if;
      if not (p_payload ? 'supplementalNote') then
        v_supplemental_note := v_existing.supplemental_note;
      end if;
      if not (p_payload ? 'storagePath') then
        v_storage_path := v_existing.storage_path;
      end if;
      if not (p_payload ? 'thumbnailStoragePath') then
        v_thumbnail_storage_path := v_existing.thumbnail_storage_path;
      end if;$new$
      ),
      (
        $old$       or char_length(v_title) not between 1 and 200
       or (v_file_size_bytes is not null and v_file_size_bytes not between 0 and 524288000)$old$,
        $new$       or char_length(v_title) not between 1 and 200
       or (v_supplemental_note is not null and char_length(v_supplemental_note) > 10000)
       or (v_file_size_bytes is not null and v_file_size_bytes not between 0 and 524288000)$new$
      ),
      (
        $old$        title,
        body,
        storage_path,
        mime_type,$old$,
        $new$        title,
        body,
        supplemental_note,
        storage_path,
        thumbnail_storage_path,
        mime_type,$new$
      ),
      (
        $old$        v_title,
        v_body,
        v_storage_path,
        v_mime_type,$old$,
        $new$        v_title,
        v_body,
        v_supplemental_note,
        v_storage_path,
        v_thumbnail_storage_path,
        v_mime_type,$new$
      ),
      (
        $old$          body = v_body,
          storage_path = v_storage_path,
          mime_type = v_mime_type,$old$,
        $new$          body = v_body,
          supplemental_note = v_supplemental_note,
          storage_path = v_storage_path,
          thumbnail_storage_path = v_thumbnail_storage_path,
          mime_type = v_mime_type,$new$
      )
    ) as changes(old_text, new_text)
  loop
    if strpos(v_definition, v_old) > 0 then
      v_definition := replace(v_definition, v_old, v_new);
    elsif strpos(v_definition, v_new) = 0 then
      raise exception 'Could not safely update admin_course_mutate; review the function definition.';
    end if;
  end loop;
  if strpos(v_definition, 'invalid_content_thumbnail') = 0 then
    if strpos(v_definition, v_thumbnail_marker) = 0 then
      raise exception 'Could not safely add thumbnail validation to admin_course_mutate.';
    end if;
    v_definition := replace(v_definition, v_thumbnail_marker, v_thumbnail_block);
  end if;
  execute v_definition;
end;
$admin_mutate$;

drop function if exists public.course_media_path(uuid, text);

create or replace function public.course_media_path(
  p_content_id uuid,
  p_session_secret text default null,
  p_media_type text default 'content'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_session_id uuid;
  v_learner_id uuid;
begin
  if p_media_type not in ('content', 'thumbnail') then
    return jsonb_build_object('ok', false);
  end if;

  if coalesce(p_session_secret, '') = '' and public.is_course_admin() then
    select case
      when p_media_type = 'thumbnail' then items.thumbnail_storage_path
      else items.storage_path
    end into v_path
    from public.course_content_items as items
    where items.id = p_content_id
      and (
        (p_media_type = 'content' and items.kind in ('video', 'image', 'audio'))
        or (p_media_type = 'thumbnail' and items.kind = 'video')
      );
    if v_path is null then
      return jsonb_build_object('ok', false);
    end if;
    return jsonb_build_object('ok', true, 'storagePath', v_path);
  end if;

  if coalesce(p_session_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false);
  end if;

  select sessions.id, sessions.learner_id
  into v_session_id, v_learner_id
  from public.course_learner_sessions as sessions
  where sessions.session_hash = encode(
    extensions.digest(convert_to(p_session_secret, 'UTF8'), 'sha256'),
    'hex'
  )
    and sessions.revoked_at is null
  for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select case
    when p_media_type = 'thumbnail' then items.thumbnail_storage_path
    else items.storage_path
  end into v_path
  from public.course_content_items as items
  join public.course_courses as courses on courses.id = items.course_id
  where items.id = p_content_id
    and (
      (p_media_type = 'content' and items.kind in ('video', 'image', 'audio'))
      or (p_media_type = 'thumbnail' and items.kind = 'video')
    )
    and courses.published;
  if v_path is null then
    return jsonb_build_object('ok', false);
  end if;

  update public.course_learner_sessions
  set last_seen_at = now()
  where id = v_session_id and learner_id = v_learner_id;

  return jsonb_build_object('ok', true, 'storagePath', v_path);
end;
$$;

revoke all on function public.course_media_path(uuid, text, text) from public, anon, authenticated;
grant execute on function public.course_media_path(uuid, text, text) to anon, authenticated;

commit;
