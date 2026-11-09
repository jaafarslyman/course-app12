import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LearnerIdentity } from '@/lib/learner-session';
import { callRpc, hasSupabaseConfig, requireSupabase } from '@/lib/supabase';
import { learnerCatalogQueryKey, learnerCourseQueryKey } from '@/lib/course-api';

type LearnerSessionStatus = 'checking' | 'signed-in' | 'signed-out' | 'error';
type LearnerSessionContextValue = {
  learner: LearnerIdentity | null;
  status: LearnerSessionStatus;
  refresh: () => Promise<void>;
};
const LearnerSessionContext = createContext<LearnerSessionContextValue | null>(null);

export function LearnerSessionProvider({ children }: { children: ReactNode }) {
  const [learner, setLearner] = useState<LearnerIdentity | null>(null);
  const [status, setStatus] = useState<LearnerSessionStatus>('checking');
  const queryClient = useQueryClient();
  const authUserId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setLearner(null);
      setStatus('signed-out');
      return;
    }
    try {
      const { data, error } = await requireSupabase().auth.getSession();
      if (error) throw error;
      if (!data.session) {
        authUserId.current = null;
        setLearner(null);
        setStatus('signed-out');
        return;
      }
      authUserId.current = data.session.user.id;
      const profile = await callRpc<LearnerIdentity | null>('learner_current_profile');
      setLearner(profile);
      setStatus(profile ? 'signed-in' : 'signed-out');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setStatus('signed-out');
      return;
    }
    void refresh();
    const { data: { subscription } } = requireSupabase().auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId !== authUserId.current) {
        authUserId.current = nextUserId;
        setLearner(null);
        setStatus('checking');
        void queryClient.cancelQueries({ queryKey: learnerCourseQueryKey });
        queryClient.removeQueries({ queryKey: learnerCourseQueryKey });
        queryClient.removeQueries({ queryKey: learnerCatalogQueryKey });
      }
      window.setTimeout(() => void refresh(), 0);
    });
    return () => subscription.unsubscribe();
  }, [queryClient, refresh]);

  return (
    <LearnerSessionContext.Provider value={{ learner, status, refresh }}>
      {children}
    </LearnerSessionContext.Provider>
  );
}

export function useLearnerSession() {
  const value = useContext(LearnerSessionContext);
  if (!value) throw new Error('useLearnerSession must be used inside LearnerSessionProvider');
  return value;
}
