"use strict";

const accountState = {
    client: null,
    user: null,
    redirectedAfterAuth: false,
    telegramPollTimer: null,
    initialAuthTab: new URLSearchParams(window.location.search).get("view") === "signup" ? "signup" : "signin",
    recoveryFlow: new URLSearchParams(window.location.search).get("mode") === "recovery"
};

const accountElements = {
    loading: document.getElementById("account-loading"),
    loadError: document.getElementById("account-load-error"),
    auth: document.getElementById("account-auth-view"),
    recovery: document.getElementById("account-recovery-view"),
    dashboard: document.getElementById("account-dashboard-view"),
    signInForm: document.getElementById("account-signin-form"),
    signUpForm: document.getElementById("account-signup-form"),
    resetRequestForm: document.getElementById("account-reset-request-form"),
    setPasswordForm: document.getElementById("account-set-password-form"),
    profileForm: document.getElementById("account-profile-form"),
    passwordForm: document.getElementById("account-password-form"),
    authMessage: document.getElementById("account-auth-message"),
    recoveryMessage: document.getElementById("account-recovery-message"),
    profileMessage: document.getElementById("account-profile-message"),
    passwordMessage: document.getElementById("account-password-message"),
    tabs: Array.from(document.querySelectorAll("[data-auth-tab]")),
    googleSignInButton: document.getElementById("google-signin-button"),
    googleSignUpButton: document.getElementById("google-signup-button"),
    githubSignInButton: document.getElementById("github-signin-button"),
    githubSignUpButton: document.getElementById("github-signup-button"),
    telegramStatus: document.getElementById("account-telegram-status"),
    telegramCreateLink: document.getElementById("account-telegram-create-link"),
    telegramOpenLink: document.getElementById("account-telegram-open-link"),
    telegramActivate: document.getElementById("account-telegram-activate"),
    telegramMessage: document.getElementById("account-telegram-message")
};

function setVisible(element, isVisible) {
    if (element) {
        element.hidden = !isVisible;
    }
}

function setAccountView(view) {
    setVisible(accountElements.loading, view === "loading");
    setVisible(accountElements.auth, view === "auth");
    setVisible(accountElements.recovery, view === "recovery");
    setVisible(accountElements.dashboard, view === "dashboard");
}

function setMessage(element, message, kind = "info") {
    if (!element) {
        return;
    }

    element.textContent = message;
    element.classList.remove("is-error", "is-success");
    if (kind === "error") {
        element.classList.add("is-error");
    } else if (kind === "success") {
        element.classList.add("is-success");
    }
    setVisible(element, Boolean(message));
}

function clearMessage(element) {
    setMessage(element, "");
}

function setSubmitState(button, isBusy, busyLabel, idleLabel) {
    if (!button) {
        return;
    }
    button.disabled = isBusy;
    button.setAttribute("aria-busy", String(isBusy));
    button.textContent = isBusy ? busyLabel : idleLabel;
}

function showAuthTab(tabName) {
    const showSignUp = tabName === "signup";
    setVisible(accountElements.signInForm, !showSignUp);
    setVisible(accountElements.signUpForm, showSignUp);
    setVisible(accountElements.googleSignInButton, !showSignUp);
    setVisible(accountElements.googleSignUpButton, showSignUp);
    setVisible(accountElements.githubSignInButton, !showSignUp);
    setVisible(accountElements.githubSignUpButton, showSignUp);

    accountElements.tabs.forEach((tab) => {
        tab.setAttribute(
            "aria-selected",
            String(tab.dataset.authTab === tabName)
        );
    });
    clearMessage(accountElements.authMessage);
}

function showAuthentication(message = "", kind = "info") {
    accountState.recoveryFlow = false;
    setAccountView("auth");
    setVisible(accountElements.resetRequestForm, true);
    setVisible(accountElements.setPasswordForm, false);
    showAuthTab(accountState.initialAuthTab);
    setMessage(accountElements.authMessage, message, kind);
}

function showRecoveryRequest(message = "", kind = "info") {
    accountState.recoveryFlow = false;
    setAccountView("recovery");
    setVisible(accountElements.resetRequestForm, true);
    setVisible(accountElements.setPasswordForm, false);
    setMessage(accountElements.recoveryMessage, message, kind);
    document.getElementById("account-recovery-title").textContent = "Reset your password";
    document.getElementById("account-recovery-lead").textContent =
        "Enter the email address on your account and we’ll send a password reset link if an account matches.";
}

function showPasswordRecovery(message = "") {
    accountState.recoveryFlow = true;
    setAccountView("recovery");
    setVisible(accountElements.resetRequestForm, false);
    setVisible(accountElements.setPasswordForm, true);
    setMessage(accountElements.recoveryMessage, message);
    document.getElementById("account-recovery-title").textContent = "Choose a new password";
    document.getElementById("account-recovery-lead").textContent =
        "Enter and confirm your new password to finish resetting your account password.";
}

