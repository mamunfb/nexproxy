"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const SUPABASE_URL = process.env.NEXPROXY_SUPABASE_URL || "https://mviohrcnkxodltwjqvyy.supabase.co";
const SUPABASE_KEY = process.env.NEXPROXY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_11NXDnWbGN15coE7_Yu1Hw_AiUWdool";
const MAX_BODY_BYTES = 128 * 1024;
let databaseReady = false;
let databaseError = null;

const seedPosts = [
  {
    slug: "what-is-a-mobile-proxy",
    title: "What Is a Mobile Proxy and When Should You Use One?",
    category: "Proxy basics",
    read_time: "6 min read",
    excerpt: "A clear introduction to mobile proxy routing, carrier IPs, and the professional workflows that benefit from a real mobile network connection.",
    content: "A mobile proxy routes a request through an internet connection provided by a mobile carrier. Instead of appearing from a typical data-center IP, the request uses an address associated with a 4G or 5G network.\n\nThat distinction can matter when you are testing a location-specific experience, validating how a website behaves on a mobile network, or researching publicly available information from a USA audience perspective. Mobile proxies are especially useful when the workflow needs carrier context rather than just a different server location.\n\nChoose a mobile proxy when the network type is part of the test. For ordinary development traffic, a standard server may be enough; for carrier-aware testing, dedicated mobile access gives you a more relevant signal."
  },
  {
    slug: "test-a-proxy-before-production",
    title: "How to Test a Proxy Before Using It in Production",
    category: "Testing",
    read_time: "5 min read",
    excerpt: "Use a simple checklist to verify connectivity, location, protocol support, speed, and consistency before a proxy becomes part of a larger workflow.",
    content: "Start with the basics: confirm that the proxy connects through the expected HTTP or SOCKS5 protocol, then check the returned IP and country. A successful connection is only the first step; the result should match the location and network characteristics your workflow requires.\n\nNext, run a small repeatable request set. Compare response time, error rate, and behavior across several requests rather than judging the proxy from one result. If the task is sensitive to session continuity, keep the same proxy active while you test the complete flow.\n\nFinally, document the baseline. A short record of the IP, protocol, latency, and test date makes it easier to spot changes later."
  },
  {
    slug: "carrier-and-state-selection",
    title: "Why Carrier and State Selection Can Matter",
    category: "Location & carriers",
    read_time: "4 min read",
    excerpt: "Location is not always just a country. Learn how carrier and state context can improve QA, campaign verification, and regional research.",
    content: "A USA IP can still be too broad for a location-aware workflow. Your test may depend on a particular state, or the experience may vary between AT&T, Verizon, and T-Mobile network environments.\n\nCarrier and state context helps teams reproduce a real-world audience more accurately. QA teams can compare regional experiences, marketers can verify location-based pages, and researchers can keep their collection conditions consistent.\n\nAvailability changes with inventory, so treat a requested carrier or state as a test requirement to verify—not as a permanent guarantee. Record the assigned details alongside your test results."
  },
  {
    slug: "reliable-proxy-workflow",
    title: "5 Habits for a More Reliable Proxy Workflow",
    category: "Best practices",
    read_time: "5 min read",
    excerpt: "Small operational habits—clear test goals, sensible pacing, and useful logs—can make proxy-based work easier to maintain.",
    content: "1. Define the job first. Match the proxy type and location to the task instead of choosing on speed alone. 2. Keep requests purposeful. Follow the destination's terms and acceptable-use rules.\n\n3. Use a repeatable test. A consistent health check reveals changes earlier. 4. Log useful context. Keep timestamps, protocol, region, and error details so a problem is diagnosable.\n\n5. Plan a replacement path. If an assigned proxy becomes unavailable, a documented support or replacement process keeps the rest of the workflow moving."
  }
];

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function errorResponse(res, status, message) { jsonResponse(res, status, { error: message }); }
function normalizeSlug(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140); }
function cleanText(value, maxLength) { return String(value || "").trim().slice(0, maxLength); }
function publicPost(row) { return { id: row.id, slug: row.slug, title: row.title, category: row.category, read_time: row.read_time, excerpt: row.excerpt, content: row.content, published: Boolean(row.published), created_at: row.created_at, updated_at: row.updated_at }; }

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] || req.socket.remoteAddress || "").trim();
}

function countryFromHeaders(req) {
  const value = req.headers["x-vercel-ip-country"] || req.headers["cloudfront-viewer-country"] || req.headers["x-country-code"];
  return String(value || "").trim().toUpperCase().match(/^[A-Z]{2}$/)?.[0] || "";
}

