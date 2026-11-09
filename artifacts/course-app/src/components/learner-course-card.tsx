import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Layers3,
  LockKeyhole,
  Play,
} from 'lucide-react';
import { Link } from 'wouter';
import type {
  Course,
  CourseContentItem,
  CourseLevel,
} from '@/lib/course-types';

type CourseDestination = {
  item: CourseContentItem;
  href: string;
};

function ordered<T extends { sortOrder: number; id?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (
    a.sortOrder - b.sortOrder || (a.id ?? '').localeCompare(b.id ?? '')
  ));
}

function getLevelItems(level: CourseLevel): CourseContentItem[] {
  return [
    ...ordered(level.items),
    ...ordered(level.sections).flatMap((section) => ordered(section.items)),
  ];
}

function getCourseDestinations(course: Course): CourseDestination[] {
  const base = `/learn/course/${encodeURIComponent(course.id)}`;
  const destinations: CourseDestination[] = ordered(course.items).map((item) => ({
    item,
    href: `${base}/content/${encodeURIComponent(item.id)}`,
  }));

  for (const level of ordered(course.levels)) {
    if (level.isUnlocked === false) continue;
    const levelBase = `${base}/level/${encodeURIComponent(level.id)}`;
    destinations.push(...ordered(level.items).map((item) => ({
      item,
      href: `${levelBase}/content/${encodeURIComponent(item.id)}`,
    })));
    for (const section of ordered(level.sections)) {
      const sectionBase = `${levelBase}/section/${encodeURIComponent(section.id)}`;
      destinations.push(...ordered(section.items).map((item) => ({
        item,
        href: `${sectionBase}/content/${encodeURIComponent(item.id)}`,
      })));
    }
  }
  return destinations;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

export function LearnerCourseCard({ course }: { course: Course }) {
  const destinations = getCourseDestinations(course);
  const completedCount = destinations.filter((entry) => entry.item.progress?.completed).length;
  const percent = destinations.length
    ? Math.round((completedCount / destinations.length) * 100)
    : 0;
  const nextLesson = destinations.find((entry) => !entry.item.progress?.completed);
  const lockedLevels = course.levels.filter((level) => level.isUnlocked === false).length;
  const completedCourse = destinations.length > 0
    && completedCount === destinations.length
    && lockedLevels === 0;
  const courseHref = `/learn/course/${encodeURIComponent(course.id)}`;
  const actionLabel = nextLesson
    ? completedCount ? 'متابعة الدرس' : 'ابدأ التعلّم'
    : completedCourse ? 'مراجعة المقرر' : 'استكشف المقرر';

  return (
    <article className="panel learner-course-card" data-testid={`card-course-${course.id}`}>
      <div className="learner-course-card-cover" aria-hidden="true">
        <div className="learner-course-cover-orbit" />
        <div className="learner-course-cover-top">
          <span>دفتر الفصل</span>
          <span>{formatCount(course.levels.length)} مستويات</span>
        </div>
        <div className="learner-course-cover-book">
          <BookOpen size={31} strokeWidth={1.6} />
        </div>
        <div className="learner-course-cover-bottom">
          <span>مسار تعلّمي</span>
          <strong>{String(course.sortOrder + 1).padStart(2, '0')}</strong>
        </div>
      </div>

      <div className="learner-course-card-content">
        <div className="learner-course-card-kicker">
          <span>مقرّري الدراسي</span>
          {completedCourse ? (
            <span className="learner-course-card-status is-complete">
              <CheckCircle2 size={13} aria-hidden="true" />
              مكتملة
            </span>
          ) : lockedLevels ? (
            <span className="learner-course-card-status is-locked">
              <LockKeyhole size={12} aria-hidden="true" />
              {formatCount(lockedLevels)} مستويات مقفلة
            </span>
          ) : (
            <span className="learner-course-card-status">قيد التعلّم</span>
          )}
        </div>

        <Link
          className="learner-course-card-title-link"
          href={courseHref}
          data-testid={`link-course-${course.id}`}
        >
          <h2>{course.name}</h2>
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>

        <div className="learner-course-card-facts">
          <span><Layers3 size={15} aria-hidden="true" /> {formatCount(course.levels.length)} مستويات</span>
          <span><BookOpen size={15} aria-hidden="true" /> {formatCount(destinations.length)} مواد متاحة</span>
        </div>

        <div className="learner-course-card-progress">
          <div className="learner-course-card-progress-label">
            <span>تقدّمك في المواد المتاحة</span>
            <strong>{formatCount(percent)}٪</strong>
          </div>
          <div
            className="learner-course-card-progress-track"
            role="progressbar"
            aria-label="التقدّم في الدورة"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <small>
            {formatCount(completedCount)} من {formatCount(destinations.length)} مواد مكتملة
          </small>
        </div>

        <div className="learner-course-card-next">
          <span>{nextLesson ? 'الدرس التالي' : completedCourse ? 'إنجازك' : 'الخطوة التالية'}</span>
          <strong>
            {nextLesson?.item.title
              ?? (completedCourse ? 'أتممت جميع مواد الدورة' : 'افتح منهج الدورة لاستكمال التعلّم')}
          </strong>
        </div>

        <div className="learner-course-card-actions">
          <Link className="learner-course-continue" href={nextLesson?.href ?? courseHref}>
            {nextLesson ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}
            <span>{actionLabel}</span>
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
          <Link className="learner-course-outline-link" href={courseHref}>
            خطة المقرر
          </Link>
        </div>
      </div>
    </article>
  );
}
