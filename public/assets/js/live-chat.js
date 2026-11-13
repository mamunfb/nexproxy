(() => {
    "use strict";

    if (window.__nexProxyLiveChatLoaded) return;
    window.__nexProxyLiveChatLoaded = true;

    const TOKEN_KEY = "nexproxy_support_chat_visitor_v1";
    const VISITOR_KEY = "nexproxy_support_chat_visitor_id_v1";
    const MAX_FILES = 5;
    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const MAX_TEXT_LENGTH = 4000;
    const ALLOWED_TYPES = new Set([
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "video/mp4", "video/webm", "video/quicktime", "application/pdf", "text/plain", "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]);
    const EXTENSIONS_BY_TYPE = {
        "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/gif": [".gif"],
        "video/mp4": [".mp4", ".m4v"], "video/webm": [".webm"], "video/quicktime": [".mov", ".qt"],
        "application/pdf": [".pdf"], "text/plain": [".txt"], "text/csv": [".csv"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
    };
    const fileMatchesType = (file) => {
        const type = String(file.type).toLowerCase();
        const name = String(file.name).toLowerCase();
        return ALLOWED_TYPES.has(type) && (EXTENSIONS_BY_TYPE[type] || []).some((extension) => name.endsWith(extension));
    };
    const state = {
        config: null,
        visitorToken: "",
        visitorId: "",
        threadId: "",
        threadStatus: "open",
        turnstileWidget: null,
        authTurnstileWidget: null,
        authCaptchaResolve: null,
        authCaptchaReject: null,
        realtimeClient: null,
        realtimeChannel: null,
        polling: null,
        downloadCache: new Map(),
        lastReadThreadId: "",
        lastReadMessageId: "",
        lastMessageSignature: "",
        lastMessageRenderAt: 0,
        refreshing: false,
        refreshPending: false,
        busy: false,
        open: false
    };

    const text = (value) => String(value == null ? "" : value);
    const element = (tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    };

    function loadScript(src, test) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const existing = Array.from(document.scripts).find((script) => script.src === src);
            if (existing) {
                if (existing.dataset.loaded === "true" || test()) { resolve(); return; }
                if (existing.dataset.failed === "true") { existing.remove(); }
                else {
                    existing.addEventListener("load", resolve, { once: true });
                    existing.addEventListener("error", reject, { once: true });
                    return;
                }
            }
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = () => { script.dataset.loaded = "true"; resolve(); };
            script.onerror = () => { script.dataset.failed = "true"; reject(new Error("A required service could not be loaded.")); };
            document.head.append(script);
        });
    }

    async function getConfig() {
        if (state.config) return state.config;
        if (typeof window.NEXPROXY_SUPABASE_URL !== "string") {
            await loadScript("/assets/js/config.js", () => typeof window.NEXPROXY_SUPABASE_URL === "string");
        }
        state.config = {
            url: text(window.NEXPROXY_SUPABASE_URL).trim(),
            key: text(window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY).trim(),
            enabled: window.NEXPROXY_LIVE_CHAT_ENABLED === true,
            turnstileSiteKey: text(window.NEXPROXY_TURNSTILE_SITE_KEY).trim(),
            realtimeEnabled: window.NEXPROXY_SUPPORT_CHAT_REALTIME_ENABLED === true
        };
        if (!state.config.url || !state.config.key) throw new Error("Chat is not configured yet. Please try again later.");
        return state.config;
    }

    function renderWidget() {
        const launcher = element("button", "np-chat-launcher", "Chat with NexProxy");
        launcher.type = "button";
        launcher.setAttribute("aria-expanded", "false");
        launcher.setAttribute("aria-controls", "np-chat-panel");
        launcher.setAttribute("aria-label", "Open NexProxy support chat");

        const panel = element("section", "np-chat-panel np-chat-hidden");
        panel.id = "np-chat-panel";
        panel.setAttribute("aria-label", "NexProxy support chat");
        panel.setAttribute("aria-hidden", "true");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "false");

        const header = element("header", "np-chat-header");
        const titleBlock = element("div");
        const title = element("h2", "", "NexProxy Support");
        title.id = "np-chat-title";
        const subtitle = element("p", "", "Leave a message and our team will reply here.");
        titleBlock.append(title, subtitle);
        const close = element("button", "np-chat-close", "Close");
        close.type = "button";
        close.setAttribute("aria-label", "Close support chat");
        header.append(titleBlock, close);

        const notice = element("div", "np-chat-notice");
        notice.setAttribute("role", "status");
        notice.setAttribute("aria-live", "polite");
        const visitorForm = element("form", "np-chat-visitor-form");
        visitorForm.setAttribute("aria-label", "Start support chat");
        const visitorLabel = element("label", "", "Name (optional)");
        const visitorName = element("input");
        visitorName.name = "name";
        visitorName.maxLength = 120;
        visitorName.autocomplete = "name";
        visitorLabel.append(visitorName);
        const emailLabel = element("label", "", "Email (optional)");
        const visitorEmail = element("input");
        visitorEmail.name = "email";
        visitorEmail.type = "email";
        visitorEmail.maxLength = 254;
        visitorEmail.autocomplete = "email";
        emailLabel.append(visitorEmail);
        const captcha = element("div", "np-chat-captcha");
        captcha.id = "np-chat-turnstile";
        const privacy = element("p", "np-chat-privacy", "Attachments are available for one hour. Chat message text remains in the support history.");
        visitorForm.append(visitorLabel, emailLabel, captcha);

        const conversation = element("div", "np-chat-conversation np-chat-hidden");
        const messages = element("div", "np-chat-messages");
        const authCaptcha = element("div", "np-chat-captcha np-chat-hidden");
        authCaptcha.id = "np-chat-auth-turnstile";
        const realtimeRetry = element("button", "np-chat-realtime-retry np-chat-hidden", "Retry live connection");
        realtimeRetry.type = "button";
        messages.setAttribute("role", "log");
        messages.setAttribute("aria-live", "polite");
        messages.setAttribute("aria-relevant", "additions text");
        const compose = element("form", "np-chat-compose");
        const messageLabel = element("label", "np-chat-message-label", "Your message");
        const message = element("textarea");
        message.name = "message";
        message.rows = 3;
        message.maxLength = MAX_TEXT_LENGTH;
        message.placeholder = "Write a message…";
        message.required = false;
        messageLabel.append(message);
        const attachLabel = element("label", "np-chat-file-label", "Add files (up to 5, 20 MB each)");
        const files = element("input");
        files.type = "file";
        files.multiple = true;
        files.accept = Array.from(ALLOWED_TYPES).join(",");
        files.setAttribute("aria-describedby", "np-chat-upload-status");
        attachLabel.append(files);
        const uploadStatus = element("div", "np-chat-upload-status", "");
        uploadStatus.id = "np-chat-upload-status";
        uploadStatus.setAttribute("role", "status");
        uploadStatus.setAttribute("aria-live", "polite");
        const send = element("button", "np-chat-send", "Send");
        send.type = "submit";
        const newConversation = element("button", "np-chat-new-conversation np-chat-hidden", "Start a new conversation");
        newConversation.type = "button";
        compose.append(messageLabel, attachLabel, uploadStatus, send);
        conversation.append(messages, authCaptcha, realtimeRetry, compose);
        conversation.append(newConversation);

        panel.append(header, notice, privacy, visitorForm, conversation);
        document.body.append(launcher, panel);

        launcher.addEventListener("click", () => setOpen(!state.open));
        close.addEventListener("click", () => setOpen(false));
        visitorForm.addEventListener("submit", (event) => event.preventDefault());
        compose.addEventListener("submit", onSend);
        files.addEventListener("change", validateSelectedFiles);
        newConversation.addEventListener("click", startNewConversation);
        realtimeRetry.addEventListener("click", () => {
            realtimeRetry.classList.add("np-chat-hidden");
            maybeEnableRealtime();
        });
        return { launcher, panel, notice, visitorForm, visitorName, visitorEmail, captcha, authCaptcha, realtimeRetry, conversation, messages, message, files, send, uploadStatus, newConversation };
    }

    let ui;
    function setNotice(message, kind) {
        ui.notice.textContent = message || "";
        ui.notice.dataset.kind = kind || "";
    }

    function setOpen(open) {
        state.open = Boolean(open);
        ui.panel.classList.toggle("np-chat-hidden", !state.open);
        ui.panel.setAttribute("aria-hidden", String(!state.open));
        ui.launcher.setAttribute("aria-expanded", String(state.open));
        if (state.open) {
            (state.threadId ? ui.message : ui.visitorName).focus();
            if (state.visitorToken && state.threadId) refreshMessages();
            else if (!state.visitorToken) setupTurnstile();
        }
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        ui.send.disabled = state.busy || state.threadStatus !== "open";
        ui.message.disabled = state.busy || state.threadStatus !== "open";
        ui.files.disabled = state.busy || state.threadStatus !== "open";
    }

    async function setupTurnstile() {
        if (state.visitorToken || state.turnstileWidget !== null || !state.open) return;
        let config;
        try { config = await getConfig(); } catch (error) { setNotice(error.message, "error"); return; }
        if (!config.enabled) {
            setNotice("Live chat is not available yet. Please try again later.", "error");
            return;
        }
        if (!config.turnstileSiteKey) {
            setNotice("Chat verification is not configured. Please contact us using the details on this site.", "error");
            return;
        }
        setNotice("Complete the verification below to start a secure chat.");
        try {
            await loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", () => Boolean(window.turnstile));
            if (state.visitorToken || state.turnstileWidget !== null || !state.open) return;
            state.turnstileWidget = window.turnstile.render(ui.captcha, {
                sitekey: config.turnstileSiteKey,
                action: "support_chat",
                callback: (token) => createVisitor(token),
                "expired-callback": () => setNotice("Verification expired. Please complete it again.", "error"),
                "error-callback": () => setNotice("Verification could not be completed. Please try again.", "error")
            });
        } catch (error) {
            state.turnstileWidget = null;
            setNotice(error.message || "Verification could not be loaded.", "error");
        }
    }

    async function createVisitor(turnstileToken) {
        if (typeof turnstileToken !== "string" || !turnstileToken.trim() || state.busy) return;
        setBusy(true);
        setNotice("Starting your chat…");
        try {
            await getConfig();
            if (!window.NEXPROXY_TURNSTILE_SITE_KEY || !text(window.NEXPROXY_TURNSTILE_SITE_KEY).trim()) {
                throw new Error("Chat verification is not configured. Please contact us using the details on this site.");
            }
            const result = await api("create_visitor", {
                turnstileToken,
                name: ui.visitorName.value.trim() || null,
                email: ui.visitorEmail.value.trim() || null
            });
            if (typeof result.visitorToken !== "string" || !/^[0-9a-f]{64}$/i.test(result.visitorToken)
                || typeof result.visitorId !== "string" || !/^[0-9a-f-]{36}$/i.test(result.visitorId)) {
                throw new Error("The chat service did not create a valid visitor session.");
            }
            state.visitorToken = result.visitorToken;
            state.visitorId = result.visitorId;
            localStorage.setItem(TOKEN_KEY, state.visitorToken);
            localStorage.setItem(VISITOR_KEY, state.visitorId);
            await openThread();
            ui.visitorForm.classList.add("np-chat-hidden");
            ui.conversation.classList.remove("np-chat-hidden");
            setNotice("You’re connected. Send a message whenever you’re ready.");
            await refreshMessages();
            startPolling();
            maybeEnableRealtime();
        } catch (error) {
            state.visitorToken = "";
            state.visitorId = "";
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(VISITOR_KEY);
            setNotice(error.message || "Unable to start chat. Please try again.", "error");
            if (window.turnstile && state.turnstileWidget !== null) window.turnstile.reset(state.turnstileWidget);
        } finally {
            setBusy(false);
        }
    }

    async function openThread() {
        const result = await api("open_thread");
        if (!result.threadId) throw new Error("The chat service did not open a conversation.");
        if (result.visitorId) {
            state.visitorId = result.visitorId;
            localStorage.setItem(VISITOR_KEY, state.visitorId);
        }
        if (state.threadId !== result.threadId) {
            state.lastMessageSignature = "";
            state.lastMessageRenderAt = 0;
        }
        state.threadId = result.threadId;
        state.threadStatus = result.status || "open";
    }

    function validateSelectedFiles() {
        const selected = Array.from(ui.files.files || []);
        if (selected.length > MAX_FILES) {
            ui.files.value = "";
            ui.uploadStatus.textContent = "Choose no more than 5 files.";
            return;
        }
        const invalid = selected.find((file) => !fileMatchesType(file) || file.size < 1 || file.size > MAX_FILE_BYTES);
        if (invalid) {
            ui.files.value = "";
            ui.uploadStatus.textContent = "Choose an allowed file with a matching extension, from 1 byte to 20 MB.";
            return;
        }
        ui.uploadStatus.textContent = selected.length ? `${selected.length} file(s) selected.` : "";
    }

    function uploadFile(url, file, index, count) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", url, true);
            xhr.setRequestHeader("apikey", state.config.key);
            xhr.setRequestHeader("Content-Type", file.type);
            xhr.setRequestHeader("x-upsert", "false");
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    ui.uploadStatus.textContent = `Uploading ${index + 1}/${count}: ${Math.round((event.loaded / event.total) * 100)}%`;
                }
            };
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("A file upload failed. Please try again."));
            xhr.onerror = () => reject(new Error("A file upload failed. Check your connection and try again."));
            xhr.onabort = () => reject(new Error("File upload was cancelled."));
            xhr.send(file);
        });
    }

    async function onSend(event) {
        event.preventDefault();
        if (state.busy || !state.visitorToken || !state.threadId) return;
        const body = ui.message.value.trim();
        const files = Array.from(ui.files.files || []);
        if (!body && !files.length) {
            setNotice("Write a message or choose an attachment first.", "error");
            ui.message.focus();
            return;
        }
        if (body.length > MAX_TEXT_LENGTH) {
            setNotice("Messages can contain up to 4,000 characters.", "error");
            return;
        }
        if (files.length > MAX_FILES || files.some((file) => !fileMatchesType(file) || file.size < 1 || file.size > MAX_FILE_BYTES)) {
            setNotice("Please check the file count, supported file type and 20 MB per-file limit.", "error");
            return;
        }
        setBusy(true);
        setNotice("");
        try {
            const result = await api("send_message", {
                threadId: state.threadId,
                body,
                attachments: files.map((file) => ({ name: file.name, mimeType: file.type, sizeBytes: file.size }))
            });
            const uploads = Array.isArray(result.uploads) ? result.uploads : [];
            if (uploads.length !== files.length) throw new Error("The upload instructions did not match the selected files.");
            for (let i = 0; i < uploads.length; i += 1) {
                const upload = uploads[i];
                if (!upload?.signedUploadUrl || !upload?.attachmentId) throw new Error("The chat service returned incomplete upload instructions.");
                await uploadFile(upload.signedUploadUrl, files[i], i, uploads.length);
            }
            if (uploads.length) await api("finalize_message", { messageId: result.messageId });
            ui.message.value = "";
            ui.files.value = "";
            ui.uploadStatus.textContent = "";
            setNotice("Message sent.", "success");
            await refreshMessages();
        } catch (error) {
            setNotice(error.message || "Unable to send your message. Please try again.", "error");
        } finally {
            setBusy(false);
        }
    }

    async function signedDownload(attachmentId) {
        const cached = state.downloadCache.get(attachmentId);
        if (cached && cached.expiresAt > Date.now()) return cached.url;
        const result = await api("create_download", { attachmentId });
        if (!result.signedUrl) throw new Error("A download link is unavailable.");
        const requestedExpiry = Date.parse(result.expiresAt);
        const expiresAt = Number.isNaN(requestedExpiry) ? Date.now() + 14 * 60 * 1000 : Math.min(requestedExpiry, Date.now() + 14 * 60 * 1000);
        state.downloadCache.set(attachmentId, { url: result.signedUrl, expiresAt });
        return result.signedUrl;
    }

    async function renderAttachment(attachment) {
        const wrapper = element("div", "np-chat-attachment");
        wrapper.append(element("span", "np-chat-attachment-name", `${text(attachment.name) || "Attachment"} · ${Math.max(0, Number(attachment.sizeBytes) || 0)} bytes`));
        if (attachment.expired) {
            wrapper.append(element("span", "np-chat-expired", "Attachment expired"));
            return wrapper;
        }
        const mime = text(attachment.mimeType).toLowerCase();
        try {
            const url = await signedDownload(attachment.id);
            if (mime.startsWith("image/")) {
                const image = element("img", "np-chat-preview");
                image.alt = text(attachment.name) || "Chat image attachment";
                image.loading = "lazy";
                image.src = url;
                wrapper.append(image);
            } else if (mime.startsWith("video/")) {
                const video = element("video", "np-chat-preview");
                video.controls = true;
                video.preload = "metadata";
                video.src = url;
                video.setAttribute("aria-label", text(attachment.name) || "Video attachment");
                wrapper.append(video);
            } else {
                const link = element("a", "np-chat-download", "Download attachment");
                link.href = url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.setAttribute("download", text(attachment.name) || "attachment");
                wrapper.append(link);
            }
        } catch (_) {
            wrapper.append(element("span", "np-chat-expired", "Attachment unavailable or expired"));
        }
        return wrapper;
    }

    async function refreshMessages() {
        if (!state.visitorToken || !state.threadId) return;
        if (state.refreshing) {
            state.refreshPending = true;
            return;
        }
        state.refreshing = true;
        const requestedThreadId = state.threadId;
        try {
            const result = await api("list_messages", { threadId: requestedThreadId });
            if (requestedThreadId !== state.threadId) return;
            const entries = Array.isArray(result.messages) ? result.messages : [];
            if (result.threadStatus === "open" || result.threadStatus === "resolved") state.threadStatus = result.threadStatus;
            ui.newConversation.classList.toggle("np-chat-hidden", state.threadStatus !== "resolved");
            const latestMessageId = entries.length ? text(entries[entries.length - 1].id) : "";
            const signature = JSON.stringify(entries);
            if (signature === state.lastMessageSignature && Date.now() - state.lastMessageRenderAt < 45000) {
                setNotice(state.threadStatus === "resolved" ? "This conversation is resolved. You can still read the messages or start a new conversation." : "");
                setBusy(state.busy);
                return;
            }
            state.lastMessageSignature = signature;
            state.lastMessageRenderAt = Date.now();
            const wasNearBottom = ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 48;
            ui.messages.replaceChildren();
            for (const item of entries) {
                if (requestedThreadId !== state.threadId) return;
                const bubble = element("article", `np-chat-bubble ${item.senderRole === "visitor" ? "is-visitor" : "is-staff"}`);
                const label = element("strong", "np-chat-sender", item.senderRole === "visitor" ? "You" : "NexProxy Support");
                const body = element("p", "np-chat-body", text(item.body));
                bubble.append(label);
                if (item.body) bubble.append(body);
                for (const attachment of Array.isArray(item.attachments) ? item.attachments : []) {
                    const attachmentNode = await renderAttachment(attachment);
                    if (requestedThreadId !== state.threadId) return;
                    bubble.append(attachmentNode);
                }
                if (Number(item.attachmentCount) > (item.attachments || []).length) bubble.append(element("span", "np-chat-expired", "Some attachments are no longer available."));
                bubble.append(element("time", "np-chat-time", formatDate(item.createdAt)));
                if (requestedThreadId !== state.threadId) return;
                ui.messages.append(bubble);
            }
            if (!entries.length) ui.messages.append(element("p", "np-chat-empty", "Your conversation will appear here."));
            if (wasNearBottom) ui.messages.scrollTop = ui.messages.scrollHeight;
            if (state.open && (state.lastReadThreadId !== state.threadId || state.lastReadMessageId !== latestMessageId)) {
                try { await api("mark_read", { threadId: requestedThreadId }); } catch (_) { /* reading remains available */ }
                state.lastReadThreadId = requestedThreadId;
                state.lastReadMessageId = latestMessageId;
            }
            setNotice(state.threadStatus === "resolved" ? "This conversation is resolved. You can still read the messages or start a new conversation." : "");
            setBusy(state.busy);
        } catch (error) {
            if (state.open) setNotice(error.message || "Messages could not be refreshed.", "error");
        } finally {
            state.refreshing = false;
            if (state.refreshPending) {
                state.refreshPending = false;
                setTimeout(() => refreshMessages().catch(() => {}), 0);
            }
        }
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
    }

    function startPolling() {
        if (state.polling) clearInterval(state.polling);
        state.polling = setInterval(() => { if (state.open) refreshMessages(); }, 3000);
    }

    async function startNewConversation() {
        if (state.busy || !state.visitorToken || state.threadStatus !== "resolved") return;
        setBusy(true);
        try {
            disableRealtime();
            await openThread();
            state.lastReadThreadId = "";
            state.lastReadMessageId = "";
            state.lastMessageSignature = "";
            state.lastMessageRenderAt = 0;
            ui.message.value = "";
            ui.files.value = "";
            ui.uploadStatus.textContent = "";
            ui.newConversation.classList.add("np-chat-hidden");
            await refreshMessages();
            startPolling();
            maybeEnableRealtime();
        } catch (error) {
            setNotice(error.message || "Unable to start a new conversation.", "error");
        } finally {
            setBusy(false);
        }
    }

    async function getRealtimeAuthCaptchaToken() {
        if (!state.config?.turnstileSiteKey) throw new Error("Live updates require a configured security check.");
        await loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", () => Boolean(window.turnstile));
        ui.authCaptcha.classList.remove("np-chat-hidden");
        setNotice("Complete the security check to enable live updates.");
        return new Promise((resolve, reject) => {
            state.authCaptchaResolve = (token) => {
                state.authCaptchaResolve = null;
                state.authCaptchaReject = null;
                ui.authCaptcha.classList.add("np-chat-hidden");
                resolve(token);
            };
            state.authCaptchaReject = (error) => {
                state.authCaptchaResolve = null;
                state.authCaptchaReject = null;
                ui.authCaptcha.classList.add("np-chat-hidden");
                reject(error);
            };
            if (state.authTurnstileWidget !== null) {
                window.turnstile.reset(state.authTurnstileWidget);
                return;
            }
            state.authTurnstileWidget = window.turnstile.render(ui.authCaptcha, {
                sitekey: state.config.turnstileSiteKey,
                action: "support_chat_auth",
                callback: (token) => {
                    if (typeof token !== "string" || !token.trim()) {
                        state.authCaptchaReject?.(new Error("Security check returned no token. Please try again."));
                        return;
                    }
                    state.authCaptchaResolve?.(token);
                },
                "expired-callback": () => state.authCaptchaReject?.(new Error("Security check expired. Please try again.")),
                "error-callback": () => state.authCaptchaReject?.(new Error("Security check failed. Chat will continue with periodic updates."))
            });
        });
    }

    async function maybeEnableRealtime() {
        if (!state.config?.realtimeEnabled || state.realtimeChannel || !state.threadId || !state.visitorId) return;
        try {
            await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", () => Boolean(window.supabase?.createClient));
            if (!state.realtimeClient) {
                state.realtimeClient = window.supabase.createClient(state.config.url, state.config.key, {
                    auth: {
                        storageKey: `nexproxy_support_chat_auth_${state.visitorId}`,
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: false
                    }
                });
            }
            let { data: sessionData, error: sessionError } = await state.realtimeClient.auth.getSession();
            if (sessionError) throw sessionError;
            if (!sessionData?.session?.access_token) {
                const captchaToken = await getRealtimeAuthCaptchaToken();
                const signedIn = await state.realtimeClient.auth.signInAnonymously({ options: { captchaToken } });
                if (signedIn.error || !signedIn.data?.session?.access_token) throw signedIn.error || new Error("Chat realtime authentication failed.");
                sessionData = signedIn.data;
            }
            await api("link_realtime", {}, sessionData.session.access_token);
            const channel = state.realtimeClient.channel(`support-chat-${state.threadId}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_threads", filter: `id=eq.${state.threadId}` }, () => refreshMessages())
                .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_messages", filter: `thread_id=eq.${state.threadId}` }, () => refreshMessages())
            state.realtimeChannel = channel;
                    channel.subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                        if (state.polling) clearInterval(state.polling);
                        state.polling = null;
                        ui.realtimeRetry.classList.add("np-chat-hidden");
                        return;
                    }
                    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                        disableRealtime();
                        ui.realtimeRetry.classList.remove("np-chat-hidden");
                    }
                });
        } catch (error) {
            disableRealtime();
            ui.realtimeRetry.classList.remove("np-chat-hidden");
            setNotice(error?.message || "Live updates are unavailable. Your chat will refresh periodically.", "error");
        }
    }

    async function api(action, fields = {}, bearerToken = "") {
        const config = await getConfig();
        const headers = { apikey: config.key, "Content-Type": "application/json" };
        if (state.visitorToken) headers["x-chat-token"] = state.visitorToken;
        if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
        const response = await fetch(`${config.url}/functions/v1/support-chat`, {
            method: "POST", headers, cache: "no-store", body: JSON.stringify({ action, ...fields })
        });
        let result;
        try { result = await response.json(); } catch (_) { throw new Error("The chat service returned an unreadable response."); }
        if (!response.ok || result?.success !== true) {
            if (state.visitorToken && response.status === 401 && result?.error === "A valid chat session is required.") {
                recoverVisitorSession();
            }
            const error = new Error(text(result?.error) || "Unable to complete that chat action.");
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function recoverVisitorSession() {
        state.visitorToken = "";
        state.visitorId = "";
        state.threadId = "";
        state.threadStatus = "open";
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(VISITOR_KEY);
        disableRealtime();
        if (state.polling) clearInterval(state.polling);
        state.polling = null;
        ui.conversation.classList.add("np-chat-hidden");
        ui.visitorForm.classList.remove("np-chat-hidden");
        ui.message.value = "";
        ui.messages.replaceChildren();
        if (window.turnstile && state.turnstileWidget !== null) window.turnstile.reset(state.turnstileWidget);
        setNotice("Your chat session is no longer valid. Complete verification to start a new chat.", "error");
    }

    function disableRealtime() {
        if (state.realtimeClient && state.realtimeChannel) state.realtimeClient.removeChannel(state.realtimeChannel).catch(() => {});
        state.realtimeChannel = null;
        if (state.visitorToken && !state.polling) startPolling();
    }

    async function restoreVisitor() {
        try {
            const stored = localStorage.getItem(TOKEN_KEY);
            if (!stored) return;
            state.visitorToken = stored;
            await openThread();
            ui.visitorForm.classList.add("np-chat-hidden");
            ui.conversation.classList.remove("np-chat-hidden");
            await refreshMessages();
            startPolling();
            maybeEnableRealtime();
        } catch (_) {
            state.visitorToken = "";
            state.visitorId = "";
            state.threadId = "";
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(VISITOR_KEY);
            setNotice("Your saved chat session could not be restored. Start a new verified chat.", "error");
        }
    }

    function start() {
        if (!document.body || document.getElementById("np-chat-panel")) return;
        getConfig().then((config) => {
            if (!config.enabled) return;
            ui = renderWidget();
            restoreVisitor();
        }).catch(() => {});
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();
