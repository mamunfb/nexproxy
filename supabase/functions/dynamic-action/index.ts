import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const ORDER_EMAIL_COPY = {
  order_received: {
    subject: "NexProxy — অর্ডার গ্রহণ করা হয়েছে / Order received",
    title: "আপনার অর্ডার গ্রহণ করা হয়েছে",
    bn: "আপনার অর্ডারটি NexProxy-তে সংরক্ষিত হয়েছে। অর্ডার নম্বরটি ভবিষ্যৎ যোগাযোগের জন্য রেখে দিন।",
    en: "Your order has been recorded by NexProxy. Keep this order number for future support requests.",
  },
  payment_submitted: {
    subject: "NexProxy — পেমেন্ট তথ্য জমা হয়েছে / Payment submitted",
    title: "পেমেন্ট তথ্য জমা হয়েছে",
    bn: "আপনার পেমেন্ট তথ্য জমা হয়েছে এবং যাচাইয়ের অপেক্ষায় আছে। যাচাই শেষ হলে আমরা আরেকটি ইমেইল পাঠাব।",
    en: "Your payment information has been submitted and is awaiting review. We will email you when verification is complete.",
  },
  payment_verified: {
    subject: "NexProxy — পেমেন্ট যাচাই সম্পন্ন / Payment verified",
    title: "পেমেন্ট যাচাই সম্পন্ন",
    bn: "আপনার পেমেন্ট যাচাই করা হয়েছে। আপনার অর্ডারের পরবর্তী ধাপ NexProxy টিম সম্পন্ন করছে।",
    en: "Your payment has been verified. The NexProxy team is processing the next step for your order.",
  },
  proxy_assigned: {
    subject: "NexProxy — অর্ডারের আপডেট / Order update",
    title: "আপনার অর্ডার আপডেট হয়েছে",
    bn: "আপনার অর্ডারে সার্ভিস বরাদ্দ করা হয়েছে। নিরাপত্তার জন্য কোনো proxy access credential এই ইমেইলে পাঠানো হয়নি।",
    en: "A service has been assigned to your order. For security, proxy access credentials are not included in this email.",
  },
} as const;

type OrderEmailEvent = keyof typeof ORDER_EMAIL_COPY;

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>\"']/g, (character) => replacements[character] || character);
}

async function sendOrderEmail(admin: any, order: any, eventType: OrderEmailEvent) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const fromEmail = Deno.env.get("BREVO_FROM_EMAIL");
  if (!apiKey || !fromEmail) return { sent: false, reason: "provider_unconfigured" };

  const { data: customerData, error: customerError } = await admin.auth.admin.getUserById(String(order.customer_id));
  if (customerError) throw customerError;
  const recipient = customerData?.user?.email;
  if (!recipient || !customerData?.user?.email_confirmed_at) {
    return { sent: false, reason: "recipient_not_verified" };
  }

  const eventKey = `${eventType}:${order.order_id}`;
  let eventRow: any;
  const { data: inserted, error: insertError } = await admin
    .from("transactional_email_events")
    .insert({ event_key: eventKey, order_id: order.order_id, event_type: eventType, status: "SENDING", attempts: 1 })
    .select("id,attempts")
    .single();

  if (!insertError) {
    eventRow = inserted;
  } else if (insertError.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("transactional_email_events")
      .select("id,status,attempts")
      .eq("event_key", eventKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return { sent: false, reason: "event_unavailable" };
    if (existing.status === "SENT") return { sent: true, alreadySent: true };
    if (existing.status === "SENDING") return { sent: false, inProgress: true };
    if (!["FAILED", "PENDING"].includes(existing.status) || Number(existing.attempts) >= 3) {
      return { sent: false, reason: "retry_limit_reached" };
    }
    const { data: retried, error: retryError } = await admin
      .from("transactional_email_events")
      .update({ status: "SENDING", attempts: Number(existing.attempts) + 1, error_code: null, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id,attempts")
      .maybeSingle();
    if (retryError) throw retryError;
    if (!retried) return { sent: false, inProgress: true };
    eventRow = retried;
  } else {
    throw insertError;
  }

  const copy = ORDER_EMAIL_COPY[eventType];
  const orderId = escapeHtml(String(order.order_id));
  const siteUrl = "https://nexproxy.mynexproxy.workers.dev/";
  const htmlContent = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#182230"><div style="max-width:600px;margin:32px auto;padding:28px;background:#fff;border-radius:12px"><h1 style="font-size:22px">${copy.title}</h1><p>${copy.bn}</p><p>${copy.en}</p><p><strong>অর্ডার নম্বর / Order ID:</strong> ${orderId}</p><p><a href="${siteUrl}" style="display:inline-block;padding:12px 18px;background:#175cd3;color:#fff;text-decoration:none;border-radius:8px">NexProxy খুলুন / Visit NexProxy</a></p><p style="font-size:12px;color:#667085">এই ইমেইলে proxy access credential নেই। / This email does not contain proxy access credentials.</p></div></body></html>`;
  const textContent = `${copy.title}\n\n${copy.bn}\n${copy.en}\n\nOrder ID: ${String(order.order_id)}\n${siteUrl}\n\nProxy access credentials are not included in this email.`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "accept": "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: "NexProxy", email: fromEmail },
        to: [{ email: recipient }],
        subject: copy.subject,
        htmlContent,
        textContent,
      }),
    });
    if (!response.ok) {
      await admin.from("transactional_email_events").update({ status: "FAILED", error_code: `BREVO_HTTP_${response.status}`, updated_at: new Date().toISOString() }).eq("id", eventRow.id);
      console.error("Brevo transactional email rejected", eventType, String(order.order_id), response.status);
      return { sent: false, reason: "provider_rejected" };
    }
    const providerResult = await response.json().catch(() => ({}));
    const messageId = typeof providerResult?.messageId === "string" ? providerResult.messageId.slice(0, 200) : null;
    const { error: sentError } = await admin.from("transactional_email_events").update({ status: "SENT", provider_message_id: messageId, error_code: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", eventRow.id);
    if (sentError) throw sentError;
    return { sent: true };
  } catch (error) {
    await admin.from("transactional_email_events").update({ status: "FAILED", error_code: "SEND_REQUEST_FAILED", updated_at: new Date().toISOString() }).eq("id", eventRow.id);
    console.error("Brevo transactional email request failed", eventType, String(order.order_id), error instanceof Error ? error.name : "Error");
    return { sent: false, reason: "provider_unavailable" };
  }
}

