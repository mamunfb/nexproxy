import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createCleanupTracker,
  deleteAbandonedPendingMessages,
  sweepExpiredFiles,
  sweepOldTombstones,
  sweepStalePendingRows,
  sweepTemporaryRows,
  UPLOAD_COMPLETION_GRACE_MS,
} from "./cleanup-helpers.mjs";

const BUCKET = "support-chat";
const BATCH_LIMIT = 200;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, { success: false, error: "Method not allowed." });
  const expected = Deno.env.get("SUPPORT_CHAT_CLEANUP_SECRET") || "";
  const supplied = req.headers.get("x-support-chat-cleanup-secret") || "";
  if (!expected || expected.length > 512 || supplied.length > 512 || !safeEqual(expected, supplied)) {
    return response(401, { success: false, error: "Unauthorized." });
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) return response(500, { success: false, error: "Server configuration is incomplete." });
  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const oneMinuteAgo = new Date(now - 60_000).toISOString();
  const pendingCutoff = new Date(now - 60 * 60 * 1000).toISOString();
  const uploadCleanupCutoffIso = new Date(now - UPLOAD_COMPLETION_GRACE_MS).toISOString();
  const tracker = createCleanupTracker();
  let tempPathsSwept = 0;
  let pendingUploadsExpired = 0;
  let finalFilesExpired = 0;
  let tombstonesDeleted = 0;
  let abandonedMessagesDeleted = 0;

  try {
    const sweepFilter = `temporary_last_swept_at.is.null,temporary_last_swept_at.lt.${oneMinuteAgo}`;

    // Sweep old upload capabilities. Once the 2-hour token plus a one-hour in-flight
    // request grace ends, clear the path so ready rows are not swept forever.
    const { data: readyOrExpired, error: readyError } = await admin.from("support_chat_attachments")
      .select("id,temporary_path,status,upload_token_expires_at")
      .in("status", ["ready", "expired"])
      .not("temporary_path", "is", null)
      .or(sweepFilter)
      .order("temporary_last_swept_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_LIMIT);
    if (readyError) throw readyError;
    const temporaryRows = readyOrExpired || [];
    if (temporaryRows.length === BATCH_LIMIT) tracker.backlogPossible = true;
    tempPathsSwept += await sweepTemporaryRows(admin, temporaryRows, nowIso, now, tracker);

    // Pending messages that were never finalized expire after one hour. Also remove a
    // possible partial final object if the server moved a file before a failed DB update.
    const { data: stalePending, error: pendingError } = await admin.from("support_chat_attachments")
      .select("id,message_id,temporary_path,created_at")
      .eq("status", "pending")
      .lte("created_at", pendingCutoff)
      .or(sweepFilter)
      .order("temporary_last_swept_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_LIMIT);
    if (pendingError) throw pendingError;
    const stalePendingRows = stalePending || [];
    if (stalePendingRows.length === BATCH_LIMIT) tracker.backlogPossible = true;
    const pendingSweep = await sweepStalePendingRows(admin, stalePendingRows, nowIso, pendingCutoff, tracker);
    tempPathsSwept += pendingSweep.swept;
    pendingUploadsExpired += pendingSweep.expired;

    // Delete visible files at their 60-minute deadline before erasing their metadata.
    const { data: expiredFiles, error: expiredFileError } = await admin.from("support_chat_attachments")
      .select("id,temporary_path,final_path")
      .eq("status", "ready")
      .lte("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (expiredFileError) throw expiredFileError;
    const expiredRows = expiredFiles || [];
    if (expiredRows.length === BATCH_LIMIT) tracker.backlogPossible = true;
    finalFilesExpired += await sweepExpiredFiles(admin, expiredRows, nowIso, tracker);

    // Keep an expired tombstone until the token is definitely dead and any in-flight
    // standard PUT has had time to finish; sweep once more, then delete it.
    const { data: oldRows, error: oldError } = await admin.from("support_chat_attachments")
      .select("id,temporary_path,upload_token_expires_at,temporary_last_swept_at")
      .eq("status", "expired")
      .lte("upload_token_expires_at", uploadCleanupCutoffIso)
      .not("temporary_last_swept_at", "is", null)
      .order("upload_token_expires_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (oldError) throw oldError;
    const oldTombstones = oldRows || [];
    if (oldTombstones.length === BATCH_LIMIT) tracker.backlogPossible = true;
    tombstonesDeleted += await sweepOldTombstones(admin, oldTombstones, tracker);

    const abandonedMessages = await deleteAbandonedPendingMessages(admin, pendingCutoff, tracker);
    abandonedMessagesDeleted = abandonedMessages.deleted;
    tracker.backlogPossible ||= abandonedMessages.backlogPossible;

    if (tracker.cleanupFailures > 0) {
      console.warn("support-chat-cleanup encountered item-level failures", tracker.cleanupFailures);
    }
    if (tracker.blockedMessages > 0) {
      console.warn("support-chat-cleanup deferred abandoned messages with active storage paths", tracker.blockedMessages);
    }
    return response(200, {
      success: true,
      tempPathsSwept,
      pendingUploadsExpired,
      finalFilesExpired,
      tombstonesDeleted,
      abandonedMessagesDeleted,
      cleanupFailures: tracker.cleanupFailures,
      blockedMessages: tracker.blockedMessages,
      backlogPossible: tracker.backlogPossible,
    });
  } catch (error) {
    console.error("support-chat-cleanup failed", error instanceof Error ? error.name : "Error");
    return response(500, { success: false, error: "Cleanup could not be completed." });
  }
});
