import {
  createAdminLearner,
  deleteAdminLearner,
} from '@workspace/api-client-react';
import { requireSupabase } from '@/lib/supabase';

type CreateLearnerInput = Parameters<typeof createAdminLearner>[0];

async function authenticatedRequestOptions() {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('admin_auth_required');

  return {
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
    },
  };
}

export async function createLearnerAccount(input: CreateLearnerInput) {
  return createAdminLearner(input, await authenticatedRequestOptions());
}

export async function deleteLearnerAccount(learnerId: string) {
  return deleteAdminLearner(
    learnerId,
    await authenticatedRequestOptions(),
  );
}
