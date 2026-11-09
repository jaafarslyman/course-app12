import { createClient } from "@supabase/supabase-js";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateAdminLearnerBody,
  CreateAdminLearnerResponse,
  DeleteAdminLearnerParams,
  DeleteAdminLearnerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function readSupabaseConfig() {
  const url = process.env["VITE_SUPABASE_URL"]?.trim();
  const anonKey = process.env["VITE_SUPABASE_ANON_KEY"]?.trim();
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  return { url, anonKey, serviceRoleKey };
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function authorizeAdmin(
  req: Request,
  res: Response,
): Promise<
  | { ok: true; adminUserId: string; url: string; anonKey: string; serviceRoleKey: string }
  | { ok: false }
> {
  const token = bearerToken(req.header("authorization"));
  if (!token) {
    res.status(401).json({ error: "authentication_required" });
    return { ok: false };
  }

  const { url, anonKey, serviceRoleKey } = readSupabaseConfig();
  if (!url || !anonKey || !serviceRoleKey) {
    req.log.error("Supabase learner administration is not configured");
    res.status(503).json({ error: "learner_administration_unavailable" });
    return { ok: false };
  }

  try {
    const authClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) {
      res.status(401).json({ error: "invalid_authentication" });
      return { ok: false };
    }

    const scopedClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    const { data: isAdmin, error: adminError } =
      await scopedClient.rpc("is_course_admin");
    if (adminError) {
      req.log.warn(
        { code: adminError.code },
        "Unable to confirm administrator permissions",
      );
      res.status(403).json({ error: "administrator_required" });
      return { ok: false };
    }
    if (isAdmin !== true) {
      res.status(403).json({ error: "administrator_required" });
      return { ok: false };
    }

    return { ok: true, adminUserId: userData.user.id, url, anonKey, serviceRoleKey };
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.name : "unknown_auth_error" },
      "Learner administration authentication failed",
    );
    res.status(500).json({ error: "learner_administration_failed" });
    return { ok: false };
  }
}

router.post("/admin/learners", async (req, res): Promise<void> => {
  const parsed = CreateAdminLearnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const authorization = await authorizeAdmin(req, res);
  if (!authorization.ok) return;

  const { name, email: rawEmail, password } = parsed.data;
  const email = rawEmail.trim().toLowerCase();
  const learnerName = name.trim();
  if (!learnerName || !email) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const adminClient = createClient(
    authorization.url,
    authorization.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );

  let createdAuthUserId: string | undefined;
  try {
    const { data: existingLearner, error: lookupError } = await adminClient
      .from("course_learners")
      .select("id, auth_user_id")
      .ilike("email", escapeLikePattern(email))
      .maybeSingle();

    if (lookupError) {
      req.log.error({ code: lookupError.code }, "Unable to look up learner account");
      res.status(500).json({ error: "learner_creation_failed" });
      return;
    }
    if (existingLearner?.auth_user_id) {
      res.status(409).json({ error: "learner_email_exists" });
      return;
    }

    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: learnerName },
      });

    if (authError || !authData.user) {
      const code = authError?.code ?? "";
      if (
        code === "email_exists" ||
        code === "user_already_exists" ||
        code === "email_address_not_authorized"
      ) {
        res.status(409).json({ error: "learner_email_exists" });
        return;
      }
      req.log.error(
        { code: code || "unknown_auth_admin_error" },
        "Unable to create learner authentication account",
      );
      res.status(500).json({ error: "learner_creation_failed" });
      return;
    }

    createdAuthUserId = authData.user.id;

    const profileQuery = existingLearner
      ? adminClient
          .from("course_learners")
          .update({
            name: learnerName,
            email,
            auth_user_id: authData.user.id,
          })
          .eq("id", existingLearner.id)
      : adminClient.from("course_learners").insert({
          name: learnerName,
          email,
          auth_user_id: authData.user.id,
          created_by: authorization.adminUserId,
        });

    const { data: profile, error: profileError } = await profileQuery
      .select("id, name, email, created_at")
      .single();

    if (profileError || !profile) {
      await adminClient.auth.admin.deleteUser(authData.user.id);
      createdAuthUserId = undefined;
      if (profileError?.code === "23505") {
        res.status(409).json({ error: "learner_email_exists" });
        return;
      }
      req.log.error(
        { code: profileError?.code ?? "missing_learner_profile" },
        "Unable to create learner profile",
      );
      res.status(500).json({ error: "learner_creation_failed" });
      return;
    }

    // From this point the Auth user is linked to a durable learner profile.
    // Keep the pair intact if response serialization fails.
    createdAuthUserId = undefined;
    const response = CreateAdminLearnerResponse.parse({
      learner: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        createdAt: profile.created_at,
      },
    });
    res.status(201).json(response);
  } catch (error) {
    if (createdAuthUserId) {
      await adminClient.auth.admin.deleteUser(createdAuthUserId);
    }
    req.log.error(
      { error: error instanceof Error ? error.name : "unknown_learner_creation_error" },
      "Learner account creation failed",
    );
    res.status(500).json({ error: "learner_creation_failed" });
  }
});

router.delete("/admin/learners/:learnerId", async (req, res): Promise<void> => {
  const parsed = DeleteAdminLearnerParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_learner_id" });
    return;
  }

  const authorization = await authorizeAdmin(req, res);
  if (!authorization.ok) return;

  const adminClient = createClient(
    authorization.url,
    authorization.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );

  try {
    const { data: learner, error: lookupError } = await adminClient
      .from("course_learners")
      .select("id, auth_user_id")
      .eq("id", parsed.data.learnerId)
      .maybeSingle();

    if (lookupError) {
      req.log.error({ code: lookupError.code }, "Unable to look up learner");
      res.status(500).json({ error: "learner_deletion_failed" });
      return;
    }
    if (!learner) {
      res.status(404).json({ error: "learner_not_found" });
      return;
    }

    if (learner.auth_user_id) {
      const { error: deleteAuthError } =
        await adminClient.auth.admin.deleteUser(learner.auth_user_id);
      if (deleteAuthError) {
        req.log.error(
          { code: deleteAuthError.code },
          "Unable to delete learner authentication account",
        );
        res.status(500).json({ error: "learner_deletion_failed" });
        return;
      }
    } else {
      const { error: deleteProfileError } = await adminClient
        .from("course_learners")
        .delete()
        .eq("id", learner.id);
      if (deleteProfileError) {
        req.log.error(
          { code: deleteProfileError.code },
          "Unable to delete legacy learner profile",
        );
        res.status(500).json({ error: "learner_deletion_failed" });
        return;
      }
    }

    res.status(200).json(DeleteAdminLearnerResponse.parse({ ok: true }));
  } catch (error) {
    req.log.error(
      { error: error instanceof Error ? error.name : "unknown_learner_deletion_error" },
      "Learner account deletion failed",
    );
    res.status(500).json({ error: "learner_deletion_failed" });
  }
});

export default router;