function formatMemberSince(timestamp) {
    if (!timestamp) {
        return "—";
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(date);
}

function renderProfile(user) {
    accountState.user = user || null;
    if (!user) {
        if (accountState.telegramPollTimer) clearInterval(accountState.telegramPollTimer);
        accountState.telegramPollTimer = null;
        if (accountElements.telegramOpenLink) {
            accountElements.telegramOpenLink.hidden = true;
            accountElements.telegramOpenLink.removeAttribute("href");
        }
        clearMessage(accountElements.telegramMessage);
        showAuthentication();
        return;
    }

    const metadata = user.user_metadata || {};
    document.getElementById("account-user-email").textContent = user.email || "—";
    document.getElementById("account-created-at").textContent = formatMemberSince(user.created_at);
    document.getElementById("profile-name").value = metadata.full_name || "";
    document.getElementById("profile-phone").value = metadata.phone || "";
    setAccountView("dashboard");
    refreshTelegramContactStatus();
}

async function refreshTelegramContactStatus(silent = false) {
    if (!accountState.user || !accountElements.telegramStatus) return null;
    try {
        const { data, error } = await accountState.client.functions.invoke("telegram-contact", {
            body: { action: "status" }
        });
        if (error || !data?.success) throw error || new Error("Status unavailable");
        const isAdmin = accountState.user.email?.toLowerCase() === "mamunfb13@gmail.com";
        const isVerified = data.verified === true;
        const username = data.username ? `@${String(data.username).replace(/^@/, "")}` : "Telegram chat";
        if (!data.configured) {
            accountElements.telegramStatus.textContent = "Telegram bot setup is not complete yet.";
        } else if (isVerified && data.required) {
            accountElements.telegramStatus.textContent = `Verified as ${username}. New orders require a verified Telegram chat; proxy delivery will be sent here.`;
        } else if (isVerified) {
            accountElements.telegramStatus.textContent = `Verified as ${username}. The administrator has not yet made Telegram verification mandatory for new orders.`;
        } else if (data.required) {
            accountElements.telegramStatus.textContent = "Telegram verification is required before a new order can be confirmed.";
        } else {
            accountElements.telegramStatus.textContent = "Connect Telegram here to receive proxy delivery messages. The bot will be enabled for required verification after setup.";
        }
        if (accountElements.telegramCreateLink) accountElements.telegramCreateLink.disabled = !data.configured;
        if (accountElements.telegramActivate) {
            accountElements.telegramActivate.hidden = !isAdmin;
            accountElements.telegramActivate.disabled = !data.configured || data.required === true;
            accountElements.telegramActivate.textContent = data.required === true
                ? "Telegram verification is required for new orders"
                : "Require Telegram verification for new orders";
        }
        if (isVerified && accountState.telegramPollTimer) {
            clearInterval(accountState.telegramPollTimer);
            accountState.telegramPollTimer = null;
        }
        return data;
    } catch (_error) {
        if (!silent) accountElements.telegramStatus.textContent = "Telegram status is temporarily unavailable. Please try again later.";
        return null;
    }
}

async function createTelegramContactLink() {
    if (!accountState.user) return;
    setSubmitState(accountElements.telegramCreateLink, true, "Creating link…", "Create secure Telegram link");
    clearMessage(accountElements.telegramMessage);
    if (accountElements.telegramOpenLink) accountElements.telegramOpenLink.hidden = true;
    try {
        const { data, error } = await accountState.client.functions.invoke("telegram-contact", {
            body: { action: "create_link" }
        });
        if (error || !data?.success || !data?.botUrl) throw error || new Error("Link unavailable");
        accountElements.telegramOpenLink.href = data.botUrl;
        accountElements.telegramOpenLink.hidden = false;
        setMessage(accountElements.telegramMessage, "This secure link expires in 10 minutes. Open it in Telegram and press Start. Do not forward or share the link.", "success");
        if (accountState.telegramPollTimer) clearInterval(accountState.telegramPollTimer);
        accountState.telegramPollTimer = setInterval(() => refreshTelegramContactStatus(true), 5000);
    } catch (_error) {
        setMessage(accountElements.telegramMessage, "Telegram is not ready yet. Check that the bot has been configured, then try again.", "error");
    } finally {
        setSubmitState(accountElements.telegramCreateLink, false, "Creating link…", "Create secure Telegram link");
    }
}

async function activateTelegramRequirement() {
    if (!accountState.user || accountState.user.email?.toLowerCase() !== "mamunfb13@gmail.com") return;
    const confirmed = window.confirm("Require customers to connect Telegram before confirming new orders? Customers will not be able to place new orders until they link the NexProxy bot.");
    if (!confirmed) return;
    let activated = false;
    setSubmitState(accountElements.telegramActivate, true, "Activating…", "Require Telegram verification for new orders");
    try {
        const { data, error } = await accountState.client.functions.invoke("telegram-contact", {
            body: { action: "activate" }
        });
        if (error || !data?.success) throw error || new Error("Activation failed");
        activated = true;
        setMessage(accountElements.telegramMessage, "Telegram verification is now required for new orders. The bot webhook was configured.", "success");
        await refreshTelegramContactStatus(true);
    } catch (_error) {
        setMessage(accountElements.telegramMessage, "Telegram could not be activated. Confirm the bot token and username are saved in Supabase Edge Function Secrets.", "error");
    } finally {
        setSubmitState(accountElements.telegramActivate, false, "Activating…", "Require Telegram verification for new orders");
        if (activated) {
            accountElements.telegramActivate.disabled = true;
            accountElements.telegramActivate.textContent = "Telegram verification is required for new orders";
        }
    }
}

function getAccountRedirectUrl() {
    const callback = new URL("./", window.location.href);
    callback.searchParams.set("mode", "recovery");
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) callback.searchParams.set("next", next);
    return callback.href;
}

