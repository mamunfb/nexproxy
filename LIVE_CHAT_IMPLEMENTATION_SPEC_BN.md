# NexProxy Live Chat — implementation contract

এই নথিটি `plan.md`-এর user-approved phased scope-কে code-level contract-এ নামায়। সব কাজ শুধু local `feature/live-chat` branch-এ; production migration, secrets, Auth setting, Cloudflare resource বা deployment করা যাবে না।

## Shared Edge Function API

Browser calls `POST {SUPABASE_URL}/functions/v1/support-chat` with `apikey` (public key), JSON content type, and optional `x-chat-token` / `Authorization: Bearer <Supabase JWT>`. The function uses the service-role key only server-side, validates every action, returns `Cache-Control: no-store`, and never logs tokens, message bodies or file URLs.

- `create_visitor`: requires a valid Cloudflare Turnstile response on production origins. Generates 256-bit random token; stores only SHA-256 hash. Returns raw token once plus visitor ID. If Turnstile secret/site key is missing, fail closed.
- `open_thread`: requires visitor token; gets/creates that visitor’s open thread.
- `list_messages`: visitor token must own the thread, or caller must be a verified admin. Returns at most the newest 50 sent messages and safe attachment metadata only.
- `send_message`: visitor token must own an open thread, or caller must be an admin. Body max 4,000 chars; no empty text-only messages; max 5 attachments, each 1 byte–20 MB and allowlisted MIME. Visitor limit: 10 messages/minute. If attachments exist, create pending message + attachment rows and return per-file signed upload capability for a random temporary object path.
- `finalize_message`: only the message owner/admin may finalize. Verify every upload exists and matches the size/type, move from the temporary path to a separate final private path, set `expires_at = completion time + 60 minutes`, then mark the message sent. If any upload fails, keep it invisible and let cleanup remove it.
- `create_download`: owner/admin only. Issues a private signed download URL for no more than 15 minutes (to support slower 20 MB/video transfers) and never beyond `expires_at`.
- `admin_list_threads`, `admin_set_status`, `mark_read`: require a valid Supabase JWT and a database-side `is_admin()` check, except visitor `mark_read` which requires its own token.
- `link_realtime`: requires both the visitor token and a verified Supabase user JWT with `is_anonymous=true`; links that chat-only Auth user to the same visitor row. The UI uses a dedicated storage key, never the customer’s normal account session.

The public visitor token is a bearer capability. Store only its hash; compare the hash on every request; bind every thread/message/upload/download to the same visitor ID. Public visitors never query database or Storage directly in polling mode. All text is rendered as text, not HTML.

## Database and storage contract

Create private tables `support_chat_visitors`, `support_chat_threads`, `support_chat_messages`, and `support_chat_attachments`. Visitor rows hold token hash, optional name/email, and nullable anonymous Auth user ID. Threads hold open/resolved status and read/message timestamps. Messages hold sender role, text, attachment count and pending/sent status. Attachments hold sanitized name, allowlisted MIME, size, random temporary path, final path, token expiry, one-hour expiry and lifecycle status.

Enable RLS on every new table. No `anon` table policy and no public bucket policy. `authenticated` users may `SELECT` only their linked thread/messages; `is_admin()` may read all. Writes and attachment metadata access go through the Edge Function/service role. Add only threads/messages to `supabase_realtime` publication. Storage bucket `support-chat` is private, limited to 20 MB/file and allowlisted MIME types; it is separate from `payment-proofs`.

Before the Anonymous Auth Realtime mode can be activated, add a guard in `create_customer_order` rejecting JWT claim `is_anonymous=true`. Also reject anonymous users in customer-specific `dynamic-action` payment/order actions and `telegram-contact`; keep normal signed-in customer and admin behavior unchanged. These protective changes are migration/source only until rollout confirmation.

## One-hour file lifecycle

Supabase signed-upload tokens may last two hours. They can write only to a random, inaccessible `pending/` path. On successful finalization the server moves the object to `files/<thread>/<attachment-id>`; only that final path can be signed for download. The file’s 60-minute timer starts after finalization; at the deadline the endpoint denies new downloads regardless of cleanup status. Cloudflare Cron every minute invokes `support-chat-cleanup` using a shared secret configured only in Cloudflare/Supabase secrets. Cleanup deletes expired final bytes, clears attachment-specific metadata, and repeatedly sweeps temporary paths until token expiry plus a one-hour in-flight PUT grace; it then removes the tombstone row. Physical deletion is normally completed on the next run, but a full 200-row batch or service outage can delay it; retries continue and the Worker logs a generic backlog-possible warning. Chat text remains and its stored attachment count lets the UI show a generic expired marker.

