import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCleanupTracker,
  deleteAbandonedPendingMessages,
  sweepExpiredFiles,
  sweepTemporaryRows,
} from "../supabase/functions/support-chat-cleanup/cleanup-helpers.mjs";

function mockCleanupAdmin({ storageResults = [], queryResults = [] } = {}) {
  let storageIndex = 0;
  let queryIndex = 0;
  let updateCalls = 0;
  let deleteCalls = 0;
  const admin = {
    storage: {
      from() {
        return {
          async remove() {
            const result = storageResults[storageIndex++] ?? { error: null };
            if (result instanceof Error) throw result;
            return result;
          },
        };
      },
    },
    from() {
      const builder = {
        select() { return builder; },
        update() { updateCalls++; return builder; },
        delete() { deleteCalls++; return builder; },
        eq() { return builder; },
        lte() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        in() { return builder; },
        then(resolve, reject) {
          const result = queryResults[queryIndex++] ?? { data: [], error: null };
          const promise = result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
          return promise.then(resolve, reject);
        },
      };
      return builder;
    },
    calls() { return { updateCalls, deleteCalls, storageIndex, queryIndex }; },
  };
  return admin;
}

const temporaryRow = {
  id: "attachment-1",
  temporary_path: "pending/thread-1/attachment-1",
  status: "ready",
  upload_token_expires_at: "2026-11-08T00:00:00.000Z",
};

 test("storage removal failure is visible as retryable backlog and skips metadata mutation", async () => {
  const admin = mockCleanupAdmin({
    storageResults: [{ error: { message: "temporary storage outage" } }],
  });
  const tracker = createCleanupTracker();

  const swept = await sweepTemporaryRows(admin, [temporaryRow], "2026-11-08T04:00:00.000Z", Date.parse("2026-11-08T04:00:00.000Z"), tracker);

  assert.equal(swept, 0);
  assert.equal(tracker.cleanupFailures, 1);
  assert.equal(tracker.backlogPossible, true);
  assert.equal(admin.calls().updateCalls, 0);
});

test("failed metadata update is reported and the same row succeeds on a later retry", async () => {
  const nowIso = "2026-11-08T04:00:00.000Z";
  const cleanupCutoff = Date.parse(nowIso);
  const firstTracker = createCleanupTracker();
  const firstAdmin = mockCleanupAdmin({
    storageResults: [{ error: null }],
    queryResults: [{ error: { message: "temporary database outage" } }],
  });

  assert.equal(await sweepTemporaryRows(firstAdmin, [temporaryRow], nowIso, cleanupCutoff, firstTracker), 0);
  assert.equal(firstTracker.cleanupFailures, 1);
  assert.equal(firstTracker.backlogPossible, true);

  const retryTracker = createCleanupTracker();
  const retryAdmin = mockCleanupAdmin({
    storageResults: [{ error: { message: "Object not found" } }],
    queryResults: [{ error: null }],
  });
  assert.equal(await sweepTemporaryRows(retryAdmin, [temporaryRow], nowIso, cleanupCutoff, retryTracker), 1);
  assert.equal(retryTracker.cleanupFailures, 0);
  assert.equal(retryTracker.backlogPossible, false);
});

test("abandoned-message database delete failure is reported and can be retried", async () => {
  const cutoff = "2026-11-08T03:00:00.000Z";
  const firstAdmin = mockCleanupAdmin({
    queryResults: [
      { data: [{ id: "message-1" }], error: null },
      { data: [], error: null },
      { error: { message: "temporary database outage" } },
    ],
  });
  const firstTracker = createCleanupTracker();
  const failed = await deleteAbandonedPendingMessages(firstAdmin, cutoff, firstTracker);
  assert.equal(failed.deleted, 0);
  assert.equal(firstTracker.cleanupFailures, 1);
  assert.equal(firstTracker.backlogPossible, true);

  const retryAdmin = mockCleanupAdmin({
    queryResults: [
      { data: [{ id: "message-1" }], error: null },
      { data: [], error: null },
      { error: null },
    ],
  });
  const retryTracker = createCleanupTracker();
  const retried = await deleteAbandonedPendingMessages(retryAdmin, cutoff, retryTracker);
  assert.equal(retried.deleted, 1);
  assert.equal(retryTracker.cleanupFailures, 0);
  assert.equal(retryAdmin.calls().deleteCalls, 1);
});

test("abandoned messages with active storage paths are kept and surfaced as backlog", async () => {
  const admin = mockCleanupAdmin({
    queryResults: [
      { data: [{ id: "message-1" }], error: null },
      { data: [{ message_id: "message-1", temporary_path: "pending/thread-1/file-1", final_path: null }], error: null },
    ],
  });
  const tracker = createCleanupTracker();

  const result = await deleteAbandonedPendingMessages(admin, "2026-11-08T03:00:00.000Z", tracker);

  assert.equal(result.deleted, 0);
  assert.equal(result.backlogPossible, true);
  assert.equal(tracker.blockedMessages, 1);
  assert.equal(tracker.backlogPossible, true);
  assert.equal(admin.calls().deleteCalls, 0);
});

test("failed one-hour file purge keeps metadata and reports retryable backlog", async () => {
  const admin = mockCleanupAdmin({
    storageResults: [{ error: { message: "temporary storage outage" } }],
  });
  const tracker = createCleanupTracker();

  const expired = await sweepExpiredFiles(admin, [{
    id: "attachment-expired",
    temporary_path: null,
    final_path: "files/thread-1/attachment-expired",
  }], "2026-11-08T04:00:00.000Z", tracker);

  assert.equal(expired, 0);
  assert.equal(tracker.cleanupFailures, 1);
  assert.equal(tracker.backlogPossible, true);
  assert.equal(admin.calls().updateCalls, 0);
});

test("thrown storage and database exceptions are reported as retryable failures", async () => {
  const nowIso = "2026-11-08T04:00:00.000Z";
  const cleanupCutoff = Date.parse(nowIso);
  const storageTracker = createCleanupTracker();
  const storageAdmin = mockCleanupAdmin({ storageResults: [new Error("storage network failure")] });

  assert.equal(await sweepTemporaryRows(storageAdmin, [temporaryRow], nowIso, cleanupCutoff, storageTracker), 0);
  assert.equal(storageTracker.cleanupFailures, 1);
  assert.equal(storageTracker.backlogPossible, true);
  assert.equal(storageAdmin.calls().updateCalls, 0);

  const databaseTracker = createCleanupTracker();
  const databaseAdmin = mockCleanupAdmin({
    storageResults: [{ error: null }],
    queryResults: [new Error("database network failure")],
  });
  assert.equal(await sweepTemporaryRows(databaseAdmin, [temporaryRow], nowIso, cleanupCutoff, databaseTracker), 0);
  assert.equal(databaseTracker.cleanupFailures, 1);
  assert.equal(databaseTracker.backlogPossible, true);
});