function safeTelegramLine(value: unknown, maxLength = 240): string {
  return String(value ?? "").replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, maxLength);
}

async function sendTelegramProxyDelivery(admin: any, order: any) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return { sent: false, reason: "provider_unconfigured" };
  let activeEventId: string | null = null;

  try {
    const { data: contact, error: contactError } = await admin
      .from("customer_contact_methods")
      .select("telegram_chat_id,telegram_verified_at")
      .eq("customer_id", order.customer_id)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact?.telegram_chat_id || !contact.telegram_verified_at) return { sent: false, reason: "telegram_not_linked" };

    const { data: assignment, error: assignmentError } = await admin
      .from("proxy_assignments")
      .select("id,proxy_nickname,proxy_number,host,port,duration_days,expires_at,status")
      .eq("order_id", order.order_id)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return { sent: false, reason: "assignment_not_found" };

    const eventKey = `proxy_assigned:${order.order_id}:${assignment.id}`;
    let eventRow: any;
    const { data: inserted, error: insertError } = await admin
      .from("telegram_delivery_events")
      .insert({ event_key: eventKey, order_id: order.order_id, assignment_id: assignment.id, status: "SENDING", attempts: 1 })
      .select("id,attempts")
      .single();
    if (!insertError) {
      eventRow = inserted;
    } else if (insertError.code === "23505") {
      const { data: existing, error: existingError } = await admin
        .from("telegram_delivery_events")
        .select("id,status,attempts")
        .eq("event_key", eventKey)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return { sent: false, reason: "event_unavailable" };
      if (existing.status === "SENT") return { sent: true, alreadySent: true };
      if (existing.status === "SENDING") return { sent: false, inProgress: true };
      if (Number(existing.attempts) >= 3) return { sent: false, reason: "retry_limit_reached" };
      const { data: retried, error: retryError } = await admin
        .from("telegram_delivery_events")
        .update({ status: "SENDING", attempts: Number(existing.attempts) + 1, error_code: null, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("status", existing.status)
        .select("id,attempts")
        .maybeSingle();
      if (retryError) throw retryError;
      if (!retried) return { sent: false, inProgress: true };
      eventRow = retried;
    } else {
      throw insertError;
    }
    activeEventId = eventRow.id;

    const lines = [
      "NexProxy — your proxy is ready",
      `Order ID: ${safeTelegramLine(order.order_id, 80)}`,
      `Proxy: ${safeTelegramLine(assignment.proxy_nickname)}`,
      `Address: ${safeTelegramLine(assignment.proxy_number)}`,
    ];
    if (assignment.host) lines.push(`Host: ${safeTelegramLine(assignment.host)}`);
    if (assignment.port) lines.push(`Port: ${safeTelegramLine(assignment.port)}`);
    if (assignment.expires_at) lines.push(`Expires: ${safeTelegramLine(assignment.expires_at, 80)}`);
    lines.push("Keep these connection details private. Contact NexProxy support if you need help.");

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: contact.telegram_chat_id, text: lines.join("\n") }),
    });
    const providerResult = await response.json().catch(() => null);
    if (!response.ok || providerResult?.ok !== true) {
      await admin.from("telegram_delivery_events").update({ status: "FAILED", error_code: `TELEGRAM_HTTP_${response.status}`, updated_at: new Date().toISOString() }).eq("id", eventRow.id);
      console.warn("Telegram proxy delivery rejected", response.status);
      return { sent: false, reason: "provider_rejected" };
    }
    const providerMessageId = Number.isSafeInteger(providerResult?.result?.message_id)
      ? String(providerResult.result.message_id)
      : null;
    const { error: sentError } = await admin.from("telegram_delivery_events").update({ status: "SENT", provider_message_id: providerMessageId, error_code: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", eventRow.id);
    if (sentError) throw sentError;
    return { sent: true };
  } catch (error) {
    if (activeEventId) {
      await admin.from("telegram_delivery_events").update({ status: "FAILED", error_code: "SEND_REQUEST_FAILED", updated_at: new Date().toISOString() }).eq("id", activeEventId);
    }
    console.error("Telegram proxy delivery failed", error instanceof Error ? error.name : "Error");
    return { sent: false, reason: "provider_unavailable" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed." });

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) return json(500, { success: false, error: "Server configuration is incomplete." });

  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  async function signedInUser() {
    if (!token) throw new Error("Sign in is required.");
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) throw new Error("Your session is invalid or expired.");
    return data.user;
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      if (form.get("action") !== "upload_payment_proof") return json(400, { success: false, error: "Unknown action." });
      const user = await signedInUser();
      const orderId = String(form.get("orderId") || "").trim();
      const email = String(form.get("email") || "").trim().toLowerCase();
      const file = form.get("file");
      if (!(file instanceof File)) return json(400, { success: false, error: "Payment screenshot is required." });
      if (file.size < 1 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return json(400, { success: false, error: "Payment screenshot must be JPG, PNG, or WEBP and 5 MB or smaller." });
      }
      const { data: order, error: orderError } = await admin.from("orders").select("order_id,email,payment_status").eq("order_id", orderId).eq("customer_id", user.id).maybeSingle();
      if (orderError) throw orderError;
      if (!order || String(order.email).toLowerCase() !== email) return json(404, { success: false, error: "Order not found for this account." });
      if (order.payment_status !== "UNPAID") return json(409, { success: false, error: "Payment has already been submitted or processed." });

      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      const objectPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage.from("payment-proofs").upload(objectPath, bytes, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: proof, error: proofError } = await admin.from("payment_proofs").insert({ order_id: orderId, customer_id: user.id, object_path: objectPath, mime_type: file.type, size_bytes: file.size }).select("id,order_id,created_at").single();
      if (proofError) {
        await admin.storage.from("payment-proofs").remove([objectPath]);
        throw proofError;
      }
      return json(200, { success: true, proof: { id: proof.id, orderId: proof.order_id, createdAt: proof.created_at } });
    }

    const body = await req.json();
    const action = String(body?.action || "");
    if (action === "get_payment_settings") {
      const { data, error } = await admin.from("payment_settings").select("wallet_address,enabled").eq("enabled", true).order("id", { ascending: true }).limit(20);
      if (error) throw error;
      return json(200, { success: true, paymentSettings: data || [] });
    }

    if (action === "send_order_notification") {
      const user = await signedInUser();
      const orderId = String(body?.orderId || "").trim();
      const eventType = String(body?.event || "") as OrderEmailEvent;
      if (!/^[A-Za-z0-9-]{6,80}$/.test(orderId) || !Object.prototype.hasOwnProperty.call(ORDER_EMAIL_COPY, eventType)) {
        return json(400, { success: false, error: "Invalid order notification request." });
      }
      const { data: order, error: orderError } = await admin.from("orders").select("order_id,customer_id,payment_status,order_status").eq("order_id", orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json(404, { success: false, error: "Order not found." });
      const isAdmin = user.email?.toLowerCase() === "mamunfb13@gmail.com";
      if ((eventType === "order_received" || eventType === "payment_submitted") && order.customer_id !== user.id) return json(403, { success: false, error: "Order access denied." });
      if ((eventType === "payment_verified" || eventType === "proxy_assigned") && !isAdmin) return json(403, { success: false, error: "Admin access required." });
      if (eventType === "payment_submitted" && order.payment_status !== "PAYMENT_SUBMITTED") return json(409, { success: false, error: "Payment is not awaiting review." });
      if (eventType === "payment_verified" && order.payment_status !== "PAYMENT_VERIFIED") return json(409, { success: false, error: "Payment is not verified." });
      if (eventType === "proxy_assigned") {
        const { data: fulfillment, error: fulfillmentError } = await admin.from("proxy_fulfillments").select("status,proxy_assigned").eq("order_id", orderId).maybeSingle();
        if (fulfillmentError) throw fulfillmentError;
        if (!fulfillment || fulfillment.status !== "ASSIGNED" || fulfillment.proxy_assigned !== true) return json(409, { success: false, error: "Proxy service is not assigned." });
      }
      const notification = await sendOrderEmail(admin, order, eventType);
      const telegramDelivery = eventType === "proxy_assigned"
        ? await sendTelegramProxyDelivery(admin, order)
        : null;
      return json(200, {
        success: true,
        emailSent: notification.sent,
        alreadySent: notification.alreadySent === true,
        reason: notification.reason || null,
        telegramSent: telegramDelivery?.sent === true,
        telegramDeliveryReason: telegramDelivery?.reason || null,
      });
    }

    if (action === "submit_payment") {
      const user = await signedInUser();
      const orderId = String(body?.orderId || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const paymentMethod = String(body?.paymentMethod || "").trim().slice(0, 80);
      const paymentReference = String(body?.paymentReference || "").trim().slice(0, 200);
      if (!orderId || !paymentMethod || !paymentReference) return json(400, { success: false, error: "Order, payment method, and transaction reference are required." });
      const { data: order, error: lookupError } = await admin.from("orders").select("order_id,customer_id,email,payment_status,plan_price,order_status").eq("order_id", orderId).eq("customer_id", user.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!order || String(order.email).toLowerCase() !== email) return json(404, { success: false, error: "Order not found for this account." });
      if (Number(order.plan_price) <= 0) return json(409, { success: false, error: "This order does not require payment." });
      if (order.payment_status !== "UNPAID") return json(409, { success: false, error: "Payment has already been submitted or processed." });
      const { data: updated, error: updateError } = await admin.from("orders").update({ payment_method: paymentMethod, payment_reference: paymentReference, payment_status: "PAYMENT_SUBMITTED", payment_submitted_at: new Date().toISOString(), order_status: "PAYMENT_SUBMITTED", updated_at: new Date().toISOString() }).eq("order_id", orderId).eq("customer_id", user.id).eq("payment_status", "UNPAID").select("order_id").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return json(409, { success: false, error: "Payment has already been submitted or processed." });
      const notification = await sendOrderEmail(admin, order, "payment_submitted");
      return json(200, { success: true, orderId: updated.order_id, paymentStatus: "PAYMENT_SUBMITTED", emailSent: notification.sent });
    }

    if (action === "get_payment_proof") {
      const user = await signedInUser();
      if (user.email?.toLowerCase() !== "mamunfb13@gmail.com") return json(403, { success: false, error: "Admin access required." });
      const orderId = String(body?.orderId || "").trim();
      const { data: proof, error } = await admin.from("payment_proofs").select("object_path,mime_type").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!proof) return json(404, { success: false, error: "No payment proof found." });
      const { data: signed, error: signError } = await admin.storage.from("payment-proofs").createSignedUrl(proof.object_path, 60);
      if (signError) throw signError;
      return json(200, { success: true, url: signed.signedUrl, mimeType: proof.mime_type });
    }
    return json(400, { success: false, error: "Unknown action." });
  } catch (error) {
    console.error("dynamic-action error", error);
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = /sign in|session is invalid/i.test(message) ? 401 : 500;
    return json(status, { success: false, error: message });
  }
});
