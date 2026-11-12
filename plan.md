# NexProxy Live Chat + Attachments — Phased Implementation Plan

**Status:** The user approved both chat approaches as two modes of one product. Implementation stays local on `feature/live-chat`; production database/configuration and deployment still require a separate rollout confirmation.

## Architecture decision

Implement both requested approaches as **two modes of one chat system**, not two duplicate chat products. The safe baseline uses a random high-entropy chat token for no-login visitors. The server stores only the token hash and validates every action. The widget refreshes messages every 3 seconds while open. This does not enable global Supabase Anonymous Auth.

Prepare an optional Realtime mode using a separate Supabase Anonymous Auth session. Before enabling it, the migration rejects `is_anonymous=true` in `create_customer_order`; customer `dynamic-action` payment/order actions and `telegram-contact` account actions also reject anonymous users. Normal permanent-account ordering remains unchanged. The Anonymous Auth setting is not changed live until rollout confirmation. If Realtime is disabled/unavailable or its connection fails, the same visitor token and thread use polling.

The chat Auth client uses a dedicated browser storage key so it cannot replace or sign out a customer’s normal NexProxy session. Guest-token and Realtime modes share the same visitor/thread data; they do not create duplicate conversations. Chat appears on public/customer pages. `/admin/` contains an inbox with unread state, history, replies and open/resolved status. Offline messages persist for a later response; the site does not promise 24/7 staffing.

## Attachments and one-hour deletion

Customers and admins can both upload screenshots, photos, short videos and common documents. Each file is capped at **20 MB**, with up to **5 files per message**. Allow JPEG/PNG/WebP/GIF, MP4/WebM/MOV, PDF/TXT/CSV/DOCX/XLSX; block executables, scripts and unsafe/unknown formats. Show upload progress. Limit visitor messages to 10 per minute. Malware scanning is not included in v1.

First-time chat-token issuance requires a Cloudflare Turnstile challenge verified server-side. If the site key or secret is missing, new visitor initialization fails closed; there is no unprotected public token-creation endpoint.

Files use a new **private** `support-chat` Storage bucket, separate from `payment-proofs`. An authorized Edge Function issues scoped upload/download access only after verifying visitor-token ownership or admin auth. Download links may last up to 15 minutes for reliable large-file/video viewing, but are always capped by the file’s expiry and cannot outlive it. The 60-minute deletion timer starts after upload finalization: at expiry, the server denies new access. A Cloudflare Worker Cron runs every minute to remove file bytes and attachment-specific metadata. Physical purge is best-effort: it is normally removed on the next run, but can take longer if a 200-row batch fills or the service is unavailable; retries continue and a generic backlog warning is logged. Chat text/history remains and shows a generic “Attachment expired” marker.

V1 uses Supabase’s standard signed `PUT` upload with `XMLHttpRequest` progress reporting. The selected 20 MB size is supported, but Supabase recommends resumable TUS uploads above 6 MB for better reliability; interrupted uploads may need a retry. TUS sessions can remain valid up to 24 hours after creation, so TUS is deferred because that longer session window would complicate the one-hour temporary-file lifecycle.

Supabase signed-upload tokens can remain valid for up to two hours. They target only an inaccessible temporary object path; after finalization the file moves to a different private path. Expired/abandoned temporary paths are swept every minute until token expiry plus a one-hour in-flight PUT grace, so a slow transfer cannot leave an orphan object or restore an accessible attachment.

## Project structure

- `public/assets/js/live-chat.js` / `public/assets/css/live-chat.css`: public widget, guest-token flow, polling fallback, optional Realtime mode, text, attachment upload/download/preview, expiry and error states. The Worker injects it into public/customer HTML only, not `/admin/`.
- `public/admin/index.html` / `public/assets/js/chat-admin.js` / `public/assets/css/admin.css`: Support Chats inbox inside the existing admin login and authorization gate, including admin-side uploads.
- Supabase migration: visitor/session hash, thread/message/attachment tables, RLS, private bucket, Realtime publication, server-side rate/count/length limits, order guard and anonymous-user guards.
- Supabase `support-chat` Edge Function: token issue/validation, Turnstile verification, guest/admin actions, message handling, scoped upload/download links, session linking and authorization.
- Supabase `support-chat-cleanup` Edge Function: expired-file cleanup. Cloudflare Worker Cron runs each minute; its shared secret stays in Cloudflare/Supabase secret storage, never in source/Git.
- `cloudflare/worker.mjs` / `wrangler.jsonc`: public HTML injection and scheduled cleanup call only.

## Delivery safety

No customer/order rows or production chat/files will be used for testing. Orders and payments retain their existing behavior for normal signed-in accounts; only anonymous accounts are denied by order/payment/Telegram account actions. Before applying the production migration, enabling the Supabase Anonymous Auth setting, configuring the Turnstile widget/secret, bucket/Cron secret, deploying functions or publishing the Worker, show exact changes and request rollout confirmation.

## Confirmed behavior

Native chat, no-login visitor support, admin replies, both parties’ uploads, 20 MB/file and 5 files/message, private storage, attachment-only expiry at 60 minutes, token-based fallback and a later Realtime mode after its security guard are in scope. Third-party chat providers, bot/AI answers, voice/video calls and deletion of message text are not in scope.

## Technical references

- [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous) — anonymous users use the authenticated database role and carry `is_anonymous` in their JWT.
- [Supabase signed upload URL reference](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) — signed upload tokens work without further authentication and last two hours.
- [Supabase uploadToSignedUrl reference](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl) and [storage-js source](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts) — supported signed upload behavior and method.
- [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) and [resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) — standard-upload size guidance and TUS session behavior.
- [Supabase private Storage downloads](https://supabase.com/docs/guides/storage/serving/downloads) — private files require authenticated access or time-limited signed URLs.
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) — selected tables must be included in the Realtime publication and protected with RLS.
