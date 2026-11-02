import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type User = { email?: string; new_email?: string };
type EmailData = {
  email_action_type?: string; token?: string; token_hash?: string;
  token_new?: string; token_hash_new?: string; redirect_to?: string;
};
type Payload = { user?: User; email_data?: EmailData };
type Mail = { to: string; action: string; hash?: string; token?: string; redirect?: string };

const copy: Record<string, { subject: string; title: string; en: string; bn: string }> = {
  signup: { subject: "Welcome to Nexproxy — confirm your email", title: "Welcome to Nexproxy / Nexproxy-তে স্বাগতম", en: "Welcome! Confirm this address to finish creating your Nexproxy account.", bn: "Nexproxy-তে স্বাগতম! অ্যাকাউন্ট তৈরি সম্পন্ন করতে এই ইমেইল ঠিকানাটি নিশ্চিত করুন।" },
  recovery: { subject: "Reset your Nexproxy password", title: "Reset your password / পাসওয়ার্ড রিসেট করুন", en: "We received a request to reset your password. Use the secure link or one-time code below.", bn: "আপনার পাসওয়ার্ড রিসেটের অনুরোধ পাওয়া গেছে। নিচের নিরাপদ লিংক বা একবার ব্যবহারযোগ্য কোড ব্যবহার করুন।" },
  magiclink: { subject: "Your Nexproxy sign-in link", title: "Sign in to Nexproxy / Nexproxy-তে সাইন ইন করুন", en: "Use the secure link or one-time code below to sign in.", bn: "সাইন ইন করতে নিচের নিরাপদ লিংক বা একবার ব্যবহারযোগ্য কোড ব্যবহার করুন।" },
  invite: { subject: "You are invited to Nexproxy", title: "Nexproxy invitation / Nexproxy আমন্ত্রণ", en: "Use the link below to accept your invitation.", bn: "আমন্ত্রণ গ্রহণ করতে নিচের লিংকটি ব্যবহার করুন।" },
  email_change: { subject: "Confirm your Nexproxy email change", title: "Confirm email change / ইমেইল পরিবর্তন নিশ্চিত করুন", en: "Use the secure link or code below to confirm this email change.", bn: "ইমেইল পরিবর্তন নিশ্চিত করতে নিচের নিরাপদ লিংক বা কোড ব্যবহার করুন।" },
  reauthentication: { subject: "Your Nexproxy verification code", title: "Verify your identity / পরিচয় যাচাই করুন", en: "Use this one-time code to verify your identity.", bn: "আপনার পরিচয় যাচাই করতে এই একবার ব্যবহারযোগ্য কোডটি ব্যবহার করুন।" },
  password_changed_notification: { subject: "Your Nexproxy password was changed", title: "Password changed / পাসওয়ার্ড পরিবর্তিত হয়েছে", en: "Your Nexproxy password was changed. If you did not do this, contact support immediately.", bn: "আপনার Nexproxy পাসওয়ার্ড পরিবর্তিত হয়েছে। আপনি এটি না করে থাকলে দ্রুত সহায়তায় যোগাযোগ করুন।" },
  email_changed_notification: { subject: "Your Nexproxy email was changed", title: "Email changed / ইমেইল পরিবর্তিত হয়েছে", en: "Your account email was changed. If you did not do this, contact support immediately.", bn: "আপনার অ্যাকাউন্টের ইমেইল পরিবর্তিত হয়েছে। আপনি এটি না করে থাকলে দ্রুত সহায়তায় যোগাযোগ করুন।" },
  phone_changed_notification: { subject: "Your Nexproxy phone number was changed", title: "Phone number changed / ফোন নম্বর পরিবর্তিত হয়েছে", en: "Your account phone number was changed. If you did not do this, contact support.", bn: "আপনার অ্যাকাউন্টের ফোন নম্বর পরিবর্তিত হয়েছে। আপনি এটি না করে থাকলে সহায়তায় যোগাযোগ করুন।" },
  identity_linked_notification: { subject: "A sign-in method was added to Nexproxy", title: "Sign-in method added / সাইন-ইন পদ্ধতি যোগ হয়েছে", en: "A new sign-in method was linked to your account. If you did not do this, contact support.", bn: "আপনার অ্যাকাউন্টে নতুন সাইন-ইন পদ্ধতি যুক্ত হয়েছে। আপনি এটি না করে থাকলে সহায়তায় যোগাযোগ করুন।" },
  identity_unlinked_notification: { subject: "A sign-in method was removed from Nexproxy", title: "Sign-in method removed / সাইন-ইন পদ্ধতি সরানো হয়েছে", en: "A sign-in method was removed from your account. If you did not do this, contact support.", bn: "আপনার অ্যাকাউন্ট থেকে একটি সাইন-ইন পদ্ধতি সরানো হয়েছে। আপনি এটি না করে থাকলে সহায়তায় যোগাযোগ করুন।" },
  mfa_factor_enrolled_notification: { subject: "Two-factor authentication was enabled", title: "Two-factor authentication enabled / দুই-ধাপ যাচাই চালু হয়েছে", en: "Two-factor authentication was enabled on your account. If you did not do this, contact support.", bn: "আপনার অ্যাকাউন্টে দুই-ধাপ যাচাই চালু হয়েছে। আপনি এটি না করে থাকলে সহায়তায় যোগাযোগ করুন।" },
  mfa_factor_unenrolled_notification: { subject: "Two-factor authentication was disabled", title: "Two-factor authentication disabled / দুই-ধাপ যাচাই বন্ধ হয়েছে", en: "Two-factor authentication was disabled on your account. If you did not do this, contact support.", bn: "আপনার অ্যাকাউন্টে দুই-ধাপ যাচাই বন্ধ হয়েছে। আপনি এটি না করে থাকলে সহায়তায় যোগাযোগ করুন।" },
};

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, body: Record<string, unknown> = {}) => new Response(JSON.stringify(body), { status, headers });
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);