## UI and runtime contract

The Cloudflare Worker injects a stylesheet into `<head>` and `live-chat.js` at the end of public/customer HTML responses only; never inject into `/admin/`. It also implements the one-minute scheduled cleanup call. `wrangler.jsonc` gets the cron expression and non-secret cleanup URL; cleanup secret is not committed. The public widget loads config/Supabase JS only as needed, persists the visitor token locally, supports optional name/email, upload progress, image/video preview, document download, failure/expired states and 3-second polling. When the public feature flag is enabled after migration + Auth setup, it attempts a separate anonymous chat session and subscribes to Realtime; on any failure it stays on the same token/polling conversation.

The admin Support Chats view is inside the existing admin gate. `admin.js` passes its already-validated Supabase client/session into `chat-admin.js`; the admin inbox also falls back to polling if Realtime cannot subscribe.

## Not in this implementation

No live deployment or production writes; no third-party chat provider; no AI/bot answers; no video/voice calls; no deletion of message text; no malware scanning; no real test customer/order/payment data. Before rollout, the user sees exact DDL, required Turnstile/cleanup secrets, anonymous Auth toggle and Cloudflare publish steps and confirms them separately.

## Exact response fields for UI integration

- `create_visitor` → `{ visitorToken, visitorId }`; `open_thread` → `{ threadId, status }`.
- `list_messages` → `{ messages: [{ id, body, senderRole, createdAt, attachmentCount, attachments: [{ id, name, mimeType, sizeBytes, expired }] }] }`.
- `send_message` → `{ messageId, uploads: [{ attachmentId, signedUploadUrl, tokenExpiresAt }] }`; `uploads` is empty for text-only messages. The browser uploads via XHR `PUT` to `signedUploadUrl` with only the public `apikey`, file `Content-Type` and `x-upsert:false`; this URL is a temporary capability and must never be logged.
- `finalize_message` → `{ success:true, messageId }`; `create_download` → `{ signedUrl, expiresAt }`.
- `admin_list_threads` → `{ threads: [{ threadId, status, visitorId, displayName, email, lastMessageAt, unread }] }`; `admin_set_status` → `{ success:true, status }`; `mark_read` and `link_realtime` → `{ success:true }`.

All API responses use `success:true` on success and an opaque, user-safe `error` string on failure; do not return stack traces, SQL, tokens, storage paths, or secrets.

## Storage API references

The signed-upload URL method creates a capability valid for two hours and the SDK documents `uploadToSignedUrl(path, token, file)` for standard uploads. Supabase recommends resumable uploads for files over 6 MB; the implementation keeps the approved 20 MB cap and one-hour temporary/final path lifecycle in view. The object `info()` method returns size and content-type metadata, including top-level `size` and `contentType` fields. Sources: [1] [2] [3] [4].

[1]: https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl "Supabase JavaScript createSignedUploadUrl reference"
[2]: https://supabase.com/docs/reference/javascript/storage-from-info "Supabase JavaScript Storage info reference"
[3]: https://supabase.com/docs/guides/storage/uploads/standard-uploads "Supabase standard upload guide"
[4]: https://supabase.com/docs/guides/storage/uploads/resumable-uploads "Supabase resumable upload guide"


## Official upload method and cleanup trade-off verified 2026-11-08

`createSignedUploadUrl` returns `signedUrl`, `path`, and `token`; the capability works without a browser login and is valid for two hours. The official `uploadToSignedUrl` source uses HTTP `PUT`, includes the token in the URL, and does not require Storage object RLS permissions for the signed upload. The current XHR `PUT` with the public `apikey`, content type, and `x-upsert:false` matches that contract and provides upload progress.

Supabase supports standard uploads beyond 6 MB, but recommends TUS above 6 MB for resumability and network reliability. TUS signed upload sessions can remain valid up to 24 hours after creation. Because this feature requires a one-hour file lifecycle and tight temporary-path cleanup, v1 retains standard signed `PUT` for the 20 MB cap; interrupted uploads may need retry. TUS is a possible later improvement only if the user accepts a longer temporary-upload sweep window.

Verified sources:
- https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl
- https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts
- https://supabase.com/docs/guides/storage/uploads/standard-uploads
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
