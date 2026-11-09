import { createClient } from "@supabase/supabase-js";
import { Router, type IRouter } from "express";
import {
  CreateCourseMediaSignedUrlBody,
  CreateCourseMediaSignedUrlResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const COURSE_MEDIA_BUCKET = "course-media";

function readSupabaseConfig() {
  const url = process.env["VITE_SUPABASE_URL"]?.trim();
  const anonKey = process.env["VITE_SUPABASE_ANON_KEY"]?.trim();
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  return { url, anonKey, serviceRoleKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

router.post("/course-media/signed-url", async (req, res): Promise<void> => {
  const parsed = CreateCourseMediaSignedUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const authorization = req.header("authorization");
  const tokenMatch = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!tokenMatch) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }

  const { url, anonKey, serviceRoleKey } = readSupabaseConfig();
  if (!url || !anonKey || !serviceRoleKey) {
    req.log.error("Course media signing is not configured");
    res.status(503).json({ error: "media_signing_unavailable" });
    return;
  }

  try {
    const identityClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: identity, error: identityError } =
      await identityClient.auth.getUser(tokenMatch[1]);
    if (identityError || !identity.user) {
      res.status(401).json({ error: "invalid_authentication" });
      return;
    }

    const authorizationClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    });

    const { data: permission, error: permissionError } =
      await authorizationClient.rpc("course_media_path", {
        p_content_id: parsed.data.contentId,
        p_media_type: parsed.data.mediaType ?? "content",
      });

    if (
      permissionError ||
      !isRecord(permission) ||
      permission["ok"] !== true ||
      typeof permission["storagePath"] !== "string"
    ) {
      if (permissionError) {
        req.log.warn(
          { code: permissionError.code },
          "Course media access was rejected",
        );
      }
      res.status(403).json({ error: "media_access_denied" });
      return;
    }

    const storagePath = permission["storagePath"];
    if (
      storagePath.length > 255 ||
      storagePath.startsWith("/") ||
      storagePath.split("/").includes("..")
    ) {
      req.log.error("Course media path failed validation");
      res.status(403).json({ error: "media_access_denied" });
      return;
    }

    const mediaClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: signedMedia, error: signingError } = await mediaClient.storage
      .from(COURSE_MEDIA_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signingError || !signedMedia?.signedUrl) {
      req.log.error(
        { statusCode: signingError?.statusCode },
        "Unable to sign course media URL",
      );
      res.status(500).json({ error: "media_signing_failed" });
      return;
    }

    const response = CreateCourseMediaSignedUrlResponse.parse({
      signedUrl: signedMedia.signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
    res.status(200).json(response);
  } catch (error) {
    req.log.error(
      {
        error:
          error instanceof Error ? error.name : "unknown_course_media_error",
      },
      "Course media signing request failed",
    );
    res.status(500).json({ error: "media_signing_failed" });
  }
});

export default router;
