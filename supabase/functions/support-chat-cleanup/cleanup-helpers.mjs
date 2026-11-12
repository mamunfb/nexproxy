export const UPLOAD_COMPLETION_GRACE_MS = 60 * 60 * 1000;
const BUCKET = "support-chat";
const BATCH_LIMIT = 200;

export function createCleanupTracker() {
  return { cleanupFailures: 0, blockedMessages: 0, backlogPossible: false };
}

function markFailure(tracker) {
  tracker.cleanupFailures += 1;
  tracker.backlogPossible = true;
}

function markBlocked(tracker) {
  tracker.blockedMessages += 1;
  tracker.backlogPossible = true;
}

function isNotFound(error) {
  return /not found|does not exist|object not found/i.test(String(error?.message || ""));
}

export async function removeIfPresent(admin, path, tracker) {
  if (path == null) return true;
  if (typeof path !== "string" || !(path.startsWith("pending/") || path.startsWith("files/"))) {
    markFailure(tracker);
    return false;
  }
  try {
    const { error } = await admin.storage.from(BUCKET).remove([path]);
    if (!error || isNotFound(error)) return true;
  } catch (_) {
    // Treat a thrown network/storage error like a returned error and retry next Cron.
  }
  markFailure(tracker);
  return false;
}

async function applyDatabaseMutation(query, tracker) {
  try {
    const { error } = await query;
    if (!error) return true;
  } catch (_) {
    // A transient database exception must remain visible to the next cleanup run.
  }
  markFailure(tracker);
  return false;
}

export async function sweepTemporaryRows(admin, rows, nowIso, cleanupCutoff, tracker) {
  let swept = 0;
  for (const row of rows) {
    if (!await removeIfPresent(admin, row.temporary_path, tracker)) continue;
    const uploadCapabilityEnded = Date.parse(row.upload_token_expires_at) + UPLOAD_COMPLETION_GRACE_MS <= cleanupCutoff;
    const update = uploadCapabilityEnded
      ? { temporary_path: null, temporary_last_swept_at: nowIso }
      : { temporary_last_swept_at: nowIso };
    const updated = await applyDatabaseMutation(
      admin.from("support_chat_attachments").update(update).eq("id", row.id).eq("status", row.status),
      tracker,
    );
    if (updated) swept++;
  }
  return swept;
}

export async function sweepStalePendingRows(admin, rows, nowIso, pendingCutoff, tracker) {
  if (!rows.length) return { swept: 0, expired: 0 };
  const messageIds = [...new Set(rows.map((row) => row.message_id))];
  const { data: messages, error: messageError } = await admin.from("support_chat_messages")
    .select("id,thread_id").in("id", messageIds).limit(BATCH_LIMIT);
  if (messageError) throw messageError;
  const threadByMessage = new Map((messages || []).map((message) => [message.id, message.thread_id]));
  let swept = 0;
  let expired = 0;
  for (const row of rows) {
    const threadId = threadByMessage.get(row.message_id);
    const partialFinalPath = threadId ? `files/${threadId}/${row.id}` : null;
    const temporaryRemoved = await removeIfPresent(admin, row.temporary_path, tracker);
    const partialFinalRemoved = await removeIfPresent(admin, partialFinalPath, tracker);
    if (!temporaryRemoved || !partialFinalRemoved) continue;
    const updated = await applyDatabaseMutation(admin.from("support_chat_attachments").update({
      status: "expired",
      display_name: null,
      mime_type: null,
      size_bytes: null,
      final_path: null,
      temporary_last_swept_at: nowIso,
    }).eq("id", row.id).eq("status", "pending").lte("created_at", pendingCutoff), tracker);
    if (updated) {
      swept++;
      expired++;
    }
  }
  return { swept, expired };
}

export async function sweepExpiredFiles(admin, rows, nowIso, tracker) {
  let expired = 0;
  for (const row of rows) {
    const finalRemoved = await removeIfPresent(admin, row.final_path, tracker);
    const tempRemoved = await removeIfPresent(admin, row.temporary_path, tracker);
    if (!finalRemoved || !tempRemoved) continue;
    const updated = await applyDatabaseMutation(admin.from("support_chat_attachments").update({
      status: "expired",
      display_name: null,
      mime_type: null,
      size_bytes: null,
      final_path: null,
      temporary_last_swept_at: nowIso,
    }).eq("id", row.id).eq("status", "ready"), tracker);
    if (updated) expired++;
  }
  return expired;
}

export async function sweepOldTombstones(admin, rows, tracker) {
  let deleted = 0;
  for (const row of rows) {
    const requiredSweepAt = Date.parse(row.upload_token_expires_at) + UPLOAD_COMPLETION_GRACE_MS;
    if (Date.parse(row.temporary_last_swept_at) < requiredSweepAt) continue;
    if (!await removeIfPresent(admin, row.temporary_path, tracker)) continue;
    const removed = await applyDatabaseMutation(
      admin.from("support_chat_attachments").delete().eq("id", row.id).eq("status", "expired"),
      tracker,
    );
    if (removed) deleted++;
  }
  return deleted;
}

export async function deleteAbandonedPendingMessages(admin, pendingCutoff, tracker) {
  const { data: messages, error } = await admin.from("support_chat_messages")
    .select("id")
    .eq("status", "pending")
    .lte("created_at", pendingCutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) throw error;
  if (!messages?.length) return { deleted: 0, backlogPossible: false };

  const ids = messages.map((message) => message.id);
  const { data: attachments, error: attachmentError } = await admin.from("support_chat_attachments")
    .select("message_id,temporary_path,final_path").in("message_id", ids).limit(BATCH_LIMIT * 5);
  if (attachmentError) throw attachmentError;
  const messagesWithStoragePaths = new Set((attachments || [])
    .filter((row) => row.temporary_path || row.final_path)
    .map((row) => row.message_id));

  let deleted = 0;
  for (const message of messages) {
    // Keep the pending message until any upload token/path has been swept; path-free
    // expired attachment rows are safe to cascade-delete with their abandoned message.
    if (messagesWithStoragePaths.has(message.id)) {
      markBlocked(tracker);
      continue;
    }
    const removed = await applyDatabaseMutation(admin.from("support_chat_messages")
      .delete().eq("id", message.id).eq("status", "pending").lte("created_at", pendingCutoff), tracker);
    if (removed) deleted++;
  }
  return { deleted, backlogPossible: messages.length === BATCH_LIMIT || tracker.blockedMessages > 0 };
}
