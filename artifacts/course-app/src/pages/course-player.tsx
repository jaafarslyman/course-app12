import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Headphones,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  AppShell,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import {
  learnerCourseQueryKey,
  useLearnerCourses,
  useSaveLearnerProgress,
} from '@/lib/course-api';
import { useCreateCourseMediaSignedUrl } from '@/lib/media-api';
import type { Course, CourseContentItem, CourseContentKind } from '@/lib/course-types';
import './course-pages.css';

const kindLabels: Record<CourseContentKind, string> = {
  video: 'فيديو',
  image: 'صورة',
  text: 'نص تعليمي',
  note: 'ملاحظة',
  audio: 'صوت',
};

type FlatItem = {
  item: CourseContentItem;
  group: string;
  levelId?: string;
  sectionId?: string;
};

function flattenCourse(course: Course): FlatItem[] {
  const result: FlatItem[] = [];
  [...course.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: 'مواد الدورة' }));
  [...course.levels].sort((a, b) => a.sortOrder - b.sortOrder).forEach((level) => {
    [...level.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: level.title, levelId: level.id }));
    [...level.sections].sort((a, b) => a.sortOrder - b.sortOrder).forEach((section) => {
      [...section.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: `${level.title} · ${section.title}`, levelId: level.id, sectionId: section.id }));
    });
  });
  return result;
}

