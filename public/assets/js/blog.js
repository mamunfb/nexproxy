"use strict";

const blogGrid = document.getElementById("blog-grid");

function blogEscape(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" }[character]));
}

function renderBlogCards(posts) {
    if (!blogGrid || !Array.isArray(posts) || !posts.length) return;
    blogGrid.innerHTML = posts.map((post, index) => `<article class="blog-card${index === 0 ? " blog-card-featured" : ""}"><div class="blog-card-topline"><span class="blog-category">${blogEscape(post.category)}</span><span class="blog-read-time">${blogEscape(post.read_time)}</span></div><h3>${blogEscape(post.title)}</h3><p class="blog-excerpt">${blogEscape(post.excerpt)}</p><a class="blog-read-link" href="${blogEscape(post.slug)}/">Read the post <span aria-hidden="true">→</span></a></article>`).join("");
}

fetch("/api/blog/posts")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Blog API unavailable")))
    .then((data) => renderBlogCards(data.posts))
    .catch(() => {
        // Keep the server-rendered fallback cards when the API is unavailable.
    });
