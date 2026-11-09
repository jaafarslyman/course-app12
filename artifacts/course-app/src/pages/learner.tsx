import { useMemo } from 'react';
import {
  BookOpen,
  LibraryBig,
} from 'lucide-react';
import { AppShell, EmptyState, LoadingState, PageHeading } from '@/components/app-shell';
import { LearnerCourseCard } from '@/components/learner-course-card';
import { useLearnerSession } from '@/lib/learner-session-context';
import { useLearnerCourses } from '@/lib/course-api';
import { LearnerContentViewerPage } from '@/pages/course-player';

export function LearnerHomePage() {
  const { learner } = useLearnerSession();
  const coursesQuery = useLearnerCourses();
  const courses = useMemo(
    () => [...(coursesQuery.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [coursesQuery.data],
  );

  return (
    <AppShell title="رحلتي التعليمية" audience="learner">
      <div className="course-pages learner-home-page" dir="rtl">
        <PageHeading
          eyebrow="أهلًا بعودتك"
          title={learner ? `مرحبًا، ${learner.name}` : 'مساحة المتعلّم'}
        />
        <section className="panel learner-welcome" data-testid="panel-learner-welcome">
          <div className="dialog-icon">
            <BookOpen size={22} aria-hidden="true" />
          </div>
          <div className="learner-welcome-copy">
            <div className="eyebrow">مساحتك التعليمية</div>
            <div className="learner-account-name" data-testid="text-learner-name">
              {learner?.name}
            </div>
            <div className="person-email ltr" data-testid="text-learner-email">
              {learner?.email}
            </div>
          </div>
          <div className="learner-welcome-mark" aria-hidden="true">لُ</div>
        </section>
        {coursesQuery.isLoading ? (
          <section className="panel learner-home-status"><LoadingState label="جارٍ تجهيز مسارك التعليمي…" /></section>
        ) : coursesQuery.isError ? (
          <section className="panel learner-empty-panel">
            <EmptyState title="تعذّر تحميل دورتك" description="تحقق من اتصالك ثم حاول فتح المسار مرة أخرى." icon={LibraryBig} />
            <div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void coursesQuery.refetch()} data-testid="button-retry-courses">إعادة المحاولة</button></div>
          </section>
        ) : courses.length ? (
          <section className="learner-home-courses" data-testid="list-learner-courses">
            <div className="learner-courses-heading">
              <div><div className="eyebrow">مساراتك الحالية</div><h2>دوراتك</h2></div>
              <span data-testid="text-learner-course-count">{new Intl.NumberFormat('ar').format(courses.length)} دورات</span>
            </div>
            <div className="learner-hierarchy-grid learner-course-grid">
              {courses.map((course) => (
                <LearnerCourseCard key={course.id} course={course} />
              ))}
            </div>
          </section>
        ) : (
          <section className="panel learner-empty-panel" data-testid="empty-learner-courses">
            <EmptyState title="لا توجد دروس متاحة بعد" description="تم تجهيز دخولك. ستظهر الدورة ومحتواها هنا عند إضافتهما." icon={LibraryBig} />
          </section>
        )}
      </div>
    </AppShell>
  );
}

export function LearnerContentPage() {
  return <LearnerContentViewerPage />;
}