function linkFor(base: string, hash: string, action: string, redirect?: string) {
  const u = new URL("/auth/v1/verify", base);
  u.searchParams.set("token", hash);
  u.searchParams.set("type", action);
  if (redirect) u.searchParams.set("redirect_to", redirect);
  return u.toString();
}

function messages(payload: Payload): Mail[] {
  const u = payload.user, d = payload.email_data, action = d?.email_action_type || "";
  if (!u?.email || !action) throw new Error("Incomplete Supabase Auth payload.");
  if (action === "email_change") {
    const result: Mail[] = [];
    // With secure email change, Supabase maps token_hash_new to the current email
    // and token_hash to the new email.
    if (u.email && d.token_hash_new && d.token) result.push({ to: u.email, action, hash: d.token_hash_new, token: d.token, redirect: d.redirect_to });
    if (u.new_email && d.token_hash && (d.token_new || d.token)) result.push({ to: u.new_email, action, hash: d.token_hash, token: d.token_new || d.token, redirect: d.redirect_to });
    if (!result.length) result.push({ to: u.new_email || u.email, action, hash: d.token_hash || d.token_hash_new, token: d.token || d.token_new, redirect: d.redirect_to });
    return result;
  }
  return [{ to: u.email, action, hash: d.token_hash || d.token_hash_new, token: d.token || d.token_new, redirect: d.redirect_to }];
}

async function send(mail: Mail, base: string) {
  const key = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_FROM_EMAIL") || "mamunfb13@gmail.com";
  if (!key) throw new Error("Brevo is not configured.");
  const text = copy[mail.action] || { subject: "Nexproxy account update", title: "Nexproxy account update / Nexproxy অ্যাকাউন্ট আপডেট", en: "This is an account security notice.", bn: "এটি আপনার অ্যাকাউন্ট নিরাপত্তা সংক্রান্ত বার্তা।" };
  const url = mail.hash ? linkFor(base, mail.hash, mail.action, mail.redirect) : undefined;
  const buttonLabel = mail.action === "recovery" ? "Reset password / পাসওয়ার্ড রিসেট" : mail.action === "invite" ? "Accept invitation / আমন্ত্রণ গ্রহণ" : mail.action === "magiclink" ? "Sign in / সাইন ইন" : "Confirm / নিশ্চিত করুন";
  const actionButton = url ? `<p style="margin:26px 0"><a href="${html(url)}" style="display:inline-block;background:#14532d;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:bold">${buttonLabel}</a></p>` : "";
  const code = mail.token ? `<p>One-time code / একবার ব্যবহারযোগ্য কোড:</p><p style="font-size:26px;letter-spacing:5px;font-weight:bold">${html(mail.token)}</p>` : "";
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellpadding="24"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:white;border-radius:14px;padding:28px"><tr><td><p style="color:#166534;font-weight:bold">NEXPROXY</p><h1 style="font-size:22px">${text.title}</h1><p>${text.en}</p><p>${text.bn}</p>${actionButton}${code}<p style="font-size:13px;color:#64748b">If you did not request this, ignore this email. / আপনি এই অনুরোধ না করলে ইমেইলটি উপেক্ষা করুন।</p></td></tr></table></td></tr></table></body></html>`;
  const textBody = `${text.title}\n\n${text.en}\n${text.bn}${url ? `\n\nSecure link / নিরাপদ লিংক: ${url}` : ""}${mail.token ? `\n\nOne-time code / একবার ব্যবহারযোগ্য কোড: ${mail.token}` : ""}\n\nIf you did not request this, ignore this email.`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { accept: "application/json", "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ sender: { name: "Nexproxy", email: sender }, to: [{ email: mail.to }], subject: text.subject, htmlContent: htmlBody, textContent: textBody, tags: ["nexproxy-auth", mail.action.slice(0, 60)] }),
  });
  if (!res.ok) {
    console.error("Brevo rejected an Auth email", { status: res.status, action: mail.action });
    throw new Error("Brevo rejected the message.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  const key = Deno.env.get("BREVO_API_KEY"), secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET"), base = Deno.env.get("SUPABASE_URL");
  if (!key || !secret || !base) return reply(500, { error: "Email service is not configured." });
  try {
    const raw = await req.text();
    if (raw.length > 256_000) return reply(413, { error: "Payload too large." });
    const hook = new Webhook(secret.replace(/^v1,whsec_/, ""));
    const payload = hook.verify(raw, Object.fromEntries(req.headers.entries())) as Payload;
    for (const mail of messages(payload)) await send(mail, base);
    return reply(200, {});
  } catch (error) {
    console.error("Supabase Auth email hook failed", { reason: (error instanceof Error ? error.message : "unknown").slice(0, 160) });
    return reply(500, { error: "Unable to send the authentication email." });
  }
});