async function detectCountry(req) {
  const headerCode = countryFromHeaders(req);
  if (headerCode) return { countryCode: headerCode, country: headerCode };

  const ip = clientIp(req);
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return { countryCode: "", country: "Unknown" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: controller.signal, headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => null);
    const countryCode = String(data?.country_code || "").trim().toUpperCase().match(/^[A-Z]{2}$/)?.[0] || "";
    return { countryCode, country: String(data?.country_name || countryCode || "Unknown").trim() || "Unknown" };
  } catch {
    return { countryCode: "", country: "Unknown" };
  } finally {
    clearTimeout(timer);
  }
}

async function initializeDatabase() {
  const result = await supabaseRequest(null, "blog_posts", { select: "id", limit: "1" });
  if (!Array.isArray(result)) throw new Error("Supabase blog API returned an unexpected response.");
  databaseReady = true;
}

async function supabaseRequest(req, resource, query = {}, method = "GET", body = null, prefer = "") {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const headers = { apikey: SUPABASE_KEY, Accept: "application/json" };
  const token = req ? bearerToken(req) : "";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = typeof data === "object" && data ? data.message || data.error || data.hint : "Supabase request failed.";
    throw Object.assign(new Error(message || "Supabase request failed."), { status: response.status, code: data?.code });
  }
  return data;
}
async function readRequestBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw new Error("Request body is too large."); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Request body must be valid JSON."); }
}
function bearerToken(req) { const value = req.headers.authorization || ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }
async function requireAdmin(req) {
  const token = bearerToken(req);
  if (!token) throw Object.assign(new Error("Administrator login required."), { status: 401 });
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) throw Object.assign(new Error("Your session is invalid or expired."), { status: 401 });
  const adminResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  const isAdmin = await adminResponse.json().catch(() => false);
  if (!adminResponse.ok || isAdmin !== true) throw Object.assign(new Error("Administrator access is required."), { status: 403 });
  return user;
}
async function findPost(req, slug, includeUnpublished = false) {
  const query = { select: "*", slug: `eq.${slug}`, limit: "1" };
  if (!includeUnpublished) query.published = "eq.true";
  const rows = await supabaseRequest(req, "blog_posts", query);
  return rows[0] || null;
}
function postInput(body) {
  const title = cleanText(body.title, 220), slug = normalizeSlug(body.slug || title), category = cleanText(body.category, 100) || "Proxy insights", readTime = cleanText(body.read_time, 40) || "5 min read", excerpt = cleanText(body.excerpt, 500), content = cleanText(body.content, 40000);
  if (title.length < 4 || !slug || excerpt.length < 10 || content.length < 3) throw Object.assign(new Error("Title, slug, excerpt, and content are required."), { status: 400 });
  return { title, slug, category, readTime, excerpt, content, published: body.published !== false };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/geo") return jsonResponse(res, 200, await detectCountry(req));
  if (!databaseReady) return errorResponse(res, 503, databaseError?.message || "Blog storage is not ready.");
  if (req.method === "GET" && pathname === "/api/health") return jsonResponse(res, 200, { ok: true, database: true });
  if (req.method === "GET" && pathname === "/api/blog/posts") {
    const posts = await supabaseRequest(req, "blog_posts", { select: "*", published: "eq.true", order: "created_at.desc" });
    return jsonResponse(res, 200, { posts: posts.map(publicPost) });
  }
  const postMatch = pathname.match(/^\/api\/blog\/posts\/([a-z0-9-]+)$/);
  if (req.method === "GET" && postMatch) {
    const post = await findPost(req, postMatch[1]);
    if (!post) return errorResponse(res, 404, "Post not found.");
    const comments = await supabaseRequest(req, "blog_comments", { select: "id,name,content,created_at", post_id: `eq.${post.id}`, approved: "eq.true", order: "created_at.desc" });
    return jsonResponse(res, 200, { post: publicPost(post), comments });
  }
  const commentMatch = pathname.match(/^\/api\/blog\/posts\/([a-z0-9-]+)\/comments$/);
  if (req.method === "POST" && commentMatch) {
    const post = await findPost(req, commentMatch[1]);
    if (!post) return errorResponse(res, 404, "Post not found.");
    const body = await readRequestBody(req), name = cleanText(body.name, 80), email = cleanText(body.email, 160) || null, content = cleanText(body.content, 2000);
    if (name.length < 2) return errorResponse(res, 400, "Please enter your name.");
    if (content.length < 3) return errorResponse(res, 400, "Please enter a comment.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse(res, 400, "Please enter a valid email or leave it blank.");
    await supabaseRequest(req, "blog_comments", { select: "id" }, "POST", { post_id: post.id, name, email, content, approved: false }, "return=minimal");
    return jsonResponse(res, 201, { message: "Thanks. Your comment is awaiting admin approval." });
  }
  const adminRoute = pathname === "/api/admin/blog/posts" || pathname === "/api/admin/blog/comments" || pathname.startsWith("/api/admin/blog/posts/") || pathname.startsWith("/api/admin/blog/comments/");
  if (adminRoute) await requireAdmin(req);
  if (req.method === "GET" && pathname === "/api/admin/blog/posts") {
    const posts = await supabaseRequest(req, "blog_posts", { select: "*", order: "updated_at.desc" });
    return jsonResponse(res, 200, { posts: posts.map(publicPost) });
  }
  if (req.method === "POST" && pathname === "/api/admin/blog/posts") {
    const data = postInput(await readRequestBody(req));
    try {
      const rows = await supabaseRequest(req, "blog_posts", { select: "*" }, "POST", { slug: data.slug, title: data.title, category: data.category, read_time: data.readTime, excerpt: data.excerpt, content: data.content, published: data.published }, "return=representation");
      return jsonResponse(res, 201, { post: publicPost(rows[0]), id: rows[0].id });
    } catch (error) { if (error.code === "23505") return errorResponse(res, 409, "That slug is already in use."); throw error; }
  }
  const adminPostMatch = pathname.match(/^\/api\/admin\/blog\/posts\/([0-9]+)$/);
  if (adminPostMatch && ["PUT", "DELETE"].includes(req.method)) {
    const id = adminPostMatch[1];
    if (req.method === "DELETE") {
      await supabaseRequest(req, "blog_posts", { id: `eq.${id}` }, "DELETE", null, "return=minimal");
      return jsonResponse(res, 200, { ok: true });
    }
    const data = postInput(await readRequestBody(req));
    try {
      const rows = await supabaseRequest(req, "blog_posts", { id: `eq.${id}`, select: "*" }, "PATCH", { slug: data.slug, title: data.title, category: data.category, read_time: data.readTime, excerpt: data.excerpt, content: data.content, published: data.published, updated_at: new Date().toISOString() }, "return=representation");
      return rows[0] ? jsonResponse(res, 200, { post: publicPost(rows[0]) }) : errorResponse(res, 404, "Post not found.");
    } catch (error) { if (error.code === "23505") return errorResponse(res, 409, "That slug is already in use."); throw error; }
  }
  if (req.method === "GET" && pathname === "/api/admin/blog/comments") {
    const comments = await supabaseRequest(req, "blog_comments", { select: "id,name,email,content,approved,created_at,post:blog_posts(title,slug)", order: "created_at.desc" });
    return jsonResponse(res, 200, { comments: comments.map((comment) => ({ ...comment, post_title: comment.post?.title || "", post_slug: comment.post?.slug || "" })) });
  }
  const adminCommentMatch = pathname.match(/^\/api\/admin\/blog\/comments\/([0-9]+)$/);
  if (adminCommentMatch && ["PATCH", "DELETE"].includes(req.method)) {
    const id = adminCommentMatch[1];
    if (req.method === "DELETE") {
      await supabaseRequest(req, "blog_comments", { id: `eq.${id}` }, "DELETE", null, "return=minimal");
      return jsonResponse(res, 200, { ok: true });
    }
    const body = await readRequestBody(req);
    await supabaseRequest(req, "blog_comments", { id: `eq.${id}` }, "PATCH", { approved: Boolean(body.approved) }, "return=minimal");
    return jsonResponse(res, 200, { ok: true });
  }
  return errorResponse(res, 404, "API route not found.");
}
function contentType(filePath) { return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[path.extname(filePath).toLowerCase()] || "application/octet-stream"; }
function safeFilePath(requestPath) { const candidate = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestPath)}`); return candidate.startsWith(`${PUBLIC_DIR}${path.sep}`) || candidate === PUBLIC_DIR ? candidate : null; }
async function serveStatic(req, res, url) {
  let requestPath = url.pathname;
  if (/^\/blog\/[a-z0-9-]+\/?$/i.test(requestPath) && requestPath !== "/blog/") requestPath = "/blog/post.html";
  else if (requestPath.endsWith("/")) requestPath += "index.html";
  const filePath = safeFilePath(requestPath); if (!filePath) return errorResponse(res, 400, "Invalid path.");
  let stat; try { stat = await fs.promises.stat(filePath); } catch { return errorResponse(res, 404, "Not found."); }
  if (!stat.isFile()) return errorResponse(res, 404, "Not found.");
  const data = await fs.promises.readFile(filePath); res.writeHead(200, { "Content-Type": contentType(filePath), "Content-Length": data.length }); res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try { if (url.pathname.startsWith("/api/")) await handleApi(req, res, url); else await serveStatic(req, res, url); }
  catch (error) { console.error("Request error:", error); errorResponse(res, error.status || 500, error.status ? error.message : "Internal server error."); }
});
initializeDatabase().catch((error) => { databaseError = error; console.error("Database initialization failed:", error.message); }).finally(() => server.listen(PORT, "0.0.0.0", () => console.log(`NexProxy server listening on 0.0.0.0:${PORT}`)));
process.on("SIGTERM", async () => { server.close(() => process.exit(0)); });
