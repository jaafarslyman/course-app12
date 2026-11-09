import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { InlineAlert, SetupNotice } from '@/components/app-shell';
import { Form } from '@/components/ui/form';
import { useLearnerSession } from '@/lib/learner-session-context';
import { callRpc, errorCode, hasSupabaseConfig, requireSupabase } from '@/lib/supabase';

const loginSchema = z.object({
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا'),
  password: z.string().min(1, 'أدخل كلمة المرور'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function AdminSignInPage() {
  const [, setLocation] = useLocation();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    let active = true;
    async function redirectExistingAdmin() {
      if (!hasSupabaseConfig) return;
      try {
        const { data } = await requireSupabase().auth.getSession();
        if (!data.session) return;
        await callRpc('admin_list_learners');
        if (active) setLocation('/admin');
      } catch {
        // Invalid/non-admin sessions stay on the sign-in page.
      }
    }
    void redirectExistingAdmin();
    return () => { active = false; };
  }, [setLocation]);

  async function signIn(values: LoginValues) {
    setFormError('');
    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }
    setSubmitting(true);
    const client = requireSupabase();
    const { error } = await client.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });
    if (error) {
      setSubmitting(false);
      setFormError('تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور.');
      return;
    }
    try {
      await callRpc('admin_list_learners');
      setLocation('/admin');
    } catch (failure) {
      await client.auth.signOut();
      setFormError(
        errorCode(failure) === '42501'
          ? 'هذا الحساب غير مخوّل لإدارة الدورة.'
          : 'تعذّر التحقق من صلاحية الإدارة. تأكد من إعداد حساب المشرف.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page admin-auth-page" dir="rtl">
      <section className="admin-auth-form-area" aria-label="تسجيل دخول المشرف">
        <div className="admin-auth-card">
          <div className="eyebrow">لُغتي بثقة · مساحة الإدارة</div>
          <h1 className="page-title">مرحبًا بعودتك</h1>
          {!hasSupabaseConfig && <SetupNotice />}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(signIn)} className="auth-form" noValidate>
              <label className="field auth-field">
                <span className="auth-sr-only">البريد الإلكتروني</span>
                <input type="email" inputMode="email" autoComplete="username" className="ltr"
                  placeholder="البريد الإلكتروني" aria-label="البريد الإلكتروني"
                  {...form.register('email')} data-testid="input-admin-email" />
                {form.formState.errors.email && <span className="form-error">{form.formState.errors.email.message}</span>}
              </label>
              <label className="field auth-field">
                <span className="auth-sr-only">كلمة المرور</span>
                <input type="password" autoComplete="current-password" placeholder="كلمة المرور"
                  aria-label="كلمة المرور" {...form.register('password')} data-testid="input-admin-password" />
                {form.formState.errors.password && <span className="form-error">{form.formState.errors.password.message}</span>}
              </label>
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <button type="submit" className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig} data-testid="button-admin-signin">
                {submitting ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
              </button>
            </form>
          </Form>
        </div>
      </section>
      <Link href="/" className="learner-admin-link admin-learner-link" data-testid="link-learner-signin">
        <span>دخول المتعلّمين</span>
      </Link>
    </main>
  );
}

export function LearnerAccessPage() {
  const [, setLocation] = useLocation();
  const { learner, status } = useLearnerSession();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (status === 'signed-in' && learner) setLocation('/learn');
  }, [learner, setLocation, status]);

  async function signIn(values: LoginValues) {
    setFormError('');
    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) throw error;
      const profile = await callRpc('learner_current_profile');
      if (!profile) {
        await requireSupabase().auth.signOut();
        setFormError('هذا الحساب غير مخصّص كحساب متعلّم.');
        return;
      }
      setLocation('/learn');
    } catch {
      setFormError('تعذّر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page learner-auth-page" dir="rtl">
      <section className="learner-auth-content">
        <div className="learner-portrait" aria-hidden="true">
          <div className="learner-portrait-frame" />
          <img className="learner-portrait-image"
            src={`${import.meta.env.BASE_URL}assets/learner-signin-character.png`} alt="" />
        </div>
        <div className="learner-auth-form">
          {!hasSupabaseConfig && <SetupNotice />}
          <div className="eyebrow">لُغتي بثقة · رحلتك تبدأ هنا</div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(signIn)} className="auth-form" noValidate>
              <label className="field auth-field">
                <span className="auth-sr-only">البريد الإلكتروني</span>
                <input type="email" inputMode="email" autoComplete="username" className="ltr"
                  placeholder="البريد الإلكتروني" aria-label="البريد الإلكتروني"
                  {...form.register('email')} data-testid="input-learner-email" />
                {form.formState.errors.email && <span className="form-error">{form.formState.errors.email.message}</span>}
              </label>
              <label className="field auth-field">
                <span className="auth-sr-only">كلمة المرور</span>
                <input type="password" autoComplete="current-password" placeholder="كلمة المرور"
                  aria-label="كلمة المرور" {...form.register('password')} data-testid="input-learner-password" />
                {form.formState.errors.password && <span className="form-error">{form.formState.errors.password.message}</span>}
              </label>
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <button type="submit" className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig} data-testid="button-learner-login">
                {submitting ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
              </button>
            </form>
          </Form>
        </div>
      </section>
      <Link href="/admin/sign-in" className="learner-admin-link" data-testid="link-admin-signin">
        <span lang="en">Admin access</span>
      </Link>
    </main>
  );
}
