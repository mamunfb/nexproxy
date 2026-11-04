"use strict";

const accountState = {
    client: null,
    user: null,
    redirectedAfterAuth: false,
    pendingPhone: "",
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
    phoneStatus: document.getElementById("account-phone-status"),
    phoneRequestForm: document.getElementById("account-phone-request-form"),
    phoneConfirmForm: document.getElementById("account-phone-confirm-form"),
    phoneNumber: document.getElementById("account-phone-number"),
    phoneCode: document.getElementById("account-phone-code"),
    phoneSendButton: document.getElementById("account-phone-send-code"),
    phoneVerifyButton: document.getElementById("account-phone-verify-code"),
    phoneResendButton: document.getElementById("account-phone-resend-code"),
    phoneMessage: document.getElementById("account-phone-message")
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
        accountState.pendingPhone = "";
        setVisible(accountElements.phoneConfirmForm, false);
        if (accountElements.phoneCode) accountElements.phoneCode.value = "";
        clearMessage(accountElements.phoneMessage);
        showAuthentication();
        return;
    }

    const metadata = user.user_metadata || {};
    document.getElementById("account-user-email").textContent = user.email || "—";
    document.getElementById("account-created-at").textContent = formatMemberSince(user.created_at);
    document.getElementById("profile-name").value = metadata.full_name || "";
    document.getElementById("profile-phone").value = metadata.phone || "";
    renderPhoneVerification(user);
    setAccountView("dashboard");
}

function renderPhoneVerification(user) {
    const enabled = window.NEXPROXY_WHATSAPP_OTP_ENABLED === true;
    const phone = user?.phone || "";
    const verified = Boolean(user?.phone_confirmed_at);
    if (accountElements.phoneStatus) {
        if (!enabled) {
            accountElements.phoneStatus.textContent = "WhatsApp phone verification is not active yet.";
        } else if (verified) {
            accountElements.phoneStatus.textContent = `Verified WhatsApp number: ${phone}`;
        } else if (phone) {
            accountElements.phoneStatus.textContent = `A WhatsApp number is on this account but is not verified: ${phone}`;
        } else {
            accountElements.phoneStatus.textContent = "No WhatsApp number is verified on this account.";
        }
    }
    if (accountElements.phoneSendButton) accountElements.phoneSendButton.disabled = !enabled;
    if (accountElements.phoneResendButton) accountElements.phoneResendButton.disabled = !enabled;
    if (accountElements.phoneNumber && !accountState.pendingPhone) {
        accountElements.phoneNumber.value = phone;
    }
    if (verified && accountState.pendingPhone === phone) {
        accountState.pendingPhone = "";
        setVisible(accountElements.phoneConfirmForm, false);
    } else if (!accountState.pendingPhone) {
        setVisible(accountElements.phoneConfirmForm, false);
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

    accountElements.phoneRequestForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (window.NEXPROXY_WHATSAPP_OTP_ENABLED !== true) {
            setMessage(accountElements.phoneMessage, "WhatsApp phone verification is not active yet.", "error");
            return;
        }
        if (!event.currentTarget.reportValidity()) return;

        const phone = accountElements.phoneNumber.value.trim();
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            setMessage(accountElements.phoneMessage, "Enter a valid international phone number, for example +8801XXXXXXXXX.", "error");
            return;
        }
        if (accountState.user?.phone === phone && accountState.user?.phone_confirmed_at) {
            setMessage(accountElements.phoneMessage, "This WhatsApp number is already verified.", "success");
            return;
        }

        clearMessage(accountElements.phoneMessage);
        setSubmitState(accountElements.phoneSendButton, true, "Sending code…", "Send WhatsApp code");
        try {
            const { error } = await accountState.client.auth.updateUser({ phone });
            if (error) throw error;
            accountState.pendingPhone = phone;
            accountElements.phoneCode.value = "";
            setVisible(accountElements.phoneConfirmForm, true);
            setMessage(accountElements.phoneMessage, "A verification code was requested. Check WhatsApp and enter the code here.", "success");
        } catch (error) {
            setMessage(accountElements.phoneMessage, error.message || "Unable to send the WhatsApp code. Please try again later.", "error");
        } finally {
            setSubmitState(accountElements.phoneSendButton, false, "Sending code…", "Send WhatsApp code");
        }
    });

    accountElements.phoneConfirmForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        if (!accountState.pendingPhone) {
            setMessage(accountElements.phoneMessage, "Request a new verification code first.", "error");
            setVisible(accountElements.phoneConfirmForm, false);
            return;
        }

        const token = accountElements.phoneCode.value.trim();
        if (!/^\d{4,10}$/.test(token)) {
            setMessage(accountElements.phoneMessage, "Enter the verification code using digits only.", "error");
            return;
        }
        setSubmitState(accountElements.phoneVerifyButton, true, "Verifying…", "Verify WhatsApp number");
        try {
            const { data, error } = await accountState.client.auth.verifyOtp({
                phone: accountState.pendingPhone,
                token,
                type: "phone_change"
            });
            if (error) throw error;
            accountState.user = data.user || accountState.user;
            accountState.pendingPhone = "";
            accountElements.phoneCode.value = "";
            setVisible(accountElements.phoneConfirmForm, false);
            renderPhoneVerification(accountState.user);
            setMessage(accountElements.phoneMessage, "Your WhatsApp number is verified.", "success");
        } catch (error) {
            setMessage(accountElements.phoneMessage, error.message || "That code could not be verified. Request a new code and try again.", "error");
        } finally {
            setSubmitState(accountElements.phoneVerifyButton, false, "Verifying…", "Verify WhatsApp number");
        }
    });

    accountElements.phoneResendButton?.addEventListener("click", async () => {
        if (window.NEXPROXY_WHATSAPP_OTP_ENABLED !== true || !accountState.pendingPhone) return;
        clearMessage(accountElements.phoneMessage);
        setSubmitState(accountElements.phoneResendButton, true, "Sending…", "Send another code");
        try {
            const { error } = await accountState.client.auth.updateUser({ phone: accountState.pendingPhone });
            if (error) throw error;
            accountElements.phoneCode.value = "";
            setMessage(accountElements.phoneMessage, "A new verification code was requested. Check WhatsApp.", "success");
        } catch (error) {
            setMessage(accountElements.phoneMessage, error.message || "Unable to resend the code. Please wait before trying again.", "error");
        } finally {
            setSubmitState(accountElements.phoneResendButton, false, "Sending…", "Send another code");
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