function getAuthRedirectUrl() {
    const callback = new URL("./", window.location.href);
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) callback.searchParams.set("next", next);
    return callback.href;
}

function redirectAfterAuth(user) {
    const next = new URLSearchParams(window.location.search).get("next");
    if (!user || !next || accountState.redirectedAfterAuth) return;
    try {
        const target = new URL(next, window.location.origin);
        if (target.origin !== window.location.origin) return;
        accountState.redirectedAfterAuth = true;
        window.location.replace(target.href);
    } catch (error) {
        console.warn("Unable to return to the requested page.", error);
    }
}

async function signInWithProvider(button, provider, providerName) {
    clearMessage(accountElements.authMessage);
    const isSignup = button.id.includes("signup");
    const idleLabel = `${isSignup ? "Sign Up" : "Sign in"} with ${providerName}`;
    setSubmitState(button, true, "Connecting…", idleLabel);

    try {
        const { error } = await accountState.client.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: getAuthRedirectUrl()
            }
        });
        if (error) throw error;
    } catch (error) {
        setMessage(
            accountElements.authMessage,
            error.message || `${providerName} sign-in is currently unavailable. Please try email and password.`,
            "error"
        );
        setSubmitState(button, false, "Connecting…", idleLabel);
    }
}

function getFormValues(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function showLoadFailure(message) {
    setAccountView("loading");
    setMessage(accountElements.loadError, message, "error");
}

function bindAccountForms() {
    accountElements.googleSignInButton?.addEventListener("click", () => {
        signInWithProvider(accountElements.googleSignInButton, "google", "Google");
    });

    accountElements.googleSignUpButton?.addEventListener("click", () => {
        signInWithProvider(accountElements.googleSignUpButton, "google", "Google");
    });

    accountElements.githubSignInButton?.addEventListener("click", () => {
        signInWithProvider(accountElements.githubSignInButton, "github", "GitHub");
    });

    accountElements.githubSignUpButton?.addEventListener("click", () => {
        signInWithProvider(accountElements.githubSignUpButton, "github", "GitHub");
    });

    accountElements.telegramCreateLink?.addEventListener("click", createTelegramContactLink);
    accountElements.telegramActivate?.addEventListener("click", activateTelegramRequirement);

    accountElements.tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            accountState.initialAuthTab = tab.dataset.authTab;
            showAuthTab(tab.dataset.authTab);
        });
    });

    document.getElementById("show-reset-request").addEventListener("click", () => {
        setMessage(accountElements.recoveryMessage, "");
        document.getElementById("reset-email").value =
            document.getElementById("signin-email").value.trim();
        showRecoveryRequest();
    });

    document.querySelectorAll("[data-back-to-signin]").forEach((button) => {
        button.addEventListener("click", () => showAuthentication());
    });

    accountElements.signInForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.authMessage);
        setSubmitState(button, true, "Signing in…", "Sign in");

        try {
            const { data, error } = await accountState.client.auth.signInWithPassword({
                email: values.email.trim(),
                password: values.password
            });
            if (error) throw error;
            const user = data.user || data.session?.user;
            renderProfile(user);
            redirectAfterAuth(user);
        } catch (error) {
            setMessage(accountElements.authMessage, error.message || "Unable to sign in. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Signing in…", "Sign in");
        }
    });

    accountElements.signUpForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.authMessage);
        setSubmitState(button, true, "Creating account…", "Create account");

        try {
            const { data, error } = await accountState.client.auth.signUp({
                email: values.email.trim(),
                password: values.password,
                options: {
                        emailRedirectTo: getAuthRedirectUrl(),
                    data: { full_name: values.full_name.trim() }
                }
            });
            if (error) throw error;

            if (data.session && data.user) {
                renderProfile(data.user);
                redirectAfterAuth(data.user);
            } else {
                showAuthTab("signin");
                setMessage(
                    accountElements.authMessage,
                    "Account request received. Check your email for a confirmation link before signing in.",
                    "success"
                );
            }
        } catch (error) {
            setMessage(accountElements.authMessage, error.message || "Unable to create the account. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Creating account…", "Create account");
        }
    });

    accountElements.resetRequestForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.recoveryMessage);
        setSubmitState(button, true, "Sending…", "Send reset link");

        try {
            const { error } = await accountState.client.auth.resetPasswordForEmail(
                values.email.trim(),
                { redirectTo: getAccountRedirectUrl() }
            );
            if (error) throw error;
            setMessage(
                accountElements.recoveryMessage,
                "If an account matches that email, a password reset link will be sent.",
                "success"
            );
        } catch (error) {
            setMessage(accountElements.recoveryMessage, error.message || "Unable to send the reset link. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Sending…", "Send reset link");
        }
    });

    accountElements.setPasswordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        if (values.password !== values.password_confirmation) {
            setMessage(accountElements.recoveryMessage, "The passwords do not match.", "error");
            return;
        }

        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.recoveryMessage);
        setSubmitState(button, true, "Updating password…", "Update password");

        try {
            const { error } = await accountState.client.auth.updateUser({ password: values.password });
            if (error) throw error;
            form.reset();
            accountState.recoveryFlow = false;
            renderProfile(accountState.user);
            setMessage(accountElements.passwordMessage, "Your password has been updated.", "success");
        } catch (error) {
            setMessage(accountElements.recoveryMessage, error.message || "Unable to update the password. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Updating password…", "Update password");
        }
    });

    accountElements.profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.profileMessage);
        setSubmitState(button, true, "Saving…", "Save profile");

        try {
            const { data, error } = await accountState.client.auth.updateUser({
                data: {
                    full_name: values.full_name.trim(),
                    phone: values.phone.trim()
                }
            });
            if (error) throw error;
            if (data.user) accountState.user = data.user;
            setMessage(accountElements.profileMessage, "Your profile has been saved.", "success");
        } catch (error) {
            setMessage(accountElements.profileMessage, error.message || "Unable to save your profile. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Saving…", "Save profile");
        }
    });

    accountElements.passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;

        const values = getFormValues(form);
        if (values.password !== values.password_confirmation) {
            setMessage(accountElements.passwordMessage, "The passwords do not match.", "error");
            return;
        }

        const button = form.querySelector('[type="submit"]');
        clearMessage(accountElements.passwordMessage);
        setSubmitState(button, true, "Updating password…", "Update password");

        try {
            const { error } = await accountState.client.auth.updateUser({ password: values.password });
            if (error) throw error;
            form.reset();
            setMessage(accountElements.passwordMessage, "Your password has been updated.", "success");
        } catch (error) {
            setMessage(accountElements.passwordMessage, error.message || "Unable to update the password. Please try again.", "error");
        } finally {
            setSubmitState(button, false, "Updating password…", "Update password");
        }
    });

}

