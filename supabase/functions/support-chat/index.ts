import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { filenameMatchesMime, validateAttachmentContent } from "./attachment-validation.mjs";

type JsonObject = Record<string, unknown>;
type AttachmentInput = { name: string; mimeType: string; sizeBytes: number };
type VerifiedIdentity = { id: string; isAnonymous: boolean; jwt: string };

const BUCKET = "support-chat";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_CHARS = 4000;
const MAX_REQUEST_BYTES = 64 * 1024;
const UPLOAD_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const DOWNLOAD_TTL_SECONDS = 15 * 60;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-chat-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

class ChatError extends Error {
  constructor(readonly status: number, readonly safeMessage: string) {
    super(safeMessage);
  }
}
function fail(status: number, message: string): never {
  throw new ChatError(status, message);
}
const json = (status: number, body: JsonObject) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i % Math.max(b.length, 1)] ?? 0);
  return difference === 0;
}
function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts[1].length > 12_000) fail(401, "Your session is invalid or expired.");
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad claims");
    return value as Record<string, unknown>;
  } catch {
    fail(401, "Your session is invalid or expired.");
  }
}
function cleanName(value: unknown): string {
  const name = String(value ?? "").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 255);
  return name || "attachment";
}
function safeEmail(value: unknown): string | null {
  if (value == null || value === "") return null;
  const email = String(value).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
  return email;
}
function getToken(req: Request): string {
  const token = req.headers.get("x-chat-token") || "";
  if (!/^[0-9a-f]{64}$/i.test(token)) fail(401, "A valid chat session is required.");
  return token.toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed." });

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) return json(500, { success: false, error: "Server configuration is incomplete." });
  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const lengthHeader = req.headers.get("content-length");
    if (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > MAX_REQUEST_BYTES)) {
      fail(413, "Request is too large.");
    }
    const bodyValue = await readBoundedJson(req, MAX_REQUEST_BYTES);
    if (!bodyValue || typeof bodyValue !== "object" || Array.isArray(bodyValue)) fail(400, "Invalid request.");
    const body = bodyValue as JsonObject;
    const action = typeof body.action === "string" ? body.action : "";
    const authHeader = req.headers.get("Authorization") || "";
    let identity: VerifiedIdentity | null = null;

    async function verifiedIdentity(): Promise<VerifiedIdentity> {
      if (identity) return identity;
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (!match) fail(401, "A valid signed-in session is required.");
      const jwt = match[1].trim();
      if (jwt.length < 32 || jwt.length > 16_384) fail(401, "Your session is invalid or expired.");
      const claims = decodeJwtClaims(jwt);
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user || typeof claims.sub !== "string" || claims.sub !== data.user.id) {
        fail(401, "Your session is invalid or expired.");
      }
      identity = { id: data.user.id, isAnonymous: claims.is_anonymous === true, jwt };
      return identity;
    }
    async function requireAdmin(): Promise<VerifiedIdentity> {
      const user = await verifiedIdentity();
      if (user.isAnonymous) fail(403, "Admin access is required.");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) fail(500, "Server configuration is incomplete.");
      const jwtClient = createClient(projectUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${user.jwt}` } },
      });
      const { data, error } = await jwtClient.rpc("is_admin");
      if (error || data !== true) fail(403, "Admin access is required.");
      return user;
    }
    async function visitorFromRequest(): Promise<{ id: string }> {
      const raw = getToken(req);
      const computedHash = await sha256(raw);
      const { data, error } = await admin.from("support_chat_visitors")
        .select("id,token_hash").eq("token_hash", computedHash).limit(1).maybeSingle();
      if (error || !data || !constantTimeEqual(String(data.token_hash), computedHash)) {
        fail(401, "A valid chat session is required.");
      }
      return { id: String(data.id) };
    }
    async function ownedThread(threadId: unknown, visitorId: string) {
      if (typeof threadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(threadId)) fail(400, "Invalid conversation.");
      const { data, error } = await admin.from("support_chat_threads")
        .select("id,visitor_id,status,admin_read_at,visitor_read_at")
        .eq("id", threadId).eq("visitor_id", visitorId).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) fail(404, "Conversation not found.");
      return data;
    }
    async function threadById(threadId: unknown) {
      if (typeof threadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(threadId)) fail(400, "Invalid conversation.");
      const { data, error } = await admin.from("support_chat_threads")
        .select("id,visitor_id,status,admin_read_at,visitor_read_at")
        .eq("id", threadId).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) fail(404, "Conversation not found.");
      return data;
    }

    if (action === "create_visitor") {
      await verifyTurnstile(req, body);
      const displayName = body.name == null ? null : String(body.name).trim().slice(0, 120) || null;
      const email = safeEmail(body.email);
      const visitorToken = hex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(visitorToken);
      const { data, error } = await admin.from("support_chat_visitors")
        .insert({ token_hash: tokenHash, display_name: displayName, email })
        .select("id").single();
      if (error || !data) throw error || new Error("insert failed");
      return json(200, { success: true, visitorToken, visitorId: data.id });
    }

    if (action === "open_thread") {
      const visitor = await visitorFromRequest();
      const { data: found, error: findError } = await admin.from("support_chat_threads")
        .select("id,status").eq("visitor_id", visitor.id).eq("status", "open")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (findError) throw findError;
      if (found) return json(200, { success: true, visitorId: visitor.id, threadId: found.id, status: found.status });
      const { data, error } = await admin.from("support_chat_threads")
        .insert({ visitor_id: visitor.id, status: "open" }).select("id,status").single();
      if (error?.code === "23505") {
        const { data: retry, error: retryError } = await admin.from("support_chat_threads")
          .select("id,status").eq("visitor_id", visitor.id).eq("status", "open").limit(1).maybeSingle();
        if (retryError || !retry) throw retryError || error;
        return json(200, { success: true, visitorId: visitor.id, threadId: retry.id, status: retry.status });
      }
      if (error || !data) throw error || new Error("thread insert failed");
      return json(200, { success: true, visitorId: visitor.id, threadId: data.id, status: data.status });
    }

    if (action === "list_messages") {
      let thread;
      let isAdmin = false;
      if (authHeader) {
        await verifiedIdentity();
        try { await requireAdmin(); isAdmin = true; } catch (error) {
          if (!(error instanceof ChatError) || error.status !== 403) throw error;
        }
      }
      if (isAdmin) thread = await threadById(body.threadId);
      else {
        const visitor = await visitorFromRequest();
        thread = await ownedThread(body.threadId, visitor.id);
      }
      const { data, error } = await admin.from("support_chat_messages")
        .select("id,body,sender_role,created_at,attachment_count")
        .eq("thread_id", thread.id).eq("status", "sent")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      const rows = (data || []).slice().reverse();
      const messageIds = rows.map((row: any) => row.id);
      let attachments: any[] = [];
      if (messageIds.length) {
        const { data: attachmentRows, error: attachmentError } = await admin.from("support_chat_attachments")
          .select("id,message_id,display_name,mime_type,size_bytes,status,expires_at")
          .in("message_id", messageIds).order("created_at", { ascending: true }).limit(250);
        if (attachmentError) throw attachmentError;
        attachments = attachmentRows || [];
      }
      const byMessage = new Map<string, any[]>();
      for (const attachment of attachments) {
        const list = byMessage.get(attachment.message_id) || [];
        list.push({
          id: attachment.id,
          name: attachment.status === "expired" ? "Expired attachment" : attachment.display_name,
          mimeType: attachment.status === "expired" ? "application/octet-stream" : attachment.mime_type,
          sizeBytes: attachment.status === "expired" ? 0 : Number(attachment.size_bytes),
          expired: attachment.status === "expired" || (attachment.expires_at != null && Date.parse(attachment.expires_at) <= Date.now()),
        });
        byMessage.set(attachment.message_id, list);
      }
      return json(200, {
        success: true,
        threadStatus: thread.status,
        messages: rows.map((message: any) => ({
          id: message.id,
          body: message.body,
          senderRole: message.sender_role,
          createdAt: message.created_at,
          attachmentCount: Number(message.attachment_count),
          attachments: withExpiredPlaceholders(byMessage.get(message.id) || [], Number(message.attachment_count)),
        })),
      });
    }

    if (action === "send_message") {
      let visitor: { id: string } | null = null;
      let senderRole: "visitor" | "admin" = "visitor";
      if (authHeader) {
        await verifiedIdentity();
        try { await requireAdmin(); senderRole = "admin"; } catch (error) {
          if (!(error instanceof ChatError) || error.status !== 403) throw error;
        }
      }
      if (senderRole === "visitor") visitor = await visitorFromRequest();
      const thread = senderRole === "admin" ? await threadById(body.threadId) : await ownedThread(body.threadId, visitor!.id);
      if (thread.status !== "open") fail(409, "This conversation is closed.");
      const messageBody = typeof body.body === "string" ? body.body : "";
      if (messageBody.length > MAX_MESSAGE_CHARS) fail(400, "Message is too long.");
      const inputs = parseAttachments(body.attachments);
      if (!messageBody.trim() && inputs.length === 0) fail(400, "Write a message or attach a file.");
      if (senderRole === "visitor") {
        const { data: allowed, error: limitError } = await admin.rpc("consume_support_chat_rate_limit", { p_visitor_id: visitor!.id });
        if (limitError) throw limitError;
        if (allowed !== true) fail(429, "Please wait before sending another message.");
      }
      const createdAt = new Date().toISOString();
      const messageId = crypto.randomUUID();
      const { error: messageError } = await admin.from("support_chat_messages").insert({
        id: messageId,
        thread_id: thread.id,
        sender_role: senderRole,
        body: messageBody,
        attachment_count: inputs.length,
        status: inputs.length ? "pending" : "sent",
        sent_at: inputs.length ? null : createdAt,
      });
      if (messageError) throw messageError;
      await touchThread(admin, thread.id, createdAt, senderRole);
      if (!inputs.length) return json(200, { success: true, messageId, uploads: [] });

      const uploadResults: Array<{ attachmentId: string; signedUploadUrl: string; tokenExpiresAt: string }> = [];
      try {
        for (const item of inputs) {
          const attachmentId = crypto.randomUUID();
          const temporaryPath = `pending/${crypto.randomUUID()}`;
          const tokenExpiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000).toISOString();
          const { error: rowError } = await admin.from("support_chat_attachments").insert({
            id: attachmentId,
            message_id: messageId,
            display_name: item.name,
            mime_type: item.mimeType,
            size_bytes: item.sizeBytes,
            temporary_path: temporaryPath,
            upload_token_expires_at: tokenExpiresAt,
            status: "pending",
          });
          if (rowError) throw rowError;
          const { data: signed, error: signError } = await admin.storage.from(BUCKET)
            .createSignedUploadUrl(temporaryPath, { upsert: false });
          if (signError || !signed?.signedUrl) throw signError || new Error("upload capability unavailable");
          uploadResults.push({ attachmentId, signedUploadUrl: signed.signedUrl, tokenExpiresAt });
        }
      } catch (error) {
        // Keep pending rows until the signed upload tokens expire so cleanup can
        // sweep any capability already issued before a later token failed.
        throw error;
      }
      return json(200, { success: true, messageId, uploads: uploadResults });
    }

    if (action === "finalize_message") {
      let isAdmin = false;
      if (authHeader) {
        await verifiedIdentity();
        try { await requireAdmin(); isAdmin = true; } catch (error) {
          if (!(error instanceof ChatError) || error.status !== 403) throw error;
        }
      }
      const visitor = isAdmin ? null : await visitorFromRequest();
      const messageId = typeof body.messageId === "string" ? body.messageId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(messageId)) fail(400, "Invalid message.");
      const { data: message, error: messageLookupError } = await admin.from("support_chat_messages")
        .select("id,thread_id,sender_role,status,attachment_count").eq("id", messageId).limit(1).maybeSingle();
      if (messageLookupError) throw messageLookupError;
      if (!message) fail(404, "Message not found.");
      const thread = isAdmin ? await threadById(message.thread_id) : await ownedThread(message.thread_id, visitor!.id);
      if (!isAdmin && message.sender_role !== "visitor") fail(403, "Message access denied.");
      if (message.status === "sent") return json(200, { success: true, messageId: message.id });
      if (message.status !== "pending") fail(404, "Pending message not found.");
      if (thread.status !== "open") fail(409, "This conversation is closed.");
      const { data: rows, error: rowsError } = await admin.from("support_chat_attachments")
        .select("id,display_name,mime_type,size_bytes,temporary_path,final_path,upload_token_expires_at,expires_at,status")
        .eq("message_id", message.id).in("status", ["pending", "ready"])
        .order("created_at", { ascending: true }).limit(MAX_ATTACHMENTS);
      if (rowsError) throw rowsError;
      const attachments = rows || [];
      if (attachments.length !== Number(message.attachment_count) || attachments.length === 0) fail(409, "Files are not ready to finalize.");
      for (const item of attachments) {
        const finalPath = `files/${thread.id}/${item.id}`;
        if (item.status === "ready") {
          if (item.final_path !== finalPath || !item.expires_at || Date.parse(item.expires_at) <= Date.now()) {
            fail(409, "An uploaded file has expired. Please resend the message.");
          }
          await verifyStorageObject(admin, item, finalPath);
          continue;
        }

        let alreadyMoved = false;
        try {
          await verifyUploadedObject(admin, item);
        } catch (temporaryError) {
          try {
            await verifyStorageObject(admin, item, finalPath);
            alreadyMoved = true;
          } catch {
            throw temporaryError;
          }
        }
        if (!alreadyMoved) {
          const { error: moveError } = await admin.storage.from(BUCKET).move(item.temporary_path, finalPath);
          if (moveError) {
            try { await verifyStorageObject(admin, item, finalPath); }
            catch { throw moveError; }
          }
        }
        await verifyStorageObject(admin, item, finalPath);
        const stagedAt = new Date().toISOString();
        const stagedExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const { data: updated, error: updateError } = await admin.from("support_chat_attachments").update({
          final_path: finalPath,
          uploaded_at: stagedAt,
          expires_at: stagedExpiry,
          status: "ready",
        }).eq("id", item.id).eq("status", "pending").select("id").maybeSingle();
        if (updateError) throw updateError;
        if (!updated) {
          const { data: current, error: currentError } = await admin.from("support_chat_attachments")
            .select("status,final_path").eq("id", item.id).limit(1).maybeSingle();
          if (currentError || current?.status !== "ready" || current.final_path !== finalPath) {
            throw currentError || new Error("attachment state changed");
          }
        }
      }
      const completedAt = new Date().toISOString();
      const fileExpiresAt = new Date(Date.parse(completedAt) + 60 * 60 * 1000).toISOString();
      const { error: expiryError } = await admin.from("support_chat_attachments")
        .update({ uploaded_at: completedAt, expires_at: fileExpiresAt })
        .eq("message_id", message.id).eq("status", "ready");
      if (expiryError) throw expiryError;
      const { data: sent, error: sendError } = await admin.from("support_chat_messages")
        .update({ status: "sent", sent_at: completedAt }).eq("id", message.id).eq("status", "pending")
        .select("id").maybeSingle();
      if (sendError) throw sendError;
      if (!sent) {
        const { data: current, error: currentError } = await admin.from("support_chat_messages")
          .select("status").eq("id", message.id).limit(1).maybeSingle();
        if (currentError) throw currentError;
        if (current?.status !== "sent") fail(409, "Message could not be finalized.");
      }
      await touchThread(admin, thread.id, completedAt, message.sender_role);
      return json(200, { success: true, messageId: message.id });
    }

    if (action === "create_download") {
      const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(attachmentId)) fail(400, "Invalid attachment.");
      const { data: attachment, error } = await admin.from("support_chat_attachments")
        .select("id,message_id,final_path,expires_at,status,display_name,mime_type").eq("id", attachmentId).limit(1).maybeSingle();
      if (error) throw error;
      if (!attachment || attachment.status !== "ready" || !attachment.final_path || !attachment.expires_at) fail(404, "File is no longer available.");
      const { data: message, error: messageError } = await admin.from("support_chat_messages")
        .select("id,thread_id,status").eq("id", attachment.message_id).limit(1).maybeSingle();
      if (messageError) throw messageError;
      if (!message || message.status !== "sent") fail(404, "File is no longer available.");
      const thread = await threadById(message.thread_id);
      let allowed = false;
      if (authHeader) {
        await verifiedIdentity();
        try { await requireAdmin(); allowed = true; } catch (error) {
          if (!(error instanceof ChatError) || error.status !== 403) throw error;
        }
      }
      if (!allowed) {
        const visitor = await visitorFromRequest();
        allowed = thread.visitor_id === visitor.id;
      }
      if (!allowed) fail(403, "File access denied.");
      const remainingSeconds = Math.floor((Date.parse(attachment.expires_at) - Date.now()) / 1000);
      if (remainingSeconds <= 0) fail(404, "File is no longer available.");
      const expiresIn = Math.min(DOWNLOAD_TTL_SECONDS, remainingSeconds);
      const mimeType = String(attachment.mime_type || "").toLowerCase();
      const forceDownload = !mimeType.startsWith("image/") && !mimeType.startsWith("video/");
      const signedOptions = forceDownload ? { download: attachment.display_name || true } : {};
      const { data: signed, error: signError } = await admin.storage.from(BUCKET)
        .createSignedUrl(attachment.final_path, expiresIn, signedOptions);
      if (signError || !signed?.signedUrl) throw signError || new Error("download unavailable");
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      return json(200, { success: true, signedUrl: signed.signedUrl, expiresAt });
    }

    if (action === "admin_list_threads") {
      await requireAdmin();
      const { data: threads, error } = await admin.from("support_chat_threads")
        .select("id,visitor_id,status,last_message_at,last_sender_role,admin_read_at")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      const visitorIds = [...new Set((threads || []).map((row: any) => row.visitor_id))];
      let visitors: any[] = [];
      if (visitorIds.length) {
        const result = await admin.from("support_chat_visitors").select("id,display_name,email")
          .in("id", visitorIds).limit(100);
        if (result.error) throw result.error;
        visitors = result.data || [];
      }
      const visitorById = new Map(visitors.map((row: any) => [row.id, row]));
      return json(200, {
        success: true,
        threads: (threads || []).map((thread: any) => {
          const visitor: any = visitorById.get(thread.visitor_id) || {};
          return {
            threadId: thread.id,
            status: thread.status,
            visitorId: thread.visitor_id,
            displayName: visitor.display_name || null,
            email: visitor.email || null,
            lastMessageAt: thread.last_message_at,
            unread: thread.last_sender_role === "visitor"
              && Date.parse(thread.last_message_at) > (thread.admin_read_at ? Date.parse(thread.admin_read_at) : 0),
          };
        }),
      });
    }

    if (action === "admin_set_status") {
      await requireAdmin();
      const status = body.status;
      if (status !== "open" && status !== "resolved") fail(400, "Invalid conversation status.");
      const thread = await threadById(body.threadId);
      const { data, error } = await admin.from("support_chat_threads").update({ status, updated_at: new Date().toISOString() })
        .eq("id", thread.id).select("status").single();
      if (error) throw error;
      return json(200, { success: true, status: data.status });
    }

    if (action === "mark_read") {
      let thread;
      let isAdmin = false;
      if (authHeader) {
        await verifiedIdentity();
        try { await requireAdmin(); isAdmin = true; } catch (error) {
          if (!(error instanceof ChatError) || error.status !== 403) throw error;
        }
      }
      if (isAdmin) thread = await threadById(body.threadId);
      else {
        const visitor = await visitorFromRequest();
        thread = await ownedThread(body.threadId, visitor.id);
      }
      const column = isAdmin ? "admin_read_at" : "visitor_read_at";
      const { error } = await admin.from("support_chat_threads").update({ [column]: new Date().toISOString() })
        .eq("id", thread.id);
      if (error) throw error;
      return json(200, { success: true });
    }

    if (action === "link_realtime") {
      const visitor = await visitorFromRequest();
      const user = await verifiedIdentity();
      if (!user.isAnonymous) fail(403, "A chat-only anonymous session is required.");
      const { data: current, error: lookupError } = await admin.from("support_chat_visitors")
        .select("id,anonymous_user_id").eq("id", visitor.id).limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      if (!current) fail(404, "Chat session not found.");
      if (current.anonymous_user_id && current.anonymous_user_id !== user.id) fail(409, "Chat session is already linked.");
      const { data, error } = await admin.from("support_chat_visitors")
        .update({ anonymous_user_id: user.id, updated_at: new Date().toISOString() })
        .eq("id", visitor.id).is("anonymous_user_id", current.anonymous_user_id)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) fail(409, "Chat session could not be linked.");
      return json(200, { success: true });
    }

    fail(400, "Unknown support-chat action.");
  } catch (error) {
    if (error instanceof ChatError) return json(error.status, { success: false, error: error.safeMessage });
    console.error("support-chat request failed", error instanceof Error ? error.name : "Error");
    return json(500, { success: false, error: "Chat request could not be completed." });
  }
});

async function verifyTurnstile(req: Request, body: JsonObject): Promise<void> {
  const origin = req.headers.get("Origin");
  let localOrigin = false;
  if (origin) {
    try {
      const parsed = new URL(origin);
      localOrigin = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname.endsWith(".local");
    } catch { fail(403, "Request origin is not allowed."); }
  }
  // A localhost Origin is forgeable; bypass only when both the origin and project endpoint are loopback.
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  let localProject = false;
  try {
    const projectHost = new URL(projectUrl).hostname;
    localProject = projectHost === "localhost" || projectHost === "127.0.0.1" || projectHost === "[::1]";
  } catch { /* missing or invalid configuration fails closed below */ }
  if (localOrigin && localProject && Deno.env.get("SUPPORT_CHAT_ALLOW_LOCAL_TURNSTILE_BYPASS") === "true") return;
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const siteKey = Deno.env.get("TURNSTILE_SITE_KEY");
  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!secret || !siteKey || !token || token.length > 2048) fail(503, "Chat verification is temporarily unavailable.");
  try {
    const form = new URLSearchParams({ secret, response: token });
    const remoteIp = req.headers.get("CF-Connecting-IP");
    if (remoteIp && remoteIp.length <= 64) form.set("remoteip", remoteIp);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) fail(403, "Complete the security check and try again.");
    const result = await response.json().catch(() => null);
    const hostname = origin ? new URL(origin).hostname : "";
    if (result?.success !== true || (hostname && result.hostname !== hostname)
      || result.action !== "support_chat") {
      fail(403, "Complete the security check and try again.");
    }
  } catch (error) {
    if (error instanceof ChatError) throw error;
    fail(503, "Chat verification is temporarily unavailable.");
  }
}

function parseAttachments(value: unknown): AttachmentInput[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) fail(400, "Up to five files may be attached.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(400, "Invalid attachment details.");
    const item = entry as Record<string, unknown>;
    const name = cleanName(item.name);
    const mimeType = String(item.mimeType ?? "").toLowerCase();
    const sizeBytes = Number(item.sizeBytes);
    if (!ALLOWED_MIME_TYPES.has(mimeType)) fail(400, "This file type is not supported.");
    if (!filenameMatchesMime(name, mimeType)) fail(400, "The filename extension does not match the selected file type.");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) fail(400, "Each file must be 20 MB or smaller.");
    return { name, mimeType, sizeBytes };
  });
}
async function touchThread(admin: any, threadId: string, at: string, senderRole: "visitor" | "admin"): Promise<void> {
  const { error } = await admin.from("support_chat_threads")
    .update({ last_message_at: at, last_sender_role: senderRole, updated_at: at }).eq("id", threadId);
  if (error) throw error;
}
async function verifyStorageObject(admin: any, attachment: any, path: unknown): Promise<void> {
  if (typeof path !== "string" || !(path.startsWith("pending/") || path.startsWith("files/"))) {
    fail(409, "An uploaded file could not be verified.");
  }
  const { data, error } = await admin.storage.from(BUCKET).info(path);
  if (error || !data) fail(409, "An uploaded file could not be verified.");
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  const size = Number(metadata.size ?? metadata.contentLength ?? data.size);
  const mime = String(metadata.mimetype ?? metadata.contentType ?? data.mimetype ?? data.contentType ?? "").toLowerCase();
  if (size !== Number(attachment.size_bytes) || mime !== String(attachment.mime_type).toLowerCase()) {
    fail(409, "An uploaded file did not match its declared details.");
  }
  const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(path);
  if (downloadError || !file || file.size !== Number(attachment.size_bytes)) {
    fail(409, "An uploaded file could not be verified.");
  }
  const declaredMime = String(attachment.mime_type || "").toLowerCase();
  if (!filenameMatchesMime(String(attachment.display_name || ""), declaredMime)
      || !await validateAttachmentContent(file, declaredMime)) {
    fail(409, "The file contents do not match the selected file type.");
  }
}
async function verifyUploadedObject(admin: any, attachment: any): Promise<void> {
  await verifyStorageObject(admin, attachment, attachment.temporary_path);
}

async function readBoundedJson(req: Request, maxBytes: number): Promise<unknown> {
  if (!req.body) fail(400, "Invalid request.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        fail(413, "Request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(400, "Invalid request."); }
}

function withExpiredPlaceholders(attachments: any[], expectedCount: number): any[] {
  const result = attachments.slice(0, Math.max(0, Math.min(expectedCount, MAX_ATTACHMENTS)));
  while (result.length < expectedCount && result.length < MAX_ATTACHMENTS) {
    result.push({ id: null, name: "Expired attachment", mimeType: "application/octet-stream", sizeBytes: 0, expired: true });
  }
  return result;
}
