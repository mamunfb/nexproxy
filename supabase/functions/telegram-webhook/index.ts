import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sendBotMessage(token: string, chatId: number, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Keep webhook responses free of tokens, chat data, and message contents.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  if (!projectUrl || !serviceKey || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    return new Response("Service unavailable", { status: 503 });
  }

  const expectedSecret = await sha256(`nexproxy-telegram-webhook-v1:${botToken}:${projectUrl}`);
  const suppliedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) return new Response("Unauthorized", { status: 401 });

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 64 * 1024) return new Response("Payload too large", { status: 413 });
  const rawBody = await req.text();
  if (rawBody.length > 64 * 1024) return new Response("Payload too large", { status: 413 });

  let update: any;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = update?.message;
  const chatId = message?.chat?.id;
  if (message?.chat?.type !== "private" || !Number.isSafeInteger(chatId) || chatId <= 0) {
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const startMatch = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{8,64}))?\s*$/.exec(text);
  if (!startMatch) {
    await sendBotMessage(botToken, chatId, "To link this Telegram chat, sign in to your NexProxy account, choose Connect Telegram, then open the link and press Start.");
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  const payload = startMatch[1];
  if (!payload) {
    await sendBotMessage(botToken, chatId, "To link this Telegram chat, sign in to NexProxy and choose Connect Telegram from your account profile.");
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await sha256(payload);
  const username = typeof message?.from?.username === "string" ? message.from.username.slice(0, 32) : null;
  const { data, error } = await admin.rpc("complete_telegram_link", {
    p_token_hash: tokenHash,
    p_chat_id: chatId,
    p_username: username,
  });

  if (error || data?.success !== true) {
    await sendBotMessage(botToken, chatId, "This NexProxy link has expired or was already used. Sign in and request a fresh Telegram link.");
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  await sendBotMessage(botToken, chatId, "Your Telegram chat is now connected to your NexProxy account. After payment is verified and a proxy is assigned, delivery details will be sent here.");
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});
