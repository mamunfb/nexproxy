(() => {
    "use strict";

    const endpointSuffix = "/functions/v1/support-chat";
    const pollMilliseconds = 3000;
    const maxBodyLength = 4000;
    const maxFiles = 5;
    const maxFileBytes = 20 * 1024 * 1024;
    const allowedTypes = new Set([
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "video/mp4", "video/webm", "video/quicktime", "application/pdf", "text/plain", "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]);
    const extensionsByType = {
        "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/gif": [".gif"],
        "video/mp4": [".mp4", ".m4v"], "video/webm": [".webm"], "video/quicktime": [".mov", ".qt"],
        "application/pdf": [".pdf"], "text/plain": [".txt"], "text/csv": [".csv"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
    };
    const fileMatchesType = (file) => {
        const type = String(file.type).toLowerCase();
        const name = String(file.name).toLowerCase();
        return allowedTypes.has(type) && (extensionsByType[type] || []).some((extension) => name.endsWith(extension));
    };
    const state = {
        supabase: null,
        session: null,
        initialized: false,
        threads: [],
        currentThreadId: "",
        currentStatus: "open",
        polling: null,
        realtimeChannel: null,
        downloadCache: new Map(),
        lastMessageSignature: "",
        lastMessageRenderAt: 0,
        refreshPending: false,
        loading: false
    };

    const byId = (id) => document.getElementById(id);
    const make = (tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value == null ? "" : String(value);
        return node;
    };

    function setStatus(message, kind = "") {
        const target = byId("support-chat-admin-status");
        if (!target) return;
        target.textContent = message || "";
        target.dataset.kind = kind;
    }

    function syncComposerState() {
        const disabled = !state.currentThreadId || state.currentStatus !== "open";
        const reply = byId("support-chat-reply");
        const files = byId("support-chat-files");
        const send = byId("support-chat-send");
        if (reply) reply.disabled = disabled;
        if (files) files.disabled = disabled;
        if (send) send.disabled = disabled;
    }

    async function currentAccessToken() {
        if (state.supabase?.auth?.getSession) {
            const { data, error } = await state.supabase.auth.getSession();
            if (error) throw error;
            if (data?.session?.access_token) {
                state.session = data.session;
                return data.session.access_token;
            }
        }
        if (state.session?.access_token) return state.session.access_token;
        throw new Error("Your admin session has expired. Sign in again.");
    }

    async function request(action, fields = {}) {
        const baseUrl = String(window.NEXPROXY_SUPABASE_URL || "").trim();
        const publicKey = String(window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY || "").trim();
        if (!baseUrl || !publicKey) throw new Error("Chat service configuration is unavailable.");
        const token = await currentAccessToken();
        const response = await fetch(`${baseUrl}${endpointSuffix}`, {
            method: "POST",
            cache: "no-store",
            headers: {
                apikey: publicKey,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ action, ...fields })
        });
        let result;
        try { result = await response.json(); } catch (_) { throw new Error("The chat service returned an unreadable response."); }
        if (!response.ok || result?.success !== true) {
            throw new Error(String(result?.error || "Unable to complete that chat action."));
        }
        return result;
    }

    function renderThreadList() {
        const list = byId("support-chat-thread-list");
        if (!list) return;
        list.replaceChildren();
        if (!state.threads.length) {
            list.append(make("p", "admin-empty-state", "No support conversations yet."));
            return;
        }
        for (const thread of state.threads) {
            const button = make("button", "support-chat-thread", "");
            button.type = "button";
            button.setAttribute("aria-current", String(thread.threadId === state.currentThreadId));
            button.setAttribute("aria-label", `${thread.displayName || thread.email || "Visitor"}${thread.unread ? ", unread messages" : ""}`);
            const top = make("span", "support-chat-thread-top");
            top.append(make("strong", "", thread.displayName || thread.email || "Visitor"));
            if (thread.unread) top.append(make("span", "support-chat-unread", "Unread"));
            const meta = make("span", "support-chat-thread-meta", `${thread.status || "open"} · ${thread.email || "No email"}`);
            const latest = make("span", "support-chat-thread-date", formatDate(thread.lastMessageAt));
            button.append(top, meta, latest);
            button.addEventListener("click", () => selectThread(thread.threadId));
            list.append(button);
        }
    }

    async function loadThreads() {
        const result = await request("admin_list_threads");
        state.threads = Array.isArray(result.threads) ? result.threads : [];
        if (state.currentThreadId && !state.threads.some((thread) => thread.threadId === state.currentThreadId)) {
            state.currentThreadId = "";
            state.currentStatus = "open";
        }
        renderThreadList();
        syncComposerState();
        if (state.currentThreadId) {
            const selected = state.threads.find((thread) => thread.threadId === state.currentThreadId);
            if (selected) {
                state.currentStatus = selected.status || "open";
                byId("support-chat-status-select").value = state.currentStatus;
                syncComposerState();
            }
        }
        return state.threads;
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
    }

    function setUploadStatus(message, kind = "") {
        const target = byId("support-chat-upload-status");
        if (!target) return;
        target.textContent = message || "";
        target.dataset.kind = kind;
    }

    function validateReplyFiles() {
        const input = byId("support-chat-files");
        const files = Array.from(input?.files || []);
        if (files.length > maxFiles) {
            input.value = "";
            setUploadStatus("Choose no more than 5 files.", "error");
            return null;
        }
        const invalid = files.find((file) => !fileMatchesType(file) || file.size < 1 || file.size > maxFileBytes);
        if (invalid) {
            input.value = "";
            setUploadStatus("Choose an allowed file with a matching extension, from 1 byte to 20 MB.", "error");
            return null;
        }
        setUploadStatus(files.length ? `${files.length} file(s) selected.` : "");
        return files;
    }

    function uploadFile(url, file, index, count) {
        const publicKey = String(window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY || "").trim();
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", url, true);
            xhr.setRequestHeader("apikey", publicKey);
            xhr.setRequestHeader("Content-Type", file.type);
            xhr.setRequestHeader("x-upsert", "false");
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    setUploadStatus(`Uploading ${index + 1}/${count}: ${Math.round((event.loaded / event.total) * 100)}%`);
                }
            };
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error("A file upload failed. Please try again."));
            xhr.onerror = () => reject(new Error("A file upload failed. Check your connection and try again."));
            xhr.onabort = () => reject(new Error("File upload was cancelled."));
            xhr.send(file);
        });
    }

    async function attachmentView(attachment) {
        const wrapper = make("div", "support-chat-attachment");
        wrapper.append(make("span", "support-chat-attachment-name", `${attachment.name || "Attachment"} · ${Math.max(0, Number(attachment.sizeBytes) || 0)} bytes`));
        if (attachment.expired) {
            wrapper.append(make("span", "support-chat-attachment-expired", "Attachment expired"));
            return wrapper;
        }
        try {
            let cached = state.downloadCache.get(attachment.id);
            if (!cached || cached.expiresAt <= Date.now()) {
                const result = await request("create_download", { attachmentId: attachment.id });
                if (!result.signedUrl) throw new Error("Missing download URL");
                const requestedExpiry = Date.parse(result.expiresAt);
                const expiresAt = Number.isNaN(requestedExpiry) ? Date.now() + 14 * 60 * 1000 : Math.min(requestedExpiry, Date.now() + 14 * 60 * 1000);
                cached = { url: result.signedUrl, expiresAt };
                state.downloadCache.set(attachment.id, cached);
            }
            const mime = String(attachment.mimeType || "").toLowerCase();
            if (mime.startsWith("image/")) {
                const image = make("img", "support-chat-attachment-preview");
                image.alt = attachment.name || "Chat image attachment";
                image.loading = "lazy";
                image.src = cached.url;
                wrapper.append(image);
            } else if (mime.startsWith("video/")) {
                const video = make("video", "support-chat-attachment-preview");
                video.controls = true;
                video.preload = "metadata";
                video.src = cached.url;
                video.setAttribute("aria-label", attachment.name || "Video attachment");
                wrapper.append(video);
            } else {
                const link = make("a", "support-chat-attachment-link", "Download attachment");
                link.href = cached.url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.setAttribute("download", attachment.name || "attachment");
                wrapper.append(link);
            }
        } catch (_) {
            wrapper.append(make("span", "support-chat-attachment-expired", "Attachment unavailable or expired"));
        }
        return wrapper;
    }

    async function renderMessages(messages) {
        const container = byId("support-chat-messages");
        const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
        container.replaceChildren();
        if (!messages.length) container.append(make("p", "admin-empty-state", "No messages in this conversation yet."));
        for (const item of messages) {
            const card = make("article", `support-chat-message ${item.senderRole === "admin" ? "is-admin" : "is-visitor"}`);
            card.append(make("strong", "support-chat-message-sender", item.senderRole === "admin" ? "NexProxy Support" : "Visitor"));
            if (item.body) card.append(make("p", "support-chat-message-body", item.body));
            for (const attachment of Array.isArray(item.attachments) ? item.attachments : []) {
                card.append(await attachmentView(attachment));
            }
            if (Number(item.attachmentCount) > (item.attachments || []).length) {
                card.append(make("span", "support-chat-attachment-expired", "Some attachments are no longer available."));
            }
            card.append(make("time", "support-chat-message-time", formatDate(item.createdAt)));
            container.append(card);
        }
        if (wasNearBottom) container.scrollTop = container.scrollHeight;
    }

    async function loadMessages() {
        if (!state.currentThreadId) return;
        const result = await request("list_messages", { threadId: state.currentThreadId });
        const messages = Array.isArray(result.messages) ? result.messages : [];
        const signature = JSON.stringify(messages);
        if (signature === state.lastMessageSignature && Date.now() - state.lastMessageRenderAt < 45000) return;
        state.lastMessageSignature = signature;
        state.lastMessageRenderAt = Date.now();
        await renderMessages(messages);
    }

    async function selectThread(threadId) {
        if (!threadId || state.loading) return;
        state.currentThreadId = threadId;
        state.lastMessageSignature = "";
        state.lastMessageRenderAt = 0;
        const thread = state.threads.find((item) => item.threadId === threadId);
        state.currentStatus = thread?.status || "open";
        byId("support-chat-selected-title").textContent = thread?.displayName || thread?.email || "Visitor conversation";
        byId("support-chat-selected-meta").textContent = [thread?.email, `Visitor ID: ${thread?.visitorId || "—"}`].filter(Boolean).join(" · ");
        byId("support-chat-status-select").value = state.currentStatus;
        syncComposerState();
        renderThreadList();
        setStatus("Loading conversation…");
        try {
            await loadMessages();
            try { await request("mark_read", { threadId }); } catch (_) { /* message display remains available */ }
            await loadThreads();
            setStatus("");
        } catch (error) {
            setStatus(error.message || "Unable to load this conversation.", "error");
        }
    }

    async function updateStatus(event) {
        event.preventDefault();
        if (!state.currentThreadId) return;
        const status = byId("support-chat-status-select").value;
        const button = byId("support-chat-status-save");
        button.disabled = true;
        try {
            const result = await request("admin_set_status", { threadId: state.currentThreadId, status });
            state.currentStatus = result.status || status;
            byId("support-chat-status-select").value = state.currentStatus;
            syncComposerState();
            setStatus("Conversation status updated.", "success");
            await loadThreads();
        } catch (error) {
            setStatus(error.message || "Unable to update conversation status.", "error");
        } finally {
            button.disabled = false;
        }
    }

    async function sendReply(event) {
        event.preventDefault();
        const input = byId("support-chat-reply");
        const body = input.value.trim();
        const files = validateReplyFiles();
        if (!files) return;
        if (!state.currentThreadId) {
            setStatus("Choose a conversation before sending a reply.", "error");
            return;
        }
        if (!body && !files.length) {
            setStatus("Write a reply or choose an attachment first.", "error");
            return;
        }
        if (body.length > maxBodyLength) {
            setStatus("Replies can contain up to 4,000 characters.", "error");
            return;
        }
        const button = byId("support-chat-send");
        const fileInput = byId("support-chat-files");
        button.disabled = true;
        input.disabled = true;
        fileInput.disabled = true;
        setStatus("Sending reply…");
        try {
            const result = await request("send_message", {
                threadId: state.currentThreadId,
                body,
                attachments: files.map((file) => ({ name: file.name, mimeType: file.type, sizeBytes: file.size }))
            });
            const uploads = Array.isArray(result.uploads) ? result.uploads : [];
            if (uploads.length !== files.length) throw new Error("The upload instructions did not match the selected files.");
            for (let index = 0; index < uploads.length; index += 1) {
                const upload = uploads[index];
                if (!upload?.signedUploadUrl || !upload?.attachmentId) throw new Error("The chat service returned incomplete upload instructions.");
                await uploadFile(upload.signedUploadUrl, files[index], index, uploads.length);
            }
            if (uploads.length) await request("finalize_message", { messageId: result.messageId });
            input.value = "";
            fileInput.value = "";
            setUploadStatus("");
            setStatus(files.length ? "Reply and attachment(s) sent." : "Reply sent.", "success");
            state.lastMessageSignature = "";
            await Promise.all([loadMessages(), loadThreads()]);
        } catch (error) {
            setStatus(error.message || "Unable to send reply.", "error");
            if (files.length) setUploadStatus("If an upload was interrupted, the incomplete file will be cleaned automatically. Please retry.", "error");
        } finally {
            syncComposerState();
        }
    }

    function enableRealtimeRefresh() {
        if (window.NEXPROXY_SUPPORT_CHAT_REALTIME_ENABLED !== true || !state.supabase?.channel) return;
        try {
            const channel = state.supabase.channel("admin-support-chat-inbox")
                .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_threads" }, () => refresh().catch(() => {}))
                .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_messages" }, () => refresh().catch(() => {}));
            state.realtimeChannel = channel;
            channel.subscribe((status) => {
                if (!state.initialized) return;
                if (status === "SUBSCRIBED") {
                    if (state.polling) clearInterval(state.polling);
                    state.polling = null;
                    return;
                }
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                    if (state.supabase && state.realtimeChannel) state.supabase.removeChannel(state.realtimeChannel).catch(() => {});
                    state.realtimeChannel = null;
                    if (!state.polling) state.polling = setInterval(() => refresh().catch(() => {}), pollMilliseconds);
                }
            });
        } catch (_) {
            state.realtimeChannel = null;
        }
    }

    function init({ supabase, session } = {}) {
        if (state.initialized || !supabase || !session?.access_token) return;
        state.supabase = supabase;
        state.session = session;
        state.initialized = true;
        byId("support-chat-status-form")?.addEventListener("submit", updateStatus);
        byId("support-chat-reply-form")?.addEventListener("submit", sendReply);
        byId("support-chat-files")?.addEventListener("change", validateReplyFiles);
        byId("support-chat-refresh")?.addEventListener("click", () => refresh().catch((error) => setStatus(error.message, "error")));
        setStatus("Loading support conversations…");
        refresh().catch((error) => setStatus(error.message || "Unable to load support conversations.", "error"));
        state.polling = setInterval(() => refresh().catch(() => {}), pollMilliseconds);
        enableRealtimeRefresh();
    }

    async function refresh() {
        if (!state.initialized) return;
        if (state.loading) {
            state.refreshPending = true;
            return;
        }
        state.loading = true;
        try {
            await loadThreads();
            if (state.currentThreadId) await loadMessages();
            if (byId("support-chat-admin-status").dataset.kind === "error") setStatus("");
        } finally {
            state.loading = false;
            if (state.refreshPending) {
                state.refreshPending = false;
                setTimeout(() => refresh().catch(() => {}), 0);
            }
        }
    }

    function stop() {
        if (state.polling) clearInterval(state.polling);
        state.polling = null;
        if (state.supabase && state.realtimeChannel) state.supabase.removeChannel(state.realtimeChannel).catch(() => {});
        state.realtimeChannel = null;
        state.supabase = null;
        state.session = null;
        state.initialized = false;
        state.currentThreadId = "";
    }

    window.NexProxyChatAdmin = { init, stop };
})();