async function initializeCustomerAccount() {
    try {
        const url = window.NEXPROXY_SUPABASE_URL;
        const key = window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY;

        if (!url || !key) {
            throw new Error("The account service is not configured for this site.");
        }
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            throw new Error("The account service library could not be loaded. Please refresh and try again.");
        }

        accountState.client = window.NEXPROXY_SUPABASE_CLIENT || window.supabase.createClient(url, key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        window.NEXPROXY_SUPABASE_CLIENT = accountState.client;
        bindAccountForms();

        accountState.client.auth.onAuthStateChange((event, session) => {
            if (event === "PASSWORD_RECOVERY") {
                accountState.user = session?.user || null;
                accountState.recoveryFlow = true;
                showPasswordRecovery();
                return;
            }
            if (event === "SIGNED_OUT") {
                accountState.user = null;
                showAuthentication();
                return;
            }
            if (accountState.recoveryFlow && session) {
                accountState.user = session.user;
                showPasswordRecovery();
                return;
            }
            renderProfile(session?.user || null);
            redirectAfterAuth(session?.user || null);
        });

        const { data, error } = await accountState.client.auth.getSession();
        if (error) throw error;

        const session = data.session;
        if (accountState.recoveryFlow && session) {
            accountState.user = session.user;
            showPasswordRecovery();
        } else {
            renderProfile(session?.user || null);
            redirectAfterAuth(session?.user || null);
        }
    } catch (error) {
        showLoadFailure(error.message || "Unable to connect to the account service. Please refresh and try again.");
    }
}

document.addEventListener("DOMContentLoaded", initializeCustomerAccount);
