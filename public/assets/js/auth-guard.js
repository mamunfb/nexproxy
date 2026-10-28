"use strict";

(() => {
    const pathname = window.location.pathname;
    const isProtectedPage = /\/order(?:\/|$)|\/payment(?:\/|$)/.test(pathname);
    const isAccountPage = /\/account(?:\/|$)/.test(pathname);
    const accountPath = `${window.location.origin}/account/`;
    let clientPromise;

    function getReturnUrl(url = window.location.href) {
        const target = new URL(url, window.location.href);
        return `${target.pathname}${target.search}${target.hash}`;
    }

    function getAccountUrl(nextUrl) {
        const account = new URL(accountPath);
        account.searchParams.set("view", "signin");
        account.searchParams.set("next", getReturnUrl(nextUrl));
        return account.href;
    }

    function getClient() {
        if (clientPromise) return clientPromise;
        clientPromise = new Promise((resolve, reject) => {
            const start = Date.now();
            const wait = () => {
                if (window.NEXPROXY_SUPABASE_CLIENT) {
                    resolve(window.NEXPROXY_SUPABASE_CLIENT);
                    return;
                }
                if (window.supabase?.createClient && window.NEXPROXY_SUPABASE_URL && window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY) {
                    const client = window.supabase.createClient(window.NEXPROXY_SUPABASE_URL, window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY, {
                        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
                    });
                    window.NEXPROXY_SUPABASE_CLIENT = client;
                    resolve(client);
                    return;
                }
                if (Date.now() - start > 7000) {
                    reject(new Error("Account service is unavailable."));
                    return;
                }
                window.setTimeout(wait, 50);
            };
            wait();
        });
        return clientPromise;
    }

    async function hasSession() {
        const client = await getClient();
        const { data } = await client.auth.getSession();
        return Boolean(data?.session?.user);
    }

    async function requireSession(nextUrl = window.location.href) {
        try {
            if (await hasSession()) return true;
        } catch (error) {
            console.warn("Unable to verify the account session.", error);
        }
        window.location.replace(getAccountUrl(nextUrl));
        return false;
    }

    function shouldGateLink(href) {
        try {
            const target = new URL(href, window.location.href);
            return target.origin === window.location.origin && /\/order(?:\/|$)|\/payment(?:\/|$)/.test(target.pathname);
        } catch {
            return false;
        }
    }

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href]");
        if (!link || !shouldGateLink(link.href) || link.target === "_blank") return;
        event.preventDefault();
        requireSession(link.href).then((allowed) => {
            if (allowed) window.location.assign(link.href);
        });
    }, true);

    if (isProtectedPage && !isAccountPage) requireSession();
})();
