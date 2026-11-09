import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Check, Copy, KeyRound, Plus, RefreshCw, Search, ShieldCheck,
  Trash2, UsersRound, X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { z } from 'zod';
import { Form } from '@/components/ui/form';
import { AppShell, EmptyState, InlineAlert, LoadingState, PageHeading } from '@/components/app-shell';
import { createAccessCode } from '@/lib/learner-session';
import { createLearnerAccount, deleteLearnerAccount } from '@/lib/admin-api';
import { useAdminCourses } from '@/lib/course-api';
import { callRpc, errorCode } from '@/lib/supabase';

type EnrolledCourse = { id: string; name: string };
export type LearnerRecord = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  created_at: string;
  has_account: boolean;
  pending_code_count: number;
  enrolled_courses: EnrolledCourse[];
  last_sign_in_at: string | null;
};
type CredentialsOnce = { name: string; email: string; password: string };
type CodeOnce = { learner: string; course: string; code: string };
const learnerSchema = z.object({
  name: z.string().trim().min(1, 'أدخل اسم المتعلّم').max(120),
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا').max(254),
  password: z.string().min(12, 'استخدم كلمة مرور من ١٢ خانة على الأقل').max(128),
});
type LearnerFormValues = z.infer<typeof learnerSchema>;

async function loadLearners() {
  const result = await callRpc<unknown>('admin_list_learners');
  if (!Array.isArray(result)) throw new Error('invalid_learner_response');
  return result as LearnerRecord[];
}
function useLearners() {
  return useQuery({ queryKey: ['admin', 'learners'], queryFn: loadLearners, refetchOnWindowFocus: true });
}
function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}
function formatDate(value: string | null) {
  if (!value) return 'لا يوجد نشاط بعد';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function securePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';
  if (!globalThis.crypto?.getRandomValues) throw new Error('secure_random_unavailable');
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export function AdminOverview() {
  const query = useLearners();
  const learners = query.data ?? [];
  const enrolled = learners.reduce((sum, learner) => sum + learner.enrolled_courses.length, 0);
  const pending = learners.reduce((sum, learner) => sum + learner.pending_code_count, 0);
  return (
    <AppShell title="نظرة عامة">
      <PageHeading eyebrow="إدارة التعلّم" title="لوحة الإدارة" subtitle="حسابات المتعلمين، الدورات، وحالة الوصول." >
        <Link className="button-primary" href="/admin/students" data-testid="link-manage-learners">
          <UsersRound size={16} aria-hidden="true" /> إدارة المتعلمين
        </Link>
      </PageHeading>
      {query.isLoading ? <LoadingState label="جارٍ تحميل بيانات المتعلمين…" /> : query.isError ? (
        <div className="panel admin-load-error"><EmptyState title="تعذّر تحميل البيانات" description="تحقق من الاتصال ثم أعد المحاولة." icon={UsersRound} />
          <button className="button-soft" type="button" onClick={() => void query.refetch()} data-testid="button-retry-admin-overview"><RefreshCw size={15} /> إعادة المحاولة</button></div>
      ) : <>
        <section className="stat-grid" aria-label="إحصاءات المتعلمين">
          <Metric label="حسابات المتعلمين" value={learners.length} icon={UsersRound} />
          <Metric label="دورات ممنوحة" value={enrolled} icon={BookOpen} />
          <Metric label="رموز تنتظر الاستخدام" value={pending} icon={KeyRound} />
          <Metric label="نشطون مؤخرًا" value={learners.filter((row) => row.last_sign_in_at).length} icon={ShieldCheck} />
        </section>
        <section className="panel dashboard-next-step">
          <div className="dashboard-next-icon"><ShieldCheck size={21} aria-hidden="true" /></div>
          <div><h2>وصول واضح لكل دورة</h2><p>أنشئ حساب المتعلّم أولًا، ثم أصدر رمزًا مستقلًا لكل دورة يحتاجها.</p></div>
          <Link className="button-soft" href="/admin/students" data-testid="link-open-user-management">إدارة الحسابات</Link>
        </section>
      </>}
    </AppShell>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof UsersRound }) {
  return <article className="panel stat-card"><div className="stat-label">{label}</div><div className="stat-value">{formatCount(value)}</div><div className="stat-icon"><Icon size={17} aria-hidden="true" /></div></article>;
}

export function AdminLearnersPage() {
  const queryClient = useQueryClient();
  const query = useLearners();
  const coursesQuery = useAdminCourses();
  const learners = query.data ?? [];
  const courses = useMemo(() => [...(coursesQuery.data ?? [])].filter((course) => course.published).sort((a, b) => a.sortOrder - b.sortOrder), [coursesQuery.data]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({ name: '', email: '' });
  const [codeLearner, setCodeLearner] = useState<LearnerRecord | null>(null);
  const [oneTimeCredentials, setOneTimeCredentials] = useState<CredentialsOnce | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<CodeOnce | null>(null);
  const [copyState, setCopyState] = useState('');
  const [pageError, setPageError] = useState('');
  const filteredLearners = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? learners.filter((row) => row.name.toLocaleLowerCase().includes(term) || row.email.toLocaleLowerCase().includes(term)) : learners;
  }, [learners, search]);

  const createMutation = useMutation({
    mutationFn: (values: LearnerFormValues) => createLearnerAccount({
      name: values.name.trim(), email: values.email.trim().toLowerCase(), password: values.password,
    }),
    onSuccess: async (response, values) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setCreateOpen(false);
      setOneTimeCredentials({ name: response.learner.name, email: response.learner.email, password: values.password });
      setCopyState('');
      setPageError('');
      window.setTimeout(() => createMutation.reset(), 0);
    },
    onError: (error) => {
      setPageError(getLearnerActionError(error));
      window.setTimeout(() => createMutation.reset(), 0);
    },
  });
  const codeMutation = useMutation({
    mutationFn: async ({ learner, courseId }: { learner: LearnerRecord; courseId: string }) => {
      const code = createAccessCode();
      const reply = await callRpc<{ ok: boolean; error?: string }>('admin_generate_course_access_code', {
        p_learner_id: learner.id, p_course_id: courseId, p_code: code,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'code_generation_failed');
      const courseName = courses.find((course) => course.id === courseId)?.name ?? '';
      return { learner: learner.name, course: courseName, code };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setCodeLearner(null);
      setOneTimeCode(result);
      setCopyState('');
      setPageError('');
      window.setTimeout(() => codeMutation.reset(), 0);
    },
    onError: (error) => setPageError(getLearnerActionError(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const reply = await deleteLearnerAccount(id);
      if (!reply.ok) throw new Error('delete_failed');
      return reply;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setPageError('');
    },
    onError: (error) => setPageError(getLearnerActionError(error)),
  });

  function deleteLearner(row: LearnerRecord) {
    if (!window.confirm(`حذف حساب ${row.name} نهائيًا؟ سيُحذف الحساب وكل تقدّمه وصلاحياته، ولا يمكن التراجع عن ذلك.`)) return;
    deleteMutation.mutate(row.id);
  }
  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <AppShell title="المتعلمون">
      <PageHeading eyebrow="إدارة الوصول" title="حسابات المتعلمين" subtitle="بيانات الدخول تنشأ مرة واحدة، وصلاحية كل دورة تصدر على حدة.">
        <button type="button" className="button-primary" onClick={() => { setPageError(''); setCreateDefaults({ name: '', email: '' }); setCreateOpen(true); }} data-testid="button-add-learner">
          <Plus size={17} aria-hidden="true" /> إنشاء حساب
        </button>
      </PageHeading>
      {pageError && <InlineAlert>{pageError}</InlineAlert>}
      <div className="learner-toolbar">
        <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">البحث بالاسم أو البريد الإلكتروني</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو البريد الإلكتروني" data-testid="input-search-learners" />
        </label><div className="learner-count" data-testid="text-learner-count">{formatCount(learners.length)} متعلّم</div>
      </div>
      {query.isLoading ? <LoadingState label="جارٍ تحميل قائمة المتعلمين…" /> : query.isError ? (
        <section className="panel"><EmptyState title="تعذّر تحميل القائمة" description="تأكد من صلاحية حسابك ثم أعد المحاولة." icon={UsersRound} />
          <div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()} data-testid="button-retry-learners"><RefreshCw size={15} /> إعادة المحاولة</button></div></section>
      ) : filteredLearners.length === 0 ? (
        <section className="panel"><EmptyState title={search ? 'لا توجد نتائج مطابقة' : 'لا يوجد متعلمون بعد'} description={search ? 'جرّب البحث باسم أو بريد مختلف.' : 'أنشئ حسابًا جديدًا للبدء.'} icon={UsersRound} />
          {!search && <div className="empty-state-action"><button type="button" className="button-primary" onClick={() => { setCreateDefaults({ name: '', email: '' }); setCreateOpen(true); }} data-testid="button-add-first-learner"><Plus size={16} /> إنشاء أول حساب</button></div>}</section>
      ) : (
        <section className="panel table-wrap">
          <table className="data-table learner-table"><thead><tr><th>المتعلّم</th><th>الدورات المفعّلة</th><th>آخر دخول</th><th>تاريخ الإنشاء</th><th>إجراءات</th></tr></thead>
            <tbody>{filteredLearners.map((row) => <tr key={row.id} data-testid={`row-learner-${row.id}`}>
              <td><div className="person"><span className="person-avatar" aria-hidden="true">{row.name.slice(0, 1)}</span><span><span className="person-name">{row.name}</span><span className="person-email ltr">{row.email}</span>{!row.has_account && <span className="table-muted">لا توجد بيانات دخول بعد</span>}</span></div></td>
              <td><div className="enrolled-course-list">{row.enrolled_courses.length ? row.enrolled_courses.map((course) => <span className="badge" key={course.id}>{course.name}</span>) : <span className="table-muted">لا توجد دورات</span>}</div><small className="pending-code-note">{row.pending_code_count ? `${formatCount(row.pending_code_count)} رموز غير مستخدمة` : ''}</small></td>
              <td>{formatDate(row.last_sign_in_at)}</td><td>{formatDate(row.created_at)}</td>
              <td><div className="learner-row-actions">
                {row.has_account ? (
                  <button type="button" className="button-soft compact-action" onClick={() => { setPageError(''); setCodeLearner(row); }} data-testid={`button-generate-code-${row.id}`}><KeyRound size={14} aria-hidden="true" /> إصدار رمز دورة</button>
                ) : (
                  <button type="button" className="button-soft compact-action" onClick={() => { setPageError(''); setCreateDefaults({ name: row.name, email: row.email }); setCreateOpen(true); }} data-testid={`button-setup-learner-${row.id}`}><UsersRound size={14} aria-hidden="true" /> إعداد بيانات الدخول</button>
                )}
                <button type="button" className="button-danger compact-action" onClick={() => deleteLearner(row)} disabled={deleteMutation.isPending} data-testid={`button-delete-learner-${row.id}`}><Trash2 size={14} aria-hidden="true" /> حذف الحساب</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </section>
      )}
      <p className="inline-note">رمز الدورة يُعرض مرة واحدة فقط. إصداره لا يغيّر تسجيل دخول المتعلّم أو صلاحيات الدورات الأخرى.</p>

      {createOpen && <CreateLearnerDialog initialValues={createDefaults} pending={createMutation.isPending} error={getLearnerActionError(createMutation.error)}
        onClose={() => { setCreateOpen(false); createMutation.reset(); }} onSubmit={(values) => createMutation.mutate(values)} />}

      {codeLearner && <CourseCodeDialog learner={codeLearner} courses={courses} coursesLoading={coursesQuery.isLoading}
        pending={codeMutation.isPending} error={coursesQuery.isError ? 'تعذّر تحميل قائمة الدورات.' : getLearnerActionError(codeMutation.error)}
        onClose={() => { setCodeLearner(null); codeMutation.reset(); }}
        onSubmit={(courseId) => codeMutation.mutate({ learner: codeLearner, courseId })} />}

      {(oneTimeCredentials || oneTimeCode) && <OneTimeDialog
        title={oneTimeCredentials ? 'بيانات الحساب الجديدة' : 'رمز الوصول إلى الدورة'}
        description={oneTimeCredentials ? `${oneTimeCredentials.name} · ${oneTimeCredentials.email}` : `${oneTimeCode?.learner} · ${oneTimeCode?.course}`}
        value={oneTimeCredentials?.password ?? oneTimeCode?.code ?? ''}
        label={oneTimeCredentials ? 'كلمة المرور الأولية' : 'رمز الدورة'}
        copyState={copyState}
        onCopy={() => void copyValue(oneTimeCredentials?.password ?? oneTimeCode?.code ?? '')}
        onClose={() => {
          setOneTimeCredentials(null);
          setOneTimeCode(null);
          setCopyState('');
          createMutation.reset();
          codeMutation.reset();
        }}
      />}
    </AppShell>
  );
}

function CreateLearnerDialog({ initialValues, pending, error, onClose, onSubmit }: {
  initialValues: { name: string; email: string }; pending: boolean; error: string; onClose: () => void; onSubmit: (values: LearnerFormValues) => void;
}) {
  const form = useForm<LearnerFormValues>({ resolver: zodResolver(learnerSchema), defaultValues: { ...initialValues, password: '' } });
  function generatePassword() {
    try { form.setValue('password', securePassword(), { shouldDirty: true, shouldValidate: true }); }
    catch { form.setError('password', { message: 'تعذّر إنشاء كلمة مرور آمنة على هذا الجهاز.' }); }
  }
  return <div className="modal-backdrop" role="presentation"><section className="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="create-learner-title" data-testid="dialog-create-learner">
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="إغلاق" data-testid="button-close-create-learner"><X size={18} /></button>
    <div className="dialog-icon"><UsersRound size={22} /></div><div className="eyebrow">حساب متعلّم جديد</div><h2 id="create-learner-title">إنشاء حساب</h2>
    <p className="dialog-description">أنشئ بيانات دخول آمنة، ثم شاركها مع المتعلّم. كلمة المرور لن تظهر مجددًا.</p>
    <Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="dialog-form" noValidate>
      <label className="field">اسم المتعلّم<input autoComplete="name" {...form.register('name')} data-testid="input-new-learner-name" />{form.formState.errors.name && <span className="form-error">{form.formState.errors.name.message}</span>}</label>
      <label className="field">البريد الإلكتروني<input type="email" inputMode="email" autoComplete="email" className="ltr" {...form.register('email')} data-testid="input-new-learner-email" />{form.formState.errors.email && <span className="form-error">{form.formState.errors.email.message}</span>}</label>
      <label className="field">كلمة المرور<input type="password" autoComplete="new-password" className="ltr" {...form.register('password')} data-testid="input-new-learner-password" />{form.formState.errors.password && <span className="form-error">{form.formState.errors.password.message}</span>}</label>
      <button type="button" className="button-soft password-generate" onClick={generatePassword} data-testid="button-generate-password"><RefreshCw size={15} /> إنشاء كلمة مرور قوية</button>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="dialog-actions"><button type="submit" className="button-primary" disabled={pending} data-testid="button-create-learner"><Plus size={16} />{pending ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}</button><button type="button" className="button-soft" onClick={onClose} disabled={pending} data-testid="button-cancel-create-learner">إلغاء</button></div>
    </form></Form>
  </section></div>;
}

function CourseCodeDialog({ learner, courses, coursesLoading, pending, error, onClose, onSubmit }: {
  learner: LearnerRecord; courses: { id: string; name: string }[]; coursesLoading: boolean; pending: boolean; error: string; onClose: () => void; onSubmit: (id: string) => void;
}) {
  const [courseId, setCourseId] = useState('');
  return <div className="modal-backdrop" role="presentation"><section className="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="course-code-title" data-testid="dialog-course-code">
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="إغلاق" data-testid="button-close-course-code"><X size={18} /></button>
    <div className="dialog-icon"><KeyRound size={22} /></div><div className="eyebrow">صلاحية مستقلة لكل دورة</div><h2 id="course-code-title">إصدار رمز دورة</h2>
    <p className="dialog-description">{learner.name} · <span className="ltr">{learner.email}</span></p>
    {coursesLoading ? <LoadingState label="جارٍ تحميل الدورات…" /> : courses.length ? <label className="field">الدورة
      <select value={courseId} onChange={(event) => setCourseId(event.target.value)} data-testid="select-code-course">
        <option value="">اختر دورة منشورة</option>{courses.map((course) => {
          const alreadyEnrolled = learner.enrolled_courses.some((enrolledCourse) => enrolledCourse.id === course.id);
          return <option key={course.id} value={course.id} disabled={alreadyEnrolled}>{course.name}{alreadyEnrolled ? ' · مفعّلة' : ''}</option>;
        })}
      </select></label> : <InlineAlert>لا توجد دورات منشورة لإصدار رمز لها.</InlineAlert>}
    {error && <InlineAlert>{error}</InlineAlert>}
    <div className="dialog-actions"><button type="button" className="button-primary" onClick={() => courseId && onSubmit(courseId)} disabled={!courseId || pending || coursesLoading} data-testid="button-submit-course-code"><KeyRound size={16} />{pending ? 'جارٍ إصدار الرمز…' : 'إصدار الرمز'}</button>
      <button type="button" className="button-soft" onClick={onClose} disabled={pending} data-testid="button-cancel-course-code">إلغاء</button></div>
  </section></div>;
}

function OneTimeDialog({ title, description, value, label, copyState, onCopy, onClose }: {
  title: string; description: string; value: string; label: string; copyState: string; onCopy: () => void; onClose: () => void;
}) {
  return <div className="modal-backdrop" role="presentation"><section className="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="one-time-title" data-testid="dialog-one-time-secret">
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="إغلاق" data-testid="button-close-one-time"><X size={18} /></button>
    <div className="dialog-icon"><KeyRound size={22} /></div><div className="eyebrow">يظهر مرة واحدة</div><h2 id="one-time-title">{title}</h2><p className="dialog-description">{description}</p>
    <div className="generated-code-box ltr" data-testid="text-one-time-secret">{value}</div><p className="inline-note">{label}: انسخها الآن وشاركها بأمان. لن تُعرض مرة أخرى بعد إغلاق هذه النافذة.</p>
    {copyState === 'copied' && <InlineAlert tone="success">تم النسخ.</InlineAlert>}
    {copyState === 'error' && <InlineAlert>تعذّر النسخ. حدّد القيمة وانسخها يدويًا.</InlineAlert>}
    <div className="dialog-actions"><button type="button" className="button-primary" onClick={onCopy} data-testid="button-copy-one-time"><Copy size={16} /> نسخ</button>
      <button type="button" className="button-soft" onClick={onClose} data-testid="button-dismiss-one-time"><Check size={16} /> انتهيت</button></div>
  </section></div>;
}

function getLearnerActionError(error: unknown) {
  if (!error) return '';
  const message = error instanceof Error ? error.message : '';
  const code = errorCode(error);
  if (message === 'email_exists' || message === 'learner_email_exists' || code === '23505' || code === 'USER_ALREADY_EXISTS') return 'يوجد حساب مسجّل بهذا البريد الإلكتروني.';
  if (message === 'course_already_enrolled' || message === 'course_already_unlocked') return 'لدى المتعلّم صلاحية لهذه الدورة بالفعل.';
  if (message === 'learner_account_required') return 'أنشئ بيانات دخول للمتعلّم قبل إصدار رمز الدورة.';
  if (message === 'code_collision') return 'تعذّر إنشاء رمز فريد. حاول إصدار رمز جديد.';
  if (message === 'learner_not_found') return 'لم يتم العثور على المتعلّم. حدّث الصفحة وحاول مجددًا.';
  if (message === 'secure_random_unavailable') return 'تعذّر إنشاء قيمة عشوائية آمنة على هذا الجهاز.';
  return 'لم يكتمل الطلب. تحقق من الاتصال والصلاحيات ثم حاول مرة أخرى.';
}
