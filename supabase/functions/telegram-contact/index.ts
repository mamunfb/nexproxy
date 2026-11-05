import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function getTelegramConfig() {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const username = (Deno.env.get("TELEGRAM_BOT_USERNAME") || "").replace(/^@/, "");
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error("Telegram bot is not configured.");
  }
  return { token, username };
}

async function telegramRequest(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error("Telegram API request failed.");
  return result.result;
}

async function ensureWebhook(projectUrl: string) {
  const { token, username } = getTelegramConfig();
  const me = await telegramRequest(token, "getMe", {});
  if (me?.username?.toLowerCase() !== username.toLowerCase()) {
    throw new Error("Telegram bot username does not match the configured bot token.");
  }
  const secret = await sha256(`nexproxy-telegram-webhook-v1:${token}:${projectUrl}`);
  const result = await telegramRequest(token, "setWebhook", {
    url: `${projectUrl.replace(/\/$/, "")}/functions/v1/telegram-webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  if (result !== true) throw new Error("Telegram webhook could not be configured.");
  return { token, username, webhookSecret: secret };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed." });

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) return json(500, { success: false, error: "Server configuration is incomplete." });

  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const authorization = req.headers.get("Authorization") || "";
    const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!jwt) return json(401, { success: false, error: "Sign in is required." });
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData.user) return json(401, { success: false, error: "Your session is invalid or expired." });
    const user = authData.user;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (action === "status") {
      const [{ data: setting, error: settingError }, { data: contact, error: contactError }] = await Promise.all([
        admin.from("customer_contact_settings").select("telegram_required").eq("id", 1).maybeSingle(),
        admin.from("customer_contact_methods").select("telegram_username,telegram_verified_at").eq("customer_id", user.id).maybeSingle(),
      ]);
      if (settingError || contactError) throw new Error("Telegram status is unavailable.");
      return json(200, {
        success: true,
        required: setting?.telegram_required === true,
        verified: Boolean(contact?.telegram_verified_at),
        username: contact?.telegram_username || null,
        configured: Boolean(Deno.env.get("TELEGRAM_BOT_TOKEN") && Deno.env.get("TELEGRAM_BOT_USERNAME")),
      });
    }

    if (action === "create_link") {
      const { token, username } = await ensureWebhook(projectUrl);
      const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(raw);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error: cleanupError } = await admin.from("telegram_link_tokens").delete().eq("customer_id", user.id).is("used_at", null);
      if (cleanupError) throw new Error("Telegram link could not be created.");
      const { error: insertError } = await admin.from("telegram_link_tokens").insert({ token_hash: tokenHash, customer_id: user.id, expires_at: expiresAt });
      if (insertError) throw new Error("Telegram link could not be created.");
      return json(200, {
        success: true,
        botUrl: `https://t.me/${username}?start=${raw}`,
        expiresInSeconds: 600,
      });
    }

    if (action === "activate") {
      if (user.email?.toLowerCase() !== "mamunfb13@gmail.com") return json(403, { success: false, error: "Admin access required." });
      await ensureWebhook(projectUrl);
      const { error: updateError } = await admin.from("customer_contact_settings").update({ telegram_required: true, updated_at: new Date().toISOString() }).eq("id", 1);
      if (updateError) throw new Error("Telegram verification could not be activated.");
      return json(200, { success: true, required: true });
    }

    return json(400, { success: false, error: "Unknown Telegram action." });
  } catch (error) {
    console.error("telegram-contact request failed", error instanceof Error ? error.name : "Error");
    const message = error instanceof Error ? error.message : "Request failed.";
    if (/Telegram bot is not configured|Telegram API request failed|username does not match/i.test(message)) {
      return json(503, { success: false, error: message });
    }
    return json(500, { success: false, error: "Telegram request could not be completed." });
  }
});
