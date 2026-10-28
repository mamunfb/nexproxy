"use strict";

const postSlug = decodeURIComponent(window.location.pathname).split("/").filter(Boolean)[1] || "";
const postElements = {
    loading: document.getElementById("post-loading"),
    notFound: document.getElementById("post-not-found"),
    content: document.getElementById("post-content"),
    category: document.getElementById("post-category"),
    readTime: document.getElementById("post-read-time"),
    date: document.getElementById("post-date"),
    title: document.getElementById("post-title"),
    excerpt: document.getElementById("post-excerpt"),
    body: document.getElementById("post-body"),
    commentsList: document.getElementById("comments-list"),
    commentsCount: document.getElementById("comments-count"),
    form: document.getElementById("comment-form"),
    message: document.getElementById("comment-message"),
    submit: document.getElementById("comment-submit")
};

let loadedPost = null;

function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        "\"": "&quot;"
    }[character]));
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function setMessage(text, type = "") {
    postElements.message.textContent = text;
    postElements.message.className = `comment-message ${type}`.trim();
}

function renderPost(post) {
    document.title = `${post.title} | NexProxy`;
    postElements.category.textContent = post.category;
    postElements.readTime.textContent = post.read_time;
    postElements.date.textContent = formatDate(post.created_at);
    postElements.title.textContent = post.title;
    postElements.excerpt.textContent = post.excerpt;
    postElements.body.innerHTML = String(post.content || "").split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
    postElements.loading.classList.add("is-hidden");
    postElements.content.classList.remove("is-hidden");
}

function renderComments(comments) {
    const items = Array.isArray(comments) ? comments : [];
    postElements.commentsCount.textContent = `${items.length} approved`;
    postElements.commentsList.innerHTML = items.length ? items.map((comment) => `<article class="comment-item"><div class="comment-item-header"><strong>${escapeHtml(comment.name)}</strong><time>${escapeHtml(formatDate(comment.created_at))}</time></div><p>${escapeHtml(comment.content).replace(/\n/g, "<br>")}</p></article>`).join("") : '<p class="comments-empty">No comments yet. Start the conversation.</p>';
}

async function loadPost() {
    try {
        const response = await fetch(`/api/blog/posts/${encodeURIComponent(postSlug)}`);
        if (!response.ok) throw new Error(response.status === 404 ? "not-found" : "Unable to load this post.");
        const data = await response.json();
        loadedPost = data.post;
        renderPost(data.post);
        renderComments(data.comments);
    } catch (error) {
        postElements.loading.classList.add("is-hidden");
        postElements.notFound.classList.remove("is-hidden");
        if (error.message !== "not-found") postElements.notFound.firstChild.textContent = "This post is temporarily unavailable. ";
    }
}

postElements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loadedPost) return;
    postElements.submit.disabled = true;
    setMessage("Sending…");
    const body = {
        name: document.getElementById("comment-name").value,
        email: document.getElementById("comment-email").value,
        content: document.getElementById("comment-content").value
    };
    try {
        const response = await fetch(`/api/blog/posts/${encodeURIComponent(loadedPost.slug)}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to post comment.");
        postElements.form.reset();
        setMessage(data.message, "success");
    } catch (error) {
        setMessage(error.message, "error");
    } finally {
        postElements.submit.disabled = false;
    }
});

loadPost();
