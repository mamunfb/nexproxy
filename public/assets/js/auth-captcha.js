(() => {
    "use strict";

    if (window.NexProxyAuthCaptcha) return;

    const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    let scriptPromise = null;
    let requestInProgress = false;

    function loadTurnstile() {
        if (window.turnstile) return Promise.resolve();
        if (scriptPromise) return scriptPromise;
        scriptPromise = new Promise((resolve, reject) => {
            const existing = Array.from(document.scripts).find((script) => script.src === SCRIPT_URL);
            const script = existing || document.createElement("script");
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearInterval(checkTimer);
                clearTimeout(timeout);
                script.removeEventListener("load", onLoad);
                script.removeEventListener("error", onError);
                if (error) {
                    scriptPromise = null;
                    if (!existing) script.remove();
                    reject(new Error("The security check could not be loaded. Please try again."));
                } else resolve();
            };
            const onLoad = () => { if (window.turnstile) finish(); };
            const onError = () => finish(new Error("load failed"));
            const checkTimer = setInterval(() => { if (window.turnstile) finish(); }, 50);
            const timeout = setTimeout(() => finish(new Error("load timed out")), 15000);
            script.addEventListener("load", onLoad, { once: true });
            script.addEventListener("error", onError, { once: true });
            if (!existing) {
                script.src = SCRIPT_URL;
                script.async = true;
                document.head.append(script);
            }
        });
        return scriptPromise;
    }

    async function getToken(form) {
        if (window.NEXPROXY_AUTH_CAPTCHA_ENABLED !== true) return "";
        if (requestInProgress) throw new Error("A security check is already in progress.");
        requestInProgress = true;
        let widgetId = null;
        let container = null;
        try {
            const sitekey = String(window.NEXPROXY_TURNSTILE_SITE_KEY || "").trim();
            if (!sitekey) throw new Error("The security check is not configured. Please contact support.");
            if (!form || typeof form.insertBefore !== "function") throw new Error("The sign-in form is unavailable.");
            await loadTurnstile();
            container = document.createElement("div");
            container.className = "np-auth-captcha";
            container.setAttribute("aria-label", "Complete the security check");
            const submit = form.querySelector('[type="submit"]');
            if (submit) form.insertBefore(container, submit);
            else form.append(container);

            return await new Promise((resolve, reject) => {
                try {
                    widgetId = window.turnstile.render(container, {
                        sitekey,
                        action: "nexproxy_auth",
                        callback: (token) => {
                            if (typeof token !== "string" || !token.trim()) {
                                reject(new Error("The security check returned no token. Please try again."));
                                return;
                            }
                            resolve(token);
                        },
                        "expired-callback": () => reject(new Error("The security check expired. Please try again.")),
                        "error-callback": () => reject(new Error("The security check failed. Please try again."))
                    });
                } catch (_) {
                    reject(new Error("The security check could not be started. Please try again."));
                }
            });
        } finally {
            if (widgetId !== null && window.turnstile) {
                try { window.turnstile.remove(widgetId); } catch (_) { /* cleanup is best-effort */ }
            }
            container?.remove();
            requestInProgress = false;
        }
    }

    window.NexProxyAuthCaptcha = Object.freeze({ getToken });
})();
