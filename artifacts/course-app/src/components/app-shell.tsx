import { useEffect, type ReactNode } from 'react';
import {
  BookOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  UsersRound,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { requireSupabase } from '@/lib/supabase';

const adminNavigation = [
  { href: '/admin', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/admin/students', label: 'الطلاب', icon: UsersRound },
  { href: '/admin/courses', label: 'هيكل الدورة', icon: BookOpen },
];

const learnerNavigation = [
  { href: '/learn', label: 'الرئيسية', icon: LayoutDashboard },
  { href: '/learn/course', label: 'الدورات', icon: BookOpen },
];

type AppShellProps = {
  children: ReactNode;
  title: string;
  audience?: 'admin' | 'learner';
  onSignOut?: () => void;
  fullScreen?: boolean;
};

export function AppShell({
  children,
  title,
  audience = 'admin',
  onSignOut,
  fullScreen = false,
}: AppShellProps) {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (audience !== 'learner') return;

    const blockBrowserCaptureAction = (event: Event) => {
      const target = event.target;
      if (
        event.type === 'dragstart' &&
        target instanceof Element &&
        target.closest('video, audio')
      ) {
        return;
      }
      event.preventDefault();
    };
    const blockCaptureShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      const printScreen = key === 'printscreen';
      const browserShortcut = command && ['c', 'p', 's', 'u'].includes(key);
      const macScreenshotShortcut =
        event.metaKey && event.shiftKey && ['3', '4', '5'].includes(key);

      if (printScreen || browserShortcut || macScreenshotShortcut) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pauseHiddenMedia = () => {
      if (document.visibilityState !== 'hidden') return;
      document
        .querySelectorAll<HTMLVideoElement | HTMLAudioElement>(
          '.learner-capture-deterrents video, .learner-capture-deterrents audio',
        )
        .forEach((media) => media.pause());
    };

    document.addEventListener('contextmenu', blockBrowserCaptureAction, true);
    document.addEventListener('copy', blockBrowserCaptureAction, true);
    document.addEventListener('cut', blockBrowserCaptureAction, true);
    document.addEventListener('dragstart', blockBrowserCaptureAction, true);
    document.addEventListener('keydown', blockCaptureShortcuts, true);
    document.addEventListener('visibilitychange', pauseHiddenMedia);

    return () => {
      document.removeEventListener('contextmenu', blockBrowserCaptureAction, true);
      document.removeEventListener('copy', blockBrowserCaptureAction, true);
      document.removeEventListener('cut', blockBrowserCaptureAction, true);
      document.removeEventListener('dragstart', blockBrowserCaptureAction, true);
      document.removeEventListener('keydown', blockCaptureShortcuts, true);
      document.removeEventListener('visibilitychange', pauseHiddenMedia);
    };
  }, [audience]);

  const navigation =
    audience === 'learner' ? learnerNavigation : adminNavigation;
  const isActive = (href: string) =>
    location === href ||
    (href !== '/admin' && href !== '/learn' && location.startsWith(`${href}/`)) ||
    (href === '/learn/course' && (location.startsWith('/learn/course/') || location === '/learn/content'));
  const handleSignOut =
    onSignOut ??
    (async () => {
      await requireSupabase().auth.signOut();
      setLocation(audience === 'admin' ? '/admin/sign-in' : '/');
    });

  return (
    <div className={`app-shell admin-layout${fullScreen ? ' full-screen-shell' : ''}${audience === 'learner' ? ' learner-capture-deterrents' : ''}`}>
      <aside className="sidebar">
        <AppLogo />
        <nav className="nav-list" aria-label="التنقّل الرئيسي">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${isActive(href) ? 'active' : ''}`}
              data-testid={`link-${href.replaceAll('/', '-').slice(1)}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-bottom-title">
            {audience === 'admin' ? (
              <KeyRound size={17} aria-hidden="true" />
            ) : (
              <BookOpen size={17} aria-hidden="true" />
            )}
            {audience === 'admin' ? 'إدارة آمنة' : 'رحلتك التعليمية'}
          </div>
          <div>
              {audience === 'admin'
                ? 'رمز مستقل لكل دورة، وبيانات الحساب تبقى خاصة.'
                : 'صلاحياتك للدورات تبقى محفوظة بعد تسجيل الخروج.'}
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              {audience === 'admin' ? 'مساحة الإدارة' : 'مساحة المتعلّم'}
            </div>
            <div className="topbar-title">{title}</div>
          </div>
          {handleSignOut && (
            <button
              type="button"
              className="button-soft signout-button"
              onClick={() => void handleSignOut()}
              data-testid={audience === 'admin' ? 'button-admin-signout' : 'button-learner-signout'}
            >
              <LogOut size={16} aria-hidden="true" />
              تسجيل الخروج
            </button>
          )}
        </header>
        <main className="content-wrap animate-in">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="التنقّل الرئيسي">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-link ${isActive(href) ? 'active' : ''}`}
            data-testid={`mobile-link-${href.replaceAll('/', '-').slice(1)}`}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AppLogo() {
  return (
    <div className="brand" data-testid="brand-logo">
      <span className="brand-mark" aria-hidden="true">
        L.
      </span>
      <span>
        لُغتي <span className="brand-accent">بثقة</span>
      </span>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = BookOpen,
}: {
  title: string;
  description: string;
  icon?: typeof BookOpen;
}) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-icon">
        <Icon size={22} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="config-notice" role="status" data-testid="status-supabase-config">
      <KeyRound size={17} aria-hidden="true" />
      <span>
        أضف <code>VITE_SUPABASE_URL</code> و
        <code> VITE_SUPABASE_ANON_KEY</code> إلى إعدادات البيئة لربط Supabase.
      </span>
    </div>
  );
}

export function InlineAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
}) {
  return (
    <div
      className={`inline-alert ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={`status-${tone}`}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status" data-testid="status-loading">
      <span className="loading-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
