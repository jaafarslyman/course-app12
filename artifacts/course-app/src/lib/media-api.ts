import { useMutation } from '@tanstack/react-query';
import {
  createCourseMediaSignedUrl,
  type CourseMediaSignedUrlInput,
} from '@workspace/api-client-react';
import { requireSupabase } from '@/lib/supabase';

export function useCreateCourseMediaSignedUrl() {
  return useMutation({
    mutationKey: ['createCourseMediaSignedUrl'],
    mutationFn: async ({ data }: { data: CourseMediaSignedUrlInput }) => {
      const { data: sessionData, error } =
        await requireSupabase().auth.getSession();
      if (error) throw error;
      if (!sessionData.session) throw new Error('authentication_required');

      return createCourseMediaSignedUrl(data, {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });
    },
  });
}
