import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type SmsPayload = {
  user?: { phone?: string };
  sms?: { otp?: string };
};

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const reply = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function whatsappAddress(value: string): string {
  const normalized = value.trim().replace(/^whatsapp:/i, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Invalid phone number format.");
  }
  return `whatsapp:${normalized}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_WHATSAPP_NUMBER");
  const contentSid = Deno.env.get("TWILIO_WHATSAPP_CONTENT_SID");
  if (!hookSecret || !accountSid || !authToken || !fromNumber || !contentSid) {
    return reply(500, { error: "WhatsApp delivery is not configured." });
  }

  try {
    const raw = await req.text();
    if (raw.length > 64_000) return reply(413, { error: "Payload too large." });

    const verifier = new Webhook(hookSecret.replace(/^v1,whsec_/, ""));
    const payload = verifier.verify(raw, Object.fromEntries(req.headers.entries())) as SmsPayload;
    const phone = payload.user?.phone;
    const otp = payload.sms?.otp;
    if (!phone || !otp || !/^\d{4,10}$/.test(otp)) {
      return reply(400, { error: "Invalid verification request." });
    }

    const to = whatsappAddress(phone);
    const from = whatsappAddress(fromNumber);
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const form = new URLSearchParams({
      To: to,
      From: from,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({ "1": otp }),
    });
    const authorization = btoa(`${accountSid}:${authToken}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });

    if (!response.ok) {
      console.error("WhatsApp OTP provider rejected a request", { status: response.status });
      return reply(502, { error: "Unable to send the WhatsApp verification code." });
    }

    return reply(200, {});
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error.";
    const status = reason === "Invalid phone number format." ? 400 : 500;
    console.error("WhatsApp OTP hook failed", { reason: status === 400 ? reason : "Hook verification or delivery failed." });
    return reply(status, { error: status === 400 ? reason : "Unable to send the WhatsApp verification code." });
  }
});
