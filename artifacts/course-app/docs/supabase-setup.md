# Supabase setup

## Environment variables

Add these exact names to the Replit environment:

- `VITE_SUPABASE_URL` — the Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — the Supabase anon/publishable key used by the browser.
- `SUPABASE_SERVICE_ROLE_KEY` — the private service-role key used only by the API server to manage learner Auth accounts and create short-lived media links.

The two `VITE_` values are included in the browser bundle and must not contain secrets. Keep the service-role key private: do not rename it with a `VITE_` prefix, add it to source control, or expose it to the browser.

## Database setup

1. Create the administrator account in Supabase Authentication using the email and password you want to use.
2. In `supabase/schema.sql`, replace `YOUR_ADMIN_EMAIL_HERE` with that exact email address. Run the entire file in the Supabase SQL Editor. The final block registers the existing Auth account as a course administrator.
3. Run the entire `supabase/courses.sql` file in the SQL Editor. It creates the course tables, RPCs, private `course-media` bucket, and storage policies. If the course database is already installed and does not yet include lesson notes and private video thumbnails, run `supabase/course-content-notes-thumbnails.sql` before the next migration.
4. Run `supabase/learner-password-course-access.sql` in the SQL Editor after the other schema files. It adds learner email/password accounts, per-course one-time codes, lasting course enrollments, and authenticated access checks.
5. Run `supabase/sequential-level-unlock.sql` after the learner password/course-access migration. It unlocks each level only after all content in earlier levels is marked complete, hides locked content from learner responses, and blocks direct progress/media requests for locked levels.
6. Restart the app and API server after adding the environment variables. Sign in at `/admin/sign-in`; learners start at `/`.

Existing learner profiles are retained. When an administrator creates an account with an existing learner email, the new Auth account is linked to that profile. Existing general learner login codes are revoked, and existing learners are not automatically enrolled in courses; issue a new code for each course they should access. Deleting a learner permanently deletes the Auth account and learner profile, including that learner's course enrollments and progress.

There is no sample course content. Create and publish a course from the admin area after setup.

## Media-protection limits

Course media is stored privately and delivered through signed links after the app checks access. In the browser, the learner app blocks common copy, print, save, source-view and screenshot shortcuts when the browser exposes them, disables the context menu and dragging, limits selection, hides download/remote-playback controls, and pauses media when the page is hidden. These measures deter casual copying only. A website cannot reliably prevent operating-system screenshots or screen recordings, and signed links can still be captured while valid. Do not treat the web version as DRM or perfect anti-copy protection.

For an Android APK, the native Android wrapper must enable `FLAG_SECURE` for learner screens. This blocks standard Android screenshots and screen recordings while those screens are visible, but does not prevent external-camera recording or capture on a compromised device. The project does not yet include an Android wrapper; wire this native setting into the wrapper after choosing the APK packaging approach.
