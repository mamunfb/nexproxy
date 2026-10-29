import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

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

    if (action === "submit_payment") {
      const user = await signedInUser();
      const orderId = String(body?.orderId || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const paymentMethod = String(body?.paymentMethod || "").trim().slice(0, 80);
      const paymentReference = String(body?.paymentReference || "").trim().slice(0, 200);
      if (!orderId || !paymentMethod || !paymentReference) return json(400, { success: false, error: "Order, payment method, and transaction reference are required." });
      const { data: order, error: lookupError } = await admin.from("orders").select("order_id,email,payment_status,plan_price").eq("order_id", orderId).eq("customer_id", user.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!order || String(order.email).toLowerCase() !== email) return json(404, { success: false, error: "Order not found for this account." });
      if (Number(order.plan_price) <= 0) return json(409, { success: false, error: "This order does not require payment." });
      if (order.payment_status !== "UNPAID") return json(409, { success: false, error: "Payment has already been submitted or processed." });
      const { data: updated, error: updateError } = await admin.from("orders").update({ payment_method: paymentMethod, payment_reference: paymentReference, payment_status: "PAYMENT_SUBMITTED", payment_submitted_at: new Date().toISOString(), order_status: "PAYMENT_SUBMITTED", updated_at: new Date().toISOString() }).eq("order_id", orderId).eq("customer_id", user.id).eq("payment_status", "UNPAID").select("order_id").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return json(409, { success: false, error: "Payment has already been submitted or processed." });
      return json(200, { success: true, orderId: updated.order_id, paymentStatus: "PAYMENT_SUBMITTED" });
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
