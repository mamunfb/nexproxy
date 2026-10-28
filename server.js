"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const SUPABASE_URL = process.env.NEXPROXY_SUPABASE_URL || "https://fzvxuhumtebqlpwqpkvt.supabase.co";
const SUPABASE_KEY = process.env.NEXPROXY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_gTCygTOFrZc9AnE6QOKAdw_SjPvlHMy";
const MAX_BODY_BYTES = 128 * 1024;
let pool = null;
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
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not available.");
  pool = mysql.createPool({ uri: process.env.DATABASE_URL, waitForConnections: true, connectionLimit: 5, ssl: { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS blog_posts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(160) NOT NULL UNIQUE,
    title VARCHAR(220) NOT NULL,
    category VARCHAR(100) NOT NULL,
    read_time VARCHAR(40) NOT NULL,
    excerpt VARCHAR(500) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    published TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_blog_posts_published (published), INDEX idx_blog_posts_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS blog_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(80) NOT NULL,
    email VARCHAR(160) NULL,
    content TEXT NOT NULL,
    approved TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_blog_comments_post (post_id), INDEX idx_blog_comments_approved (approved),
    CONSTRAINT fk_blog_comments_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM blog_posts");
  if (Number(rows[0].count) === 0) {
    for (const post of seedPosts) await pool.execute("INSERT INTO blog_posts (slug, title, category, read_time, excerpt, content, published) VALUES (?, ?, ?, ?, ?, ?, 1)", [post.slug, post.title, post.category, post.read_time, post.excerpt, post.content]);
  }
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
async function findPost(slug, includeUnpublished = false) {
  const [rows] = await pool.execute(`SELECT * FROM blog_posts WHERE slug = ? ${includeUnpublished ? "" : "AND published = 1"} LIMIT 1`, [slug]);
  return rows[0] || null;
}
function postInput(body) {
  const title = cleanText(body.title, 220), slug = normalizeSlug(body.slug || title), category = cleanText(body.category, 100) || "Proxy insights", readTime = cleanText(body.read_time, 40) || "5 min read", excerpt = cleanText(body.excerpt, 500), content = cleanText(body.content, 40000);
  if (title.length < 4 || !slug || excerpt.length < 10 || content.length < 3) throw Object.assign(new Error("Title, slug, excerpt, and content are required."), { status: 400 });
  return { title, slug, category, readTime, excerpt, content, published: body.published === false ? 0 : 1 };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/geo") return jsonResponse(res, 200, await detectCountry(req));
  if (!pool) return errorResponse(res, 503, databaseError?.message || "Blog storage is not ready.");
  if (req.method === "GET" && pathname === "/api/health") return jsonResponse(res, 200, { ok: true, database: true });
  if (req.method === "GET" && pathname === "/api/blog/posts") {
    const [rows] = await pool.query("SELECT * FROM blog_posts WHERE published = 1 ORDER BY created_at DESC");
    return jsonResponse(res, 200, { posts: rows.map(publicPost) });
  }
  const postMatch = pathname.match(/^\/api\/blog\/posts\/([a-z0-9-]+)$/);
  if (req.method === "GET" && postMatch) {
    const post = await findPost(postMatch[1]); if (!post) return errorResponse(res, 404, "Post not found.");
    const [comments] = await pool.execute("SELECT id, name, content, created_at FROM blog_comments WHERE post_id = ? AND approved = 1 ORDER BY created_at DESC", [post.id]);
    return jsonResponse(res, 200, { post: publicPost(post), comments });
  }
  const commentMatch = pathname.match(/^\/api\/blog\/posts\/([a-z0-9-]+)\/comments$/);
  if (req.method === "POST" && commentMatch) {
    const post = await findPost(commentMatch[1]); if (!post) return errorResponse(res, 404, "Post not found.");
    const body = await readRequestBody(req), name = cleanText(body.name, 80), email = cleanText(body.email, 160) || null, content = cleanText(body.content, 2000);
    if (name.length < 2) return errorResponse(res, 400, "Please enter your name.");
    if (content.length < 3) return errorResponse(res, 400, "Please enter a comment.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse(res, 400, "Please enter a valid email or leave it blank.");
    await pool.execute("INSERT INTO blog_comments (post_id, name, email, content, approved) VALUES (?, ?, ?, ?, 0)", [post.id, name, email, content]);
    return jsonResponse(res, 201, { message: "Thanks. Your comment is awaiting admin approval." });
  }
  const adminRoute = pathname === "/api/admin/blog/posts" || pathname === "/api/admin/blog/comments" || pathname.startsWith("/api/admin/blog/posts/") || pathname.startsWith("/api/admin/blog/comments/");
  if (adminRoute) await requireAdmin(req);
  if (req.method === "GET" && pathname === "/api/admin/blog/posts") {
    const [rows] = await pool.query("SELECT * FROM blog_posts ORDER BY updated_at DESC"); return jsonResponse(res, 200, { posts: rows.map(publicPost) });
  }
  if (req.method === "POST" && pathname === "/api/admin/blog/posts") {
    const data = postInput(await readRequestBody(req));
    try { const [result] = await pool.execute("INSERT INTO blog_posts (slug, title, category, read_time, excerpt, content, published) VALUES (?, ?, ?, ?, ?, ?, ?)", [data.slug, data.title, data.category, data.readTime, data.excerpt, data.content, data.published]); const post = await findPost(data.slug, true); return jsonResponse(res, 201, { post: publicPost(post), id: result.insertId }); }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return errorResponse(res, 409, "That slug is already in use."); throw error; }
  }
  const adminPostMatch = pathname.match(/^\/api\/admin\/blog\/posts\/([0-9]+)$/);
  if (adminPostMatch && ["PUT", "DELETE"].includes(req.method)) {
    const id = Number(adminPostMatch[1]);
    if (req.method === "DELETE") { await pool.execute("DELETE FROM blog_posts WHERE id = ?", [id]); return jsonResponse(res, 200, { ok: true }); }
    const data = postInput(await readRequestBody(req));
    try { await pool.execute("UPDATE blog_posts SET slug = ?, title = ?, category = ?, read_time = ?, excerpt = ?, content = ?, published = ? WHERE id = ?", [data.slug, data.title, data.category, data.readTime, data.excerpt, data.content, data.published, id]); const [rows] = await pool.execute("SELECT * FROM blog_posts WHERE id = ? LIMIT 1", [id]); return rows[0] ? jsonResponse(res, 200, { post: publicPost(rows[0]) }) : errorResponse(res, 404, "Post not found."); }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return errorResponse(res, 409, "That slug is already in use."); throw error; }
  }
  if (req.method === "GET" && pathname === "/api/admin/blog/comments") {
    const [rows] = await pool.query("SELECT c.id, c.name, c.email, c.content, c.approved, c.created_at, p.title AS post_title, p.slug AS post_slug FROM blog_comments c JOIN blog_posts p ON p.id = c.post_id ORDER BY c.created_at DESC"); return jsonResponse(res, 200, { comments: rows });
  }
  const adminCommentMatch = pathname.match(/^\/api\/admin\/blog\/comments\/([0-9]+)$/);
  if (adminCommentMatch && ["PATCH", "DELETE"].includes(req.method)) {
    const id = Number(adminCommentMatch[1]);
    if (req.method === "DELETE") { await pool.execute("DELETE FROM blog_comments WHERE id = ?", [id]); return jsonResponse(res, 200, { ok: true }); }
    const body = await readRequestBody(req); await pool.execute("UPDATE blog_comments SET approved = ? WHERE id = ?", [body.approved ? 1 : 0, id]); return jsonResponse(res, 200, { ok: true });
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
process.on("SIGTERM", async () => { if (pool) await pool.end().catch(() => {}); server.close(() => process.exit(0)); });
