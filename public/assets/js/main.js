"use strict";

const safeInit = (initializer) => {
    try {
        initializer();
    } catch (error) {
        console.error("NexProxy initialization error:", error);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    safeInit(initNavigation);
    safeInit(initAuthActions);

    console.log("NexProxy JS initialized.");
});

/**
 * Initialize mobile navigation.
 */
function initNavigation() {
    const navToggle = document.querySelector(".nav-toggle");
    const navMenu = document.querySelector(".nav-menu");

    if (!navToggle || !navMenu) {
        return;
    }

    navToggle.addEventListener("click", () => {
        const isOpen = navToggle.getAttribute("aria-expanded") === "true";

        setNavigationState(navToggle, navMenu, !isOpen);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setNavigationState(navToggle, navMenu, false);
        }
    });

    const navLinks = navMenu.querySelectorAll("a");

    navLinks.forEach((link) => {
        link.addEventListener("click", () => {
            setNavigationState(navToggle, navMenu, false);
        });
    });
}

/**
 * Get the single shared Supabase client used by the page.
 */
function getSharedSupabaseClient() {
    if (window.NEXPROXY_SUPABASE_CLIENT) {
        return window.NEXPROXY_SUPABASE_CLIENT;
    }

    if (
        !window.NEXPROXY_SUPABASE_URL ||
        !window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY ||
        typeof window.supabase?.createClient !== "function"
    ) {
        return null;
    }

    window.NEXPROXY_SUPABASE_CLIENT = window.supabase.createClient(
        window.NEXPROXY_SUPABASE_URL,
        window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );

    return window.NEXPROXY_SUPABASE_CLIENT;
}

/**
 * Keep the single account action in the header synchronized with Supabase Auth.
 */
function initAuthActions() {
    const container = document.querySelector(".nav-auth-actions");
    const initialAction = container?.querySelector("a.btn, button.btn");

    if (!container || !initialAction) {
        return;
    }

    const signInHref = initialAction.getAttribute("href") || "/account/?view=signin";
    const actionClass = initialAction.className || "btn btn-secondary";
    const client = getSharedSupabaseClient();

    if (!client) {
        return;
    }

    let isSigningOut = false;

    function renderAuthAction(user) {
        const currentAction = container.querySelector("a.btn, button.btn");

        if (user) {
            if (currentAction instanceof HTMLButtonElement) {
                return;
            }

            const signOutButton = document.createElement("button");
            signOutButton.type = "button";
            signOutButton.id = "site-auth-signout";
            signOutButton.className = actionClass;
            signOutButton.textContent = "Sign out";
            signOutButton.setAttribute("aria-label", "Sign out");
            currentAction?.replaceWith(signOutButton);
            return;
        }

        if (currentAction instanceof HTMLAnchorElement) {
            currentAction.href = signInHref;
            currentAction.textContent = "Sign In";
            return;
        }

        const signInLink = document.createElement("a");
        signInLink.href = signInHref;
        signInLink.className = actionClass;
        signInLink.textContent = "Sign In";
        currentAction?.replaceWith(signInLink);
    }

    container.addEventListener("click", async (event) => {
        const button = event.target.closest("#site-auth-signout");
        if (!button || !container.contains(button) || isSigningOut) {
            return;
        }

        event.preventDefault();
        isSigningOut = true;
        button.disabled = true;
        button.textContent = "Signing out…";

        try {
            const { error } = await client.auth.signOut();
            if (error) throw error;
        } catch (error) {
            button.disabled = false;
            button.textContent = "Sign out";
            button.title = error.message || "Unable to sign out. Please try again.";
            console.error("NexProxy sign-out error:", error);
        } finally {
            isSigningOut = false;
        }
    });

    client.auth.onAuthStateChange((_event, session) => {
        renderAuthAction(session?.user || null);
    });

    client.auth.getSession()
        .then(({ data, error }) => {
            if (error) throw error;
            renderAuthAction(data.session?.user || null);
        })
        .catch((error) => {
            console.warn("Unable to update the header account action.", error);
        });
}

/**
 * Update navigation state.
 */
function setNavigationState(navToggle, navMenu, isOpen) {
    navToggle.setAttribute("aria-expanded", String(isOpen));

    navToggle.setAttribute(
        "aria-label",
        isOpen ? "Close navigation menu" : "Open navigation menu"
    );

    navMenu.classList.toggle("is-open", isOpen);
}
