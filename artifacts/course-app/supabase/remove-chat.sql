-- Remove the group chat tables, RPC functions, and chat-media bucket metadata.
-- Before running this script, delete the chat-media bucket and its files using
-- Supabase Storage (Dashboard or Storage API). Do not delete storage.objects
-- rows directly in SQL; that can leave the underlying files orphaned.

begin;

drop function if exists public.chat_get_state(text);
drop function if exists public.admin_chat_set_messaging_enabled(boolean);
drop function if exists public.chat_media_upload_permission(text);
drop function if exists public.chat_send_message(text, text, text, text, text, bigint);
drop function if exists public.chat_media_path(uuid, text);

drop table if exists public.course_chat_messages;
drop table if exists public.course_chat_settings;

do $cleanup$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'chat-media'
  ) then
    raise exception
      'The chat-media bucket still contains files. Delete it through Supabase Storage first, then rerun this script.';
  end if;

  delete from storage.buckets
  where id = 'chat-media';
end;
$cleanup$;

commit;