function getFlatItemHref(courseId: string, entry: FlatItem) {
  const base = `/learn/course/${encodeURIComponent(courseId)}`;
  const itemPath = `/content/${encodeURIComponent(entry.item.id)}`;
  if (entry.levelId && entry.sectionId) {
    return `${base}/level/${encodeURIComponent(entry.levelId)}/section/${encodeURIComponent(entry.sectionId)}${itemPath}`;
  }
  if (entry.levelId) {
    return `${base}/level/${encodeURIComponent(entry.levelId)}${itemPath}`;
  }
  return `${base}${itemPath}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

function updateItemProgress(
  courses: Course[],
  contentId: string,
  positionSeconds: number,
  durationSeconds: number | null,
  markDone: boolean,
): Course[] {
  const now = new Date().toISOString();
  const patchItems = (items: CourseContentItem[]) => items.map((item) => {
    if (item.id !== contentId) return item;
    const completed = markDone || Boolean(item.progress?.completed);
    return {
      ...item,
      progress: {
        positionSeconds,
        durationSeconds,
        progressPercent: completed ? 100 : durationSeconds ? Math.min(100, Math.round(positionSeconds / durationSeconds * 100)) : item.progress?.progressPercent ?? 0,
        completed,
        completedAt: markDone ? now : item.progress?.completedAt ?? null,
        updatedAt: now,
      },
    };
  });
  return courses.map((course) => {
    let updatedLevels = course.levels.map((level) => ({
      ...level,
      items: patchItems(level.items),
      sections: level.sections.map((section) => ({ ...section, items: patchItems(section.items) })),
    }));
    const orderedLevels = [...updatedLevels].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
    const firstLockedIndex = orderedLevels.findIndex((level) => level.isUnlocked === false);
    if (firstLockedIndex > 0) {
      const previousLevel = orderedLevels[firstLockedIndex - 1];
      const previousItems = [
        ...previousLevel.items,
        ...previousLevel.sections.flatMap((section) => section.items),
      ];
      if (previousItems.every((item) => item.progress?.completed)) {
        const nextLevelId = orderedLevels[firstLockedIndex].id;
        updatedLevels = updatedLevels.map((level) => (
          level.id === nextLevelId ? { ...level, isUnlocked: true } : level
        ));
      }
    }
    return {
      ...course,
      items: patchItems(course.items),
      levels: updatedLevels,
    };
  });
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function LearnerContentViewerPage() {
  const { courseId, levelId, sectionId, contentId } = useParams<{
    courseId?: string;
    levelId?: string;
    sectionId?: string;
    contentId?: string;
  }>();
  const query = useLearnerCourses();
  const queryClient = useQueryClient();
  const saveProgress = useSaveLearnerProgress();
  const signedMedia = useCreateCourseMediaSignedUrl();
  const signedThumbnailMedia = useCreateCourseMediaSignedUrl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedPosition = useRef(-1);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaForItem, setMediaForItem] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [savingError, setSavingError] = useState('');

  const courses = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [query.data]);
  const course = courseId ? courses.find((entry) => entry.id === courseId) : courses[0];
  const flatItems = useMemo(() => course ? flattenCourse(course) : [], [course]);
  const currentFlat = contentId
    ? flatItems.find(({ item, levelId: itemLevelId, sectionId: itemSectionId }) => (
      item.id === contentId &&
      (sectionId
        ? itemLevelId === levelId && itemSectionId === sectionId
        : levelId
          ? itemLevelId === levelId && !itemSectionId
          : !itemLevelId && !itemSectionId)
    ))
    : undefined;
  const selected = currentFlat?.item;
  const level = course?.levels.find((entry) => entry.id === levelId);
  const section = level?.sections.find((entry) => entry.id === sectionId);
  const courseHref = course ? `/learn/course/${encodeURIComponent(course.id)}` : '/learn/course';
  const levelHref = level
    ? `${courseHref}/level/${encodeURIComponent(level.id)}`
    : courseHref;
  const sectionHref = section
    ? `${levelHref}/section/${encodeURIComponent(section.id)}`
    : levelHref;
  const backHref = section ? sectionHref : level ? levelHref : courseHref;
  const selectedIndex = selected
    ? flatItems.findIndex((entry) => entry.item.id === selected.id)
    : -1;
  const previousLesson = selectedIndex > 0 ? flatItems[selectedIndex - 1] : undefined;
  const nextLesson = selectedIndex >= 0 ? flatItems[selectedIndex + 1] : undefined;

  useEffect(() => {
    setMediaUrl('');
    setMediaForItem('');
    setPosterUrl('');
    setMediaError('');
    setSavingError('');
    lastSavedPosition.current = -1;
    if (!contentId || !selected || !['video', 'audio', 'image'].includes(selected.kind)) return;
    let cancelled = false;
    signedMedia.mutateAsync({
      data: { contentId: selected.id, mediaType: 'content' },
    }).then((result) => {
      if (!cancelled) {
        setMediaUrl(result.signedUrl);
        setMediaForItem(selected.id);
      }
    }).catch(() => {
      if (!cancelled) setMediaError('تعذّر فتح الملف المحمي. تحقق من اتصالك ثم حاول مجددًا.');
    });
    if (selected.kind === 'video' && selected.hasThumbnail) {
      signedThumbnailMedia.mutateAsync({
        data: { contentId: selected.id, mediaType: 'thumbnail' },
      }).then((result) => {
        if (!cancelled) setPosterUrl(result.signedUrl);
      }).catch(() => {
        if (!cancelled) setPosterUrl('');
      });
    }
    return () => { cancelled = true; };
  }, [contentId, selected?.id, selected?.kind, selected?.storagePath, selected?.hasThumbnail]);

  const savePosition = useCallback((positionSeconds: number, durationSeconds: number | null, markDone = false) => {
    if (!selected) return;
    if (!markDone && Math.abs(positionSeconds - lastSavedPosition.current) < 8) return;
    lastSavedPosition.current = positionSeconds;
    saveProgress.mutate({ contentId: selected.id, positionSeconds, durationSeconds, markDone }, {
      onError: () => setSavingError('تعذّر حفظ التقدم الآن. سيُحفظ عند المحاولة التالية.'),
      onSuccess: (reply) => {
        setSavingError('');
        const isCompleted = markDone || reply.progress?.completed === true;
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, selected.id, positionSeconds, durationSeconds, isCompleted) : old);
        if (markDone || reply.progress?.completed) {
          void queryClient.invalidateQueries({ queryKey: learnerCourseQueryKey });
        }
      },
    });
  }, [selected?.id, saveProgress.mutate, queryClient]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      videoRef.current?.pause();
      audioRef.current?.pause();
      const media = videoRef.current ?? audioRef.current;
      if (media && selected) savePosition(media.currentTime, Number.isFinite(media.duration) ? media.duration : selected.durationSeconds, false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [selected?.id, savePosition]);

  function markComplete(item: CourseContentItem) {
    const media = item.id === selected?.id ? videoRef.current ?? audioRef.current : null;
    const duration = media && Number.isFinite(media.duration) ? media.duration : item.durationSeconds;
    const position = duration ?? item.progress?.positionSeconds ?? 0;
    saveProgress.mutate({ contentId: item.id, positionSeconds: position, durationSeconds: duration, markDone: true }, {
      onError: () => setSavingError('لم يتم حفظ الإكمال. حاول مرة أخرى.'),
      onSuccess: () => {
        setSavingError('');
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, item.id, position, duration, true) : old);
        void queryClient.invalidateQueries({ queryKey: learnerCourseQueryKey });
      },
    });
  }

  function retryMedia() {
    if (!selected) return;
    setMediaError('');
    setMediaUrl('');
    setMediaForItem('');
    setPosterUrl('');
    signedMedia.mutateAsync({ data: { contentId: selected.id, mediaType: 'content' } })
      .then((result) => {
        setMediaUrl(result.signedUrl);
        setMediaForItem(selected.id);
      })
      .catch(() => setMediaError('تعذّر فتح الملف المحمي. حاول مرة أخرى.'));
    if (selected.kind === 'video' && selected.hasThumbnail) {
      signedThumbnailMedia.mutateAsync({ data: { contentId: selected.id, mediaType: 'thumbnail' } })
        .then((result) => setPosterUrl(result.signedUrl))
        .catch(() => setPosterUrl(''));
    }
  }

  if (query.isLoading) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><div className="course-skeleton" /><div className="course-skeleton" /><LoadingState label="جارٍ تجهيز مسارك التعليمي…" /></div></AppShell>;
  }

  if (query.isError) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><PageHeading eyebrow="رحلتك التعليمية" title="دورتي" subtitle="سنحاول تحميل محتواك مرة أخرى." /><section className="panel"><EmptyState title="تعذّر تحميل الدورة" description="تحقق من اتصالك ثم أعد تحميل محتوى الدورة." icon={BookOpen} /><div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()}><RefreshCw size={15} /> إعادة المحاولة</button></div></section></div></AppShell>;
  }

  const isValidSelection = Boolean(course && selected && contentId);
  const isLockedLevel = level?.isUnlocked === false;
  const isVideoContent = selected?.kind === 'video';
  const isNativeMediaContent =
    selected?.kind === 'video' || selected?.kind === 'audio';
  const mediaIsReady = Boolean(selected && mediaUrl && mediaForItem === selected.id);

  return (
    <AppShell
      title={selected?.title ?? 'المادة'}
      audience="learner"
      fullScreen={isVideoContent}
    >
      <div
        className={`course-pages${isVideoContent ? ' course-video-screen' : ''}`}
        dir="rtl"
      >
        {isLockedLevel && course && level ? (
          <section className="panel learner-level-locked-message">
            <LockKeyhole size={25} aria-hidden="true" />
            <div>
              <h2>أكمل المستوى السابق أولًا</h2>
              <p>ستُفتح مواد هذا المستوى تلقائيًا بعد إكمال جميع مواد المستوى الذي قبله.</p>
            </div>
            <Link className="button-primary" href={courseHref}>العودة إلى مستويات الدورة</Link>
          </section>
        ) : !isValidSelection || !course || !selected ? (
          <section className="panel">
            <EmptyState
              title="المادة غير متاحة"
              description="قد يكون المحتوى قد تغيّر. ارجع إلى المسار واختر مادة متاحة."
              icon={BookOpen}
            />
            <div className="empty-state-action">
              <Link className="button-primary" href={backHref}>العودة إلى المسار</Link>
            </div>
          </section>
        ) : (
          <>
            {!isVideoContent ? (
              <>
                <nav className="course-breadcrumbs learner-viewer-breadcrumbs" aria-label="مسار المادة">
                  <Link href="/learn/course">دوراتي</Link>
                  <ChevronLeft size={14} aria-hidden="true" />
                  <Link href={courseHref}>{course.name}</Link>
                  {level ? (
                    <>
                      <ChevronLeft size={14} aria-hidden="true" />
                      <Link href={levelHref}>{level.title}</Link>
                    </>
                  ) : null}
                  {section ? (
                    <>
                      <ChevronLeft size={14} aria-hidden="true" />
                      <Link href={sectionHref}>{section.title}</Link>
                    </>
                  ) : null}
                  <ChevronLeft size={14} aria-hidden="true" />
                  <span>{selected.title}</span>
                </nav>
                <div className="learner-lesson-progress-header">
                  <div className="learner-lesson-progress-meta">
                    <span className="learner-lesson-kind">
                      <BookOpen size={14} aria-hidden="true" />
                      {currentFlat?.group ?? 'محتوى الدورة'} · {kindLabels[selected.kind]}
                    </span>
                    <span className="learner-lesson-count">
                      الدرس {formatCount(Math.max(1, selectedIndex + 1))} من {formatCount(flatItems.length)}
                    </span>
                  </div>
                  <div
                    className="learner-lesson-progress-track"
                    role="progressbar"
                    aria-label="تقدّمك في المادة"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={selected.progress?.completed ? 100 : selected.progress?.progressPercent ?? 0}
                  >
                    <span style={{ width: `${selected.progress?.completed ? 100 : selected.progress?.progressPercent ?? 0}%` }} />
                  </div>
                </div>
              </>
            ) : (
              <div className="learner-video-backbar">
                <Link href={backHref}>
                  <ChevronRight size={17} aria-hidden="true" />
                  <span>العودة إلى الدروس</span>
                </Link>
                <span>{currentFlat?.group ?? 'محتوى الدورة'}</span>
              </div>
            )}
            <div
              className={`learner-content-layout learner-viewer-layout${isVideoContent ? ' learner-video-layout' : ''}`}
              onCopy={(event) => event.preventDefault()}
              onCut={(event) => event.preventDefault()}
              onDragStart={
                isNativeMediaContent
                  ? undefined
                  : (event) => event.preventDefault()
              }
            >
              <section className={`panel learner-material learner-material-${selected.kind}${isVideoContent ? ' learner-video-material' : ''}`}>
                {selected.kind === 'image' || selected.kind === 'audio' ? (
                  <div className="learner-material-header">
                    <div>
                      <div className="eyebrow">{kindLabels[selected.kind]}</div>
                      <h2>{selected.title}</h2>
                    </div>
                    {selected.progress?.completed ? (
                      <span className="course-status"><Check size={14} /> مكتملة</span>
                    ) : null}
                  </div>
                ) : null}
                {savingError && <InlineAlert>{savingError}</InlineAlert>}
                {['video', 'audio', 'image'].includes(selected.kind) ? (
                  mediaError ? (
                    <div className={`learner-media-frame learner-media-frame-${selected.kind}`}>
                      <div className="learner-media-placeholder">
                        <LockKeyhole size={25} />
                        <strong>{mediaError}</strong>
                        <button type="button" className="button-soft" onClick={retryMedia}>
                          <RefreshCw size={14} /> إعادة المحاولة
                        </button>
                      </div>
                    </div>
                  ) : !mediaIsReady ? (
                    <div className={`learner-media-frame learner-media-frame-${selected.kind}`}>
                      <div className="learner-media-placeholder">
                        <LockKeyhole size={23} />
                        <strong>جارٍ فتح المحتوى بأمان…</strong>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`learner-media-frame learner-media-frame-${selected.kind}`}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {selected.kind === 'video' ? (
                        <video
                          ref={videoRef}
                          src={mediaUrl}
                          poster={posterUrl || undefined}
                          controls
                          controlsList="nodownload noremoteplayback"
                          disablePictureInPicture
                          disableRemotePlayback
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            const progress = selected.progress?.positionSeconds ?? 0;
                            if (progress > 0) event.currentTarget.currentTime = progress;
                          }}
                          onTimeUpdate={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onPause={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onEnded={(event) => savePosition(
                            event.currentTarget.duration,
                            event.currentTarget.duration,
                            true,
                          )}
                        />
                      ) : null}
                      {selected.kind === 'audio' ? (
                        <div className="learner-audio-lesson">
                          <div className="learner-audio-stage">
                            <div className="learner-audio-emblem"><Headphones size={25} aria-hidden="true" /></div>
                            <div className="learner-audio-copy">
                              <span>جلسة استماع</span>
                              <strong>استمع بتركيز، وتابع من حيث توقفت</strong>
                              <small>{selected.durationSeconds ? `المدة ${formatTime(selected.durationSeconds)}` : 'يمكنك إيقاف الدرس والعودة إليه لاحقًا'}</small>
                            </div>
                            <div className="learner-audio-wave" aria-hidden="true">
                              {Array.from({ length: 17 }, (_, index) => <i key={index} style={{ height: `${12 + ((index * 7) % 23)}px` }} />)}
                            </div>
                          </div>
                          <audio
                            ref={audioRef}
                            src={mediaUrl}
                            controls
                            controlsList="nodownload noremoteplayback"
                            preload="metadata"
                            onLoadedMetadata={(event) => {
                              const progress = selected.progress?.positionSeconds ?? 0;
                              if (progress > 0) event.currentTarget.currentTime = progress;
                            }}
                            onTimeUpdate={(event) => savePosition(
                              event.currentTarget.currentTime,
                              Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                            )}
                            onPause={(event) => savePosition(
                              event.currentTarget.currentTime,
                              Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                            )}
                            onEnded={(event) => savePosition(
                              event.currentTarget.duration,
                              event.currentTarget.duration,
                              true,
                            )}
                          />
                        </div>
                      ) : null}
                      {selected.kind === 'image' ? (
                        <figure className="learner-image-figure">
                          <img src={mediaUrl} alt={selected.title} draggable={false} />
                          <figcaption>
                            <span>من أرشيف الفصل</span>
                            <strong>{selected.title}</strong>
                          </figcaption>
                        </figure>
                      ) : null}
                    </div>
                  )
                ) : selected.kind === 'text' ? (
                  <article className="learner-notebook" aria-label="دفتر الدرس">
                    <header className="learner-notebook-header">
                      <div className="learner-notebook-brand">
                        <span className="learner-notebook-seal"><BookOpen size={19} aria-hidden="true" /></span>
                        <span><small>دفتر الفصل</small><strong>{currentFlat?.group ?? 'ملاحظات المادة'}</strong></span>
                      </div>
                      <span className="learner-notebook-page">صفحة {formatCount(Math.max(1, selectedIndex + 1))}</span>
                    </header>
                    <h2 className="learner-notebook-title">{selected.title}</h2>
                    <div className="learner-notebook-paper">
                      <div className="learner-notebook-body">
                        {selected.body || 'ابدأ بالقراءة بهدوء، ثم علّم المادة مكتملة عندما تنتهي.'}
                      </div>
                    </div>
                    <footer className="learner-notebook-footer">
                      <span>اقرأ على مهل، واكتب ملاحظاتك في دفترك.</span>
                      <span>{selected.progress?.completed ? 'تمت المراجعة' : 'خطوة واحدة أقرب إلى هدفك'}</span>
                    </footer>
                  </article>
                ) : selected.kind === 'note' ? (
                  <article className="learner-study-note">
                    <span className="learner-note-label">ملاحظة من الفصل</span>
                    <h2>{selected.title}</h2>
                    <div className="learner-note-body">
                      {selected.body || 'احتفظ بهذه الملاحظة للعودة إليها أثناء المراجعة.'}
                    </div>
                    <div className="learner-note-signoff"><CheckCircle2 size={15} aria-hidden="true" /> نقطة تستحق التذكّر</div>
                  </article>
                ) : (
                  null
                )}
                {isVideoContent ? (
                  <div className="learner-material-header learner-video-title">
                    <div>
                      <div className="eyebrow">
                        {currentFlat?.group ?? 'محتوى الدورة'} · {kindLabels[selected.kind]}
                      </div>
                      <h2>{selected.title}</h2>
                    </div>
                    {selected.progress?.completed ? (
                      <span className="course-status"><Check size={14} /> مكتملة</span>
                    ) : null}
                  </div>
                ) : null}
                {selected.supplementalNote?.trim() ? (
                  <aside className="learner-supplemental-note">
                    <strong>ملاحظة إضافية</strong>
                    <p>{selected.supplementalNote}</p>
                  </aside>
                ) : null}
                {selected.kind === 'video' && selected.progress?.positionSeconds ? (
                  <p className="course-muted-note">
                    آخر موضع وصلت إليه: {formatTime(selected.progress.positionSeconds)}
                    {selected.progress.durationSeconds
                      ? ` من ${formatTime(selected.progress.durationSeconds)}`
                      : ''}
                  </p>
                ) : null}
                <div className="learner-material-actions">
                  <span className="course-muted-note">تعلّم بترتيبك، وتقدّمك محفوظ تلقائيًا.</span>
                  <button
                    type="button"
                    className={`button-primary learner-done-button ${selected.progress?.completed ? 'done' : ''}`}
                    disabled={saveProgress.isPending}
                    onClick={() => markComplete(selected)}
                  >
                    {selected.progress?.completed ? (
                      <><CheckCircle2 size={16} /> مكتملة</>
                    ) : (
                      <><Check size={16} /> علّمها مكتملة</>
                    )}
                  </button>
                </div>
              </section>
            </div>
            <nav className="learner-lesson-navigation" aria-label="التنقل بين الدروس">
              {previousLesson ? (
                <Link className="learner-lesson-nav-link is-previous" href={getFlatItemHref(course.id, previousLesson)}>
                  <ChevronRight size={18} aria-hidden="true" />
                  <span><small>الدرس السابق</small><strong>{previousLesson.item.title}</strong></span>
                </Link>
              ) : (
                <span className="learner-lesson-nav-placeholder" />
              )}
              {nextLesson ? (
                <Link className="learner-lesson-nav-link is-next" href={getFlatItemHref(course.id, nextLesson)}>
                  <span><small>التالي في المقرر</small><strong>{nextLesson.item.title}</strong></span>
                  <ChevronLeft size={18} aria-hidden="true" />
                </Link>
              ) : (
                <Link className="learner-lesson-nav-finish" href={courseHref}>
                  <CheckCircle2 size={17} aria-hidden="true" />
                  <span>العودة إلى خطة المقرر</span>
                  <ArrowLeft size={16} aria-hidden="true" />
                </Link>
              )}
            </nav>
          </>
        )}
      </div>
    </AppShell>
  );
}
