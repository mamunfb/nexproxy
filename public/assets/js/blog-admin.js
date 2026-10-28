"use strict";

let blogAdminClient = null;
let blogAdminSession = null;
let blogAdminPosts = [];

const blogAdmin = {
    section: document.getElementById("admin-blog-section"),
    message: document.getElementById("blog-admin-message"),
    editor: document.getElementById("blog-admin-editor"),
    form: document.getElementById("blog-post-form"),
    id: document.getElementById("blog-post-id"),
    title: document.getElementById("blog-post-title"),
    slug: document.getElementById("blog-post-slug"),
    category: document.getElementById("blog-post-category"),
    readTime: document.getElementById("blog-post-read-time"),
    excerpt: document.getElementById("blog-post-excerpt"),
    content: document.getElementById("blog-post-content"),
    published: document.getElementById("blog-post-published"),
    postsBody: document.getElementById("blog-posts-table-body"),
    commentsBody: document.getElementById("blog-comments-table-body")
};

function blogAdminMessage(text, type = "") {
    if (!blogAdmin.message) return;
    blogAdmin.message.textContent = text;
    blogAdmin.message.className = `admin-table-message ${type}`.trim();
}
function blogAdminEscape(value) { return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" }[character])); }
function blogAdminDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(); }
async function blogAdminRequest(url, options = {}) {
    if (!blogAdminSession?.access_token) throw new Error("Administrator login required.");
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${blogAdminSession.access_token}`, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Admin request failed.");
    return data;
}
function resetBlogEditor() {
    blogAdmin.form.reset(); blogAdmin.id.value = ""; blogAdmin.category.value = "Proxy insights"; blogAdmin.readTime.value = "5 min read"; blogAdmin.published.checked = true;
}
function openBlogEditor(post = null) {
    if (post) { blogAdmin.id.value = post.id; blogAdmin.title.value = post.title; blogAdmin.slug.value = post.slug; blogAdmin.category.value = post.category; blogAdmin.readTime.value = post.read_time; blogAdmin.excerpt.value = post.excerpt; blogAdmin.content.value = post.content; blogAdmin.published.checked = post.published; }
    else resetBlogEditor();
    blogAdmin.editor.classList.remove("is-hidden");
    blogAdmin.title.focus();
}
function renderBlogPosts() {
    blogAdmin.postsBody.innerHTML = blogAdminPosts.length ? blogAdminPosts.map((post) => `<tr><td><strong>${blogAdminEscape(post.title)}</strong><small>/${blogAdminEscape(post.slug)}/</small></td><td><span class="blog-status ${post.published ? "is-published" : "is-draft"}">${post.published ? "Published" : "Draft"}</span></td><td>${blogAdminDate(post.updated_at)}</td><td><button type="button" class="admin-btn admin-btn-secondary blog-edit-post" data-id="${post.id}">Edit</button> <button type="button" class="admin-btn admin-btn-danger blog-delete-post" data-id="${post.id}">Delete</button></td></tr>`).join("") : '<tr><td colspan="4">No posts yet.</td></tr>';
    blogAdmin.postsBody.querySelectorAll(".blog-edit-post").forEach((button) => button.addEventListener("click", () => openBlogEditor(blogAdminPosts.find((post) => String(post.id) === button.dataset.id))));
    blogAdmin.postsBody.querySelectorAll(".blog-delete-post").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Delete this post and its comments?")) return; try { await blogAdminRequest(`/api/admin/blog/posts/${button.dataset.id}`, { method: "DELETE" }); blogAdminMessage("Post deleted.", "success"); await loadBlogAdminData(); } catch (error) { blogAdminMessage(error.message, "error"); } }));
}
function renderBlogComments(comments) {
    blogAdmin.commentsBody.innerHTML = comments.length ? comments.map((comment) => `<tr><td><strong>${blogAdminEscape(comment.name)}</strong><small>${blogAdminEscape(comment.content)}</small></td><td>${blogAdminEscape(comment.post_title)}</td><td><span class="blog-status ${comment.approved ? "is-published" : "is-draft"}">${comment.approved ? "Approved" : "Pending"}</span></td><td>${comment.approved ? `<button type="button" class="admin-btn admin-btn-secondary blog-comment-action" data-action="unapprove" data-id="${comment.id}">Hide</button>` : `<button type="button" class="admin-btn admin-btn-primary blog-comment-action" data-action="approve" data-id="${comment.id}">Approve</button>`} <button type="button" class="admin-btn admin-btn-danger blog-comment-delete" data-id="${comment.id}">Delete</button></td></tr>`).join("") : '<tr><td colspan="4">No comments yet.</td></tr>';
    blogAdmin.commentsBody.querySelectorAll(".blog-comment-action").forEach((button) => button.addEventListener("click", async () => { try { await blogAdminRequest(`/api/admin/blog/comments/${button.dataset.id}`, { method: "PATCH", body: JSON.stringify({ approved: button.dataset.action === "approve" }) }); await loadBlogAdminData(); } catch (error) { blogAdminMessage(error.message, "error"); } }));
    blogAdmin.commentsBody.querySelectorAll(".blog-comment-delete").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Delete this comment?")) return; try { await blogAdminRequest(`/api/admin/blog/comments/${button.dataset.id}`, { method: "DELETE" }); await loadBlogAdminData(); } catch (error) { blogAdminMessage(error.message, "error"); } }));
}
async function loadBlogAdminData() {
    if (!blogAdminSession || !blogAdmin.section) return;
    try { const [posts, comments] = await Promise.all([blogAdminRequest("/api/admin/blog/posts"), blogAdminRequest("/api/admin/blog/comments")]); blogAdminPosts = posts.posts || []; renderBlogPosts(); renderBlogComments(comments.comments || []); } catch (error) { blogAdminMessage(error.message, "error"); }
}
async function initializeBlogAdmin() {
    if (!blogAdmin.section || !window.supabase?.createClient) return;
    blogAdminClient = window.supabase.createClient(window.NEXPROXY_SUPABASE_URL, window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const updateSession = async (session) => { blogAdminSession = session; if (session) await loadBlogAdminData(); };
    const current = await blogAdminClient.auth.getSession();
    await updateSession(current.data?.session || null);
    blogAdminClient.auth.onAuthStateChange((_event, session) => { updateSession(session); });
    document.getElementById("blog-new-post").addEventListener("click", () => openBlogEditor());
    document.getElementById("blog-post-cancel").addEventListener("click", () => blogAdmin.editor.classList.add("is-hidden"));
    blogAdmin.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const id = blogAdmin.id.value;
        const payload = { title: blogAdmin.title.value, slug: blogAdmin.slug.value, category: blogAdmin.category.value, read_time: blogAdmin.readTime.value, excerpt: blogAdmin.excerpt.value, content: blogAdmin.content.value, published: blogAdmin.published.checked };
        try { await blogAdminRequest(id ? `/api/admin/blog/posts/${id}` : "/api/admin/blog/posts", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); blogAdminMessage(id ? "Post updated." : "Post created.", "success"); blogAdmin.editor.classList.add("is-hidden"); await loadBlogAdminData(); } catch (error) { blogAdminMessage(error.message, "error"); }
    });
}

document.addEventListener("DOMContentLoaded", initializeBlogAdmin);
