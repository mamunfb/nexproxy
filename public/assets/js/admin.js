"use strict";

/* =========================================================
   NexProxy Admin
   Sprint 17 — Authentication Foundation
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const ADMIN_SUPABASE_URL =
    "https://fzvxuhumtebqlpwqpkvt.supabase.co";

const ADMIN_LOGIN_VIEW_ID =
    "admin-login-view";

const ADMIN_ACCESS_DENIED_VIEW_ID =
    "admin-access-denied-view";

const ADMIN_DASHBOARD_VIEW_ID =
    "admin-dashboard-view";


/* =========================================================
   APPLICATION STATE
   ========================================================= */

const adminState = {
    supabase: null,
    session: null,
    user: null,
    isAdmin: false,
    initialized: false,
    loading: false
};


/* =========================================================
   DOM HELPERS
   ========================================================= */

/**
 * Return an element by ID.
 */
function adminElement(id) {
    return document.getElementById(id);
}


/**
 * Show an element.
 */
function showAdminElement(element) {
    if (!element) {
        return;
    }

    element.classList.remove("is-hidden");
}


/**
 * Hide an element.
 */
function hideAdminElement(element) {
    if (!element) {
        return;
    }

    element.classList.add("is-hidden");
}


/**
 * Set an element message.
 */
function setAdminMessage(
    element,
    message,
    type = ""
) {
    if (!element) {
        return;
    }

    element.textContent = message || "";

    element.classList.remove(
        "is-error",
        "is-success"
    );

    if (type === "error") {
        element.classList.add("is-error");
    }

    if (type === "success") {
        element.classList.add("is-success");
    }
}


/* =========================================================
   VIEW MANAGEMENT
   ========================================================= */

/**
 * Hide every primary admin view.
 */
function hideAdminViews() {
    hideAdminElement(
        adminElement(ADMIN_LOGIN_VIEW_ID)
    );

    hideAdminElement(
        adminElement(ADMIN_ACCESS_DENIED_VIEW_ID)
    );

    hideAdminElement(
        adminElement(ADMIN_DASHBOARD_VIEW_ID)
    );
}


/**
 * Show login view.
 */
function showAdminLogin() {
    hideAdminViews();

    showAdminElement(
        adminElement(ADMIN_LOGIN_VIEW_ID)
    );

    setAdminLoadingState(false);
}


/**
 * Show access denied view.
 */
function showAdminAccessDenied() {
    hideAdminViews();

    showAdminElement(
        adminElement(ADMIN_ACCESS_DENIED_VIEW_ID)
    );

    setAdminLoadingState(false);
}


/**
 * Show dashboard.
 */
function showAdminDashboard() {
    hideAdminViews();

    showAdminElement(
        adminElement(ADMIN_DASHBOARD_VIEW_ID)
    );

    setAdminLoadingState(false);
}


/* =========================================================
   LOADING STATE
   ========================================================= */

/**
 * Update login button loading state.
 */
function setAdminLoadingState(isLoading) {
    adminState.loading = Boolean(isLoading);

    const loginButton =
        adminElement("admin-login-submit");

    if (!loginButton) {
        return;
    }

    loginButton.disabled =
        adminState.loading;

    loginButton.setAttribute(
        "aria-busy",
        String(adminState.loading)
    );

    loginButton.textContent =
        adminState.loading
            ? "Signing in..."
            : "Login";
}


/* =========================================================
   SUPABASE INITIALIZATION
   ========================================================= */

/**
 * Return the configured Supabase publishable key.
 */
function getAdminSupabasePublishableKey() {
    const key =
        window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY;

    if (
        typeof key !== "string" ||
        !key.trim()
    ) {
        throw new Error(
            "Supabase configuration is unavailable."
        );
    }

    return key.trim();
}


/**
 * Initialize Supabase client.
 */
function initializeAdminSupabase() {
    if (adminState.supabase) {
        return adminState.supabase;
    }

    if (
        typeof window.supabase === "undefined" ||
        typeof window.supabase.createClient !== "function"
    ) {
        throw new Error(
            "Supabase library failed to load."
        );
    }

    const publishableKey =
        getAdminSupabasePublishableKey();

    adminState.supabase =
        window.supabase.createClient(
            ADMIN_SUPABASE_URL,
            publishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );

    return adminState.supabase;
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

/**
 * Return the current Supabase session.
 */
async function getCurrentAdminSession() {
    const supabase =
        initializeAdminSupabase();

    const {
        data,
        error
    } = await supabase.auth.getSession();

    if (error) {
        throw error;
    }

    return data?.session || null;
}


/**
 * Sign in administrator.
 */
async function signInAdmin(
    email,
    password
) {
    const supabase =
        initializeAdminSupabase();

    const {
        data,
        error
    } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        throw error;
    }

    return data?.session || null;
}


/**
 * Sign out administrator.
 */
async function signOutAdmin() {
    const supabase =
        initializeAdminSupabase();

    const {
        error
    } = await supabase.auth.signOut();

    if (error) {
        throw error;
    }

    adminState.session = null;
    adminState.user = null;
    adminState.isAdmin = false;
}


/* =========================================================
   ADMIN AUTHORIZATION
   ========================================================= */

/**
 * Check whether the authenticated user
 * is registered as an administrator.
 *
 * The actual authorization decision is made
 * server-side by public.is_admin().
 */
async function checkAdminAuthorization() {
    const supabase =
        initializeAdminSupabase();

    if (!adminState.session) {
        adminState.isAdmin = false;

        return false;
    }

    const {
        data,
        error
    } = await supabase.rpc(
        "is_admin"
    );

    if (error) {
        throw error;
    }

    adminState.isAdmin =
        data === true;

    return adminState.isAdmin;
}


/* =========================================================
   CURRENT USER DISPLAY
   ========================================================= */

/**
 * Update the current administrator display.
 */
function updateCurrentAdminDisplay() {
    const element =
        adminElement("admin-current-user");

    if (!element) {
        return;
    }

    const email =
        adminState.user?.email;

    element.textContent =
        email
            ? email
            : "";
}


/* =========================================================
   LOGIN FORM
   ========================================================= */

/**
 * Initialize login form.
 */
function initAdminLoginForm() {
    const form =
        adminElement("admin-login-form");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            if (adminState.loading) {
                return;
            }

            const emailInput =
                adminElement(
                    "admin-login-email"
                );

            const passwordInput =
                adminElement(
                    "admin-login-password"
                );

            const message =
                adminElement(
                    "admin-login-message"
                );

            const submitButton =
                adminElement(
                    "admin-login-submit"
                );

            const email =
                emailInput?.value
                    ?.trim() || "";

            const password =
                passwordInput?.value || "";

            setAdminMessage(
                message,
                ""
            );

            if (!email) {
                setAdminMessage(
                    message,
                    "Please enter your email.",
                    "error"
                );

                emailInput?.focus();

                return;
            }

            if (!password) {
                setAdminMessage(
                    message,
                    "Please enter your password.",
                    "error"
                );

                passwordInput?.focus();

                return;
            }

            setAdminLoadingState(true);

            if (submitButton) {
                submitButton.disabled = true;
            }

            try {
                const session =
                    await signInAdmin(
                        email,
                        password
                    );

                adminState.session =
                    session;

                adminState.user =
                    session?.user || null;

                /*
                 * Authentication alone does not grant
                 * admin access.
                 *
                 * The database-side is_admin()
                 * function remains the authority.
                 */

                const isAdmin =
                    await checkAdminAuthorization();

                if (!isAdmin) {
                    setAdminMessage(
                        message,
                        "Your account is not authorized to access the admin panel.",
                        "error"
                    );

                    await signOutAdmin();

                    showAdminAccessDenied();

                    return;
                }

                updateCurrentAdminDisplay();

                showAdminDashboard();

                await initializeAdminDashboard();

            } catch (error) {
                console.error(
                    "NexProxy admin login error:",
                    error
                );

                const errorMessage =
                    getFriendlyAuthErrorMessage(
                        error
                    );

                setAdminMessage(
                    message,
                    errorMessage,
                    "error"
                );

            } finally {
                setAdminLoadingState(false);
            }
        }
    );
}


/* =========================================================
   AUTH ERROR HANDLING
   ========================================================= */

/**
 * Convert Supabase authentication errors
 * into user-friendly messages.
 */
function getFriendlyAuthErrorMessage(
    error
) {
    const message =
        error?.message
            ?.trim() || "";

    const normalized =
        message.toLowerCase();

    if (
        normalized.includes(
            "invalid login credentials"
        )
    ) {
        return "Invalid email or password.";
    }

    if (
        normalized.includes(
            "email not confirmed"
        )
    ) {
        return "Your email address has not been confirmed.";
    }

    if (
        normalized.includes(
            "too many requests"
        )
    ) {
        return "Too many login attempts. Please try again later.";
    }

    if (
        normalized.includes(
            "failed to fetch"
        )
    ) {
        return "Unable to connect to the authentication service.";
    }

    if (
        normalized.includes(
            "supabase library failed"
        )
    ) {
        return "The authentication service could not be initialized.";
    }

    if (
        normalized.includes(
            "configuration is unavailable"
        )
    ) {
        return "Supabase configuration is unavailable.";
    }

    return (
        message ||
        "Unable to sign in. Please try again."
    );
}


/* =========================================================
   LOGOUT
   ========================================================= */

/**
 * Initialize logout controls.
 */
function initAdminLogout() {
    const logoutButtons = [
        adminElement("admin-logout"),
        adminElement("admin-access-denied-logout")
    ].filter(Boolean);

    logoutButtons.forEach(
        (button) => {
            button.addEventListener(
                "click",
                async () => {
                    button.disabled = true;

                    try {
                        await signOutAdmin();

                        showAdminLogin();

                        const form =
                            adminElement(
                                "admin-login-form"
                            );

                        form?.reset();

                        setAdminMessage(
                            adminElement(
                                "admin-login-message"
                            ),
                            ""
                        );

                    } catch (error) {
                        console.error(
                            "NexProxy admin logout error:",
                            error
                        );

                        button.disabled = false;

                        showAdminToast(
                            "Unable to sign out. Please try again.",
                            "error"
                        );
                    }
                }
            );
        }
    );
}


/* =========================================================
   AUTH STATE CHANGES
   ========================================================= */

/**
 * Listen for Supabase authentication state changes.
 */
function initAdminAuthListener() {
    const supabase =
        initializeAdminSupabase();

    supabase.auth.onAuthStateChange(
        async (
            event,
            session
        ) => {
            console.log(
                "NexProxy admin auth event:",
                event
            );

            /*
             * SIGNED_OUT
             */

            if (
                event === "SIGNED_OUT"
            ) {
                adminState.session = null;
                adminState.user = null;
                adminState.isAdmin = false;

                showAdminLogin();

                return;
            }

            /*
             * SIGNED_IN / INITIAL_SESSION
             *
             * The initial bootstrap handles
             * the normal authorization flow.
             *
             * Avoid duplicating the entire dashboard
             * initialization during TOKEN_REFRESHED.
             */

            if (
                event === "SIGNED_IN" &&
                session
            ) {
                adminState.session =
                    session;

                adminState.user =
                    session.user;

                try {
                    const isAdmin =
                        await checkAdminAuthorization();

                    if (!isAdmin) {
                        await signOutAdmin();

                        showAdminAccessDenied();

                        return;
                    }

                    updateCurrentAdminDisplay();

                    showAdminDashboard();

                } catch (error) {
                    console.error(
                        "NexProxy admin authorization error:",
                        error
                    );

                    showAdminToast(
                        "Unable to verify administrator access.",
                        "error"
                    );
                }
            }

            /*
             * TOKEN_REFRESHED
             */

            if (
                event === "TOKEN_REFRESHED" &&
                session
            ) {
                adminState.session =
                    session;

                adminState.user =
                    session.user;

                updateCurrentAdminDisplay();
            }
        }
    );
}


/* =========================================================
   DASHBOARD FOUNDATION
   ========================================================= */

/**
 * Initialize dashboard foundation.
 *
 * Data modules will be added in later Sprint 17 stages.
 */
async function initializeAdminDashboard() {
    updateCurrentAdminDisplay();

    try {
        await loadAdminDashboardData();
    } catch (error) {
        console.error(
            "NexProxy admin dashboard load error:",
            error
        );

        showAdminToast(
            "Unable to load dashboard data.",
            "error"
        );

        setCustomerTableMessage(
            "Unable to load customer data."
        );
    }
}

/* =========================================================
   ADMIN DATA LAYER — SPRINT 17
   ========================================================= */

/**
 * Runtime dashboard data.
 */
const adminDashboardState = {
    orders: [],
    assignments: [],
    inventory: [],
    paymentSettings: [],
    customers: [],
    activityLogs: [],
    customerFilter: "ALL",
    customerSearch: "",
    inventoryFilter: "ALL",
    inventorySearch: ""
};


/**
 * Load all dashboard data required by the
 * customer overview.
 */
async function loadAdminDashboardData() {
    const supabase =
        initializeAdminSupabase();

    const [
    ordersResult,
    assignmentsResult,
    inventoryResult,
    paymentSettingsResult,
    fulfillmentsResult,
    activityLogsResult
] = await Promise.all([
        supabase
            .from("orders")
            .select("*")
            .order("created_at", {
                ascending: false
            }),

        supabase
            .from("proxy_assignments")
            .select("*")
            .order("created_at", {
                ascending: false
            }),

        supabase
            .from("proxy_inventory")
            .select("*")
            .order("created_at", {
                ascending: false
            }),

        supabase.rpc(
            "get_admin_payment_settings"
        ),

        supabase.rpc(
            "get_admin_fulfillment_status"
        ),

        supabase
            .from("admin_activity_log")
            .select("*")
            .order("created_at", {
                ascending: false
            })
            .limit(100)
    ]);

    if (ordersResult.error) {
        throw ordersResult.error;
    }

    if (assignmentsResult.error) {
        throw assignmentsResult.error;
    }

    if (inventoryResult.error) {
        throw inventoryResult.error;
    }

    if (paymentSettingsResult.error) {
        throw paymentSettingsResult.error;
    }

    if (fulfillmentsResult.error) {
        throw fulfillmentsResult.error;
    }

    if (activityLogsResult.error) {
    throw activityLogsResult.error;
    }

    adminDashboardState.orders =
        Array.isArray(ordersResult.data)
            ? ordersResult.data
            : [];

    adminDashboardState.assignments =
        Array.isArray(assignmentsResult.data)
            ? assignmentsResult.data
            : [];

    adminDashboardState.inventory =
    Array.isArray(inventoryResult.data)
        ? inventoryResult.data
        : [];

    adminDashboardState.paymentSettings =
    Array.isArray(paymentSettingsResult.data)
        ? paymentSettingsResult.data
        : [];

    adminDashboardState.fulfillments =
    Array.isArray(fulfillmentsResult.data)
        ? fulfillmentsResult.data
        : [];

    adminDashboardState.activityLogs =
    Array.isArray(activityLogsResult.data)
        ? activityLogsResult.data
        : [];

    adminDashboardState.customers =
        buildAdminCustomerRecords(
            adminDashboardState.orders,
            adminDashboardState.assignments
        );

    renderAdminDashboardStats();

    renderAdminCustomerTable();

    initAdminCustomerControls();

    renderAdminPaymentTable();

    initAdminPaymentControls();

    renderAdminPaymentSettings();

    renderAdminProxyInventoryTable();

    initAdminProxyInventoryControls();

    renderAdminActivityLog();

}

/**
 * Render admin activity log.
 */
function renderAdminActivityLog() {
    const tableBody =
        adminElement("activity-table-body");

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = "";

    const logs =
        Array.isArray(adminDashboardState.activityLogs)
            ? adminDashboardState.activityLogs
            : [];

    if (!logs.length) {
        const row = document.createElement("tr");

        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.textContent = "No activity recorded yet.";

        row.appendChild(cell);
        tableBody.appendChild(row);

        return;
    }

    logs.forEach((log) => {
        const row = document.createElement("tr");

        const timeCell = document.createElement("td");
        const adminCell = document.createElement("td");
        const actionCell = document.createElement("td");
        const entityCell = document.createElement("td");
        const detailsCell = document.createElement("td");

        timeCell.textContent =
            log.created_at
                ? new Date(log.created_at).toLocaleString()
                : "—";

        adminCell.textContent =
            log.admin_user_id || "—";

        actionCell.textContent =
            log.action || "—";

        entityCell.textContent =
            [
                log.entity_type,
                log.entity_id
            ]
                .filter(Boolean)
                .join(": ") || "—";

        if (log.details) {
            try {
                detailsCell.textContent =
                    typeof log.details === "string"
                        ? log.details
                        : JSON.stringify(log.details);
            } catch (error) {
                detailsCell.textContent = "—";
            }
        } else {
            detailsCell.textContent = "—";
        }

        row.appendChild(timeCell);
        row.appendChild(adminCell);
        row.appendChild(actionCell);
        row.appendChild(entityCell);
        row.appendChild(detailsCell);

        tableBody.appendChild(row);
    });
}


/* =========================================================
   PROXY INVENTORY — SPRINT 18.2.4
   ========================================================= */

/**
 * Initialize Proxy Inventory search/filter controls.
 */
function initAdminProxyInventoryControls() {
    const filter =
        adminElement("proxy-inventory-filter");

    const search =
        adminElement("proxy-inventory-search");

    if (
        filter &&
        !filter.dataset.initialized
    ) {
        filter.addEventListener(
            "change",
            () => {
                adminDashboardState.inventoryFilter =
                    filter.value || "ALL";

                renderAdminProxyInventoryTable();
            }
        );

        filter.dataset.initialized =
            "true";
    }

    if (
        search &&
        !search.dataset.initialized
    ) {
        search.addEventListener(
            "input",
            () => {
                adminDashboardState.inventorySearch =
                    search.value.trim();

                renderAdminProxyInventoryTable();
            }
        );

        search.dataset.initialized =
            "true";
    }
}


/**
 * Return inventory records matching the
 * current filter and search state.
 */
function getFilteredAdminProxyInventory() {
    const filter =
        adminDashboardState.inventoryFilter ||
        "ALL";

    const search =
        (
            adminDashboardState.inventorySearch ||
            ""
        ).toLowerCase();

    return adminDashboardState.inventory.filter(
        (proxy) => {
            if (
                filter !== "ALL" &&
                proxy.status !== filter
            ) {
                return false;
            }

            if (!search) {
                return true;
            }

            const proxyName =
                String(
                    proxy.proxy_name || ""
                ).toLowerCase();

            const proxyNumber =
                String(
                    proxy.proxy_number || ""
                ).toLowerCase();

            return (
                proxyName.includes(search) ||
                proxyNumber.includes(search)
            );
        }
    );
}

/**
 * Open Payment Settings modal.
 */
function openAdminPaymentSettingsModal() {
    const modal =
        adminElement("payment-settings-modal");

    const methodInput =
        adminElement(
            "payment-settings-method-input"
        );

    const networkInput =
        adminElement(
            "payment-settings-network-input"
        );

    const walletInput =
        adminElement(
            "payment-settings-wallet-input"
        );

    const enabledInput =
        adminElement(
            "payment-settings-enabled-input"
        );

    const message =
        adminElement(
            "payment-settings-form-message"
        );

    if (
        !modal ||
        !methodInput ||
        !networkInput ||
        !walletInput ||
        !enabledInput
    ) {
        return;
    }

    const settings =
        Array.isArray(
            adminDashboardState.paymentSettings
        )
            ? adminDashboardState.paymentSettings
            : [];

    if (!settings.length) {
        if (message) {
            message.textContent =
                "No payment settings found.";
        }

        return;
    }

    const setting =
        settings[0];

    methodInput.value =
        setting.payment_method || "";

    networkInput.value =
        setting.network || "";

    walletInput.value =
        setting.wallet_address || "";

    enabledInput.value =
        setting.enabled
            ? "true"
            : "false";

    if (message) {
        message.textContent = "";
    }

    modal.classList.remove("is-hidden");
    modal.setAttribute(
        "aria-hidden",
        "false"
    );

    window.setTimeout(
        () => {
            walletInput.focus();
        },
        0
    );
}


/**
 * Close Payment Settings modal.
 */
function closeAdminPaymentSettingsModal() {
    const modal =
        adminElement(
            "payment-settings-modal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add("is-hidden");
    modal.setAttribute(
        "aria-hidden",
        "true"
    );

    const message =
        adminElement(
            "payment-settings-form-message"
        );

    if (message) {
        message.textContent = "";
    }
}

function renderAdminPaymentSettings() {
    const method =
        adminElement(
            "payment-settings-method"
        );

    const network =
        adminElement(
            "payment-settings-network"
        );

    const wallet =
        adminElement(
            "payment-settings-wallet"
        );

    const status =
        adminElement(
            "payment-settings-status"
        );

    const updated =
        adminElement(
            "payment-settings-updated"
        );

    const message =
        adminElement(
            "payment-settings-message"
        );

    if (
        !method ||
        !network ||
        !wallet ||
        !status ||
        !updated
    ) {
        return;
    }

    const settings =
        Array.isArray(
            adminDashboardState.paymentSettings
        )
            ? adminDashboardState.paymentSettings
            : [];

    if (!settings.length) {
        method.textContent = "—";
        network.textContent = "—";
        wallet.textContent = "—";
        status.textContent = "—";
        updated.textContent = "—";

        if (message) {
            message.textContent =
                "No payment settings found.";
        }

        return;
    }

    const setting =
        settings[0];

    method.textContent =
        setting.payment_method || "—";

    network.textContent =
        setting.network || "—";

    wallet.textContent =
        setting.wallet_address || "—";

    status.textContent =
        setting.enabled
            ? "Enabled"
            : "Disabled";

    updated.textContent =
        formatAdminDate(
            setting.updated_at
        );

    if (message) {
        message.textContent = "";
    }
}

/**
 * Initialize Payment Settings controls.
 */
function initAdminPaymentSettingsControls() {
    const form =
        adminElement(
            "payment-settings-form"
        );

    if (
        form &&
        !form.dataset.initialized
    ) {

        form.addEventListener(
            "submit",
            handleAdminPaymentSettingsSubmit
        );

        form.dataset.initialized =
            "true";
    }

    const editButton =
        adminElement(
            "admin-edit-payment-settings"
        );

    if (
        editButton &&
        !editButton.dataset.initialized
    ) {
        editButton.addEventListener(
            "click",
            openAdminPaymentSettingsModal
        );

        editButton.dataset.initialized =
            "true";
    }

    const cancelButton =
        adminElement(
            "payment-settings-cancel"
        );

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminPaymentSettingsModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}

/**
 * Submit Payment Settings update.
 */
async function handleAdminPaymentSettingsSubmit(
    event
) {
    event.preventDefault();

    const form =
        adminElement(
            "payment-settings-form"
        );

    const walletInput =
        adminElement(
            "payment-settings-wallet-input"
        );

    const enabledInput =
        adminElement(
            "payment-settings-enabled-input"
        );

    const message =
        adminElement(
            "payment-settings-form-message"
        );

    const submitButton =
        adminElement(
            "payment-settings-save"
        );

    if (
        !form ||
        !walletInput ||
        !enabledInput
    ) {
        return;
    }

    const walletAddress =
        walletInput.value.trim();

    const enabled =
        enabledInput.value === "true";

    if (!walletAddress) {
        if (message) {
            message.textContent =
                "Wallet address is required.";
        }

        walletInput.focus();
        return;
    }

    if (
        walletAddress.length < 20 ||
        walletAddress.length > 128
    ) {
        if (message) {
            message.textContent =
                "Invalid wallet address length.";
        }

        walletInput.focus();
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            "Saving...";
    }

    if (message) {
        message.textContent =
            "Saving payment settings...";
    }

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            data,
            error
        } = await supabase.rpc(
            "update_payment_settings",
            {
                p_wallet_address:
                    walletAddress,

                p_enabled:
                    enabled
            }
        );

        if (error) {
            throw error;
        }

        const updatedSettings =
            Array.isArray(data)
                ? data
                : [];

        if (!updatedSettings.length) {
            throw new Error(
                "Payment settings update returned no data."
            );
        }

        showAdminToast(
            "Payment settings updated successfully.",
            "success"
        );

        closeAdminPaymentSettingsModal();

        await loadAdminDashboardData();
    } catch (error) {
        console.error(
            "Failed to update payment settings:",
            error
        );

        if (message) {
            message.textContent =
                error.message ||
                "Failed to update payment settings.";
        }
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent =
                "Save Changes";
        }
    }
}

/**
 * Render Proxy Inventory table.
 */
function renderAdminProxyInventoryTable() {
    const tableBody =
        adminElement(
            "proxy-inventory-table-body"
        );

    const message =
        adminElement(
            "proxy-inventory-table-message"
        );

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = "";

    const inventory =
        getFilteredAdminProxyInventory();

    if (!inventory.length) {
        const row =
            document.createElement("tr");

        const cell =
            document.createElement("td");

        cell.colSpan = 6;

        cell.className =
            "admin-table-empty";

        cell.textContent =
            "No proxy inventory records found.";

        row.appendChild(cell);
        tableBody.appendChild(row);

        if (message) {
            message.textContent = "";
        }

        return;
    }

    inventory.forEach(
        (proxy) => {
            const row =
                document.createElement("tr");

            row.appendChild(
                createAdminInventoryTextCell(
                    proxy.proxy_name
                )
            );

            row.appendChild(
                createAdminInventoryTextCell(
                    proxy.proxy_number
                )
            );

            row.appendChild(
                createAdminInventoryStatusCell(
                    proxy.status
                )
            );

            row.appendChild(
                createAdminInventoryTextCell(
                    formatAdminDate(
                        proxy.created_at
                    )
                )
            );

            row.appendChild(
                createAdminInventoryTextCell(
                    formatAdminDate(
                        proxy.updated_at
                    )
                )
            );

            const actionCell =
                document.createElement("td");

            const actionGroup =
                document.createElement("div");

            actionGroup.className =
                "admin-action-group";

            const editButton =
                document.createElement("button");

            editButton.type = "button";
            editButton.className =
                "admin-btn admin-btn-secondary admin-btn-small";

            editButton.textContent =
                "Edit";

            editButton.addEventListener(
                "click",
                () => {
                    openAdminEditProxyModal(proxy);
                }
            );

            actionGroup.appendChild(
                editButton
            );

            if (proxy.status === "AVAILABLE") {
                const disableButton =
                    document.createElement("button");

                disableButton.type = "button";
                disableButton.className =
                    "admin-btn admin-btn-secondary admin-btn-small";

                disableButton.textContent =
                    "Disable";

                disableButton.addEventListener(
                    "click",
                    () => {
                        handleAdminProxyStatusChange(
                            proxy,
                            "DISABLED"
                        );
                    }
                );

                actionGroup.appendChild(
                    disableButton
                );
            }

            if (proxy.status === "DISABLED") {
                const enableButton =
                    document.createElement("button");

                enableButton.type = "button";
                enableButton.className =
                    "admin-btn admin-btn-secondary admin-btn-small";

                enableButton.textContent =
                    "Enable";

                enableButton.addEventListener(
                    "click",
                    () => {
                        handleAdminProxyStatusChange(
                            proxy,
                            "AVAILABLE"
                        );
                    }
                );

                actionGroup.appendChild(
                    enableButton
                );
            }

            actionCell.appendChild(
                actionGroup
            );

            row.appendChild(
                actionCell
            );

            tableBody.appendChild(row);
        }
    );

    if (message) {
        message.textContent =
            `${inventory.length} proxy record${
                inventory.length === 1
                    ? ""
                    : "s"
            }`;
    }
}

/**
 * Proxy Inventory edit modal state.
 */
const adminEditProxyState = {
    proxyId: null,
    submitting: false
};


/**
 * Open Edit Proxy modal.
 */
function openAdminEditProxyModal(proxy) {
    const modal =
        adminElement("edit-proxy-modal");

    const nameInput =
        adminElement("edit-proxy-name");

    const numberInput =
        adminElement("edit-proxy-number");

    const message =
        adminElement("edit-proxy-message");

    if (
        !modal ||
        !nameInput ||
        !numberInput
    ) {
        return;
    }

    adminEditProxyState.proxyId =
        proxy.id;

    adminEditProxyState.submitting =
        false;

    nameInput.value =
        proxy.proxy_name || "";

    numberInput.value =
        proxy.proxy_number || "";

    if (message) {
        message.textContent = "";
    }

    modal.classList.remove("is-hidden");

    window.setTimeout(
        () => {
            nameInput.focus();
        },
        0
    );
}


/**
 * Close Edit Proxy modal.
 */
function closeAdminEditProxyModal() {
    const modal =
        adminElement("edit-proxy-modal");

    if (!modal) {
        return;
    }

    modal.classList.add("is-hidden");

    adminEditProxyState.proxyId =
        null;

    adminEditProxyState.submitting =
        false;
}


/**
 * Initialize Edit Proxy modal controls.
 */
function initAdminEditProxyControls() {
    const closeButton =
        adminElement("edit-proxy-close");

    const cancelButton =
        adminElement("edit-proxy-cancel");

    if (
        closeButton &&
        !closeButton.dataset.initialized
    ) {
        closeButton.addEventListener(
            "click",
            closeAdminEditProxyModal
        );

        closeButton.dataset.initialized =
            "true";
    }

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminEditProxyModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}


/**
 * Initialize Edit Proxy form.
 */
function initAdminEditProxyForm() {
    const form =
        adminElement("edit-proxy-form");

    if (
        !form ||
        form.dataset.initialized
    ) {
        return;
    }

    form.addEventListener(
        "submit",
        handleAdminEditProxySubmit
    );

    form.dataset.initialized =
        "true";
}


/**
 * Submit Proxy Inventory edit.
 */
async function handleAdminEditProxySubmit(
    event
) {
    event.preventDefault();

    if (
        adminEditProxyState.submitting
    ) {
        return;
    }

    const nameInput =
        adminElement("edit-proxy-name");

    const numberInput =
        adminElement("edit-proxy-number");

    const message =
        adminElement("edit-proxy-message");

    const submitButton =
        adminElement("edit-proxy-submit");

    if (
        !nameInput ||
        !numberInput ||
        !adminEditProxyState.proxyId
    ) {
        return;
    }

    const proxyName =
        nameInput.value.trim();

    const proxyNumber =
        numberInput.value.trim();

    if (!proxyName) {
        if (message) {
            message.textContent =
                "Proxy name is required.";
        }

        nameInput.focus();
        return;
    }

    if (!proxyNumber) {
        if (message) {
            message.textContent =
                "Proxy number is required.";
        }

        numberInput.focus();
        return;
    }

    if (proxyName.length > 120) {
        if (message) {
            message.textContent =
                "Proxy name must be 120 characters or less.";
        }

        nameInput.focus();
        return;
    }

    if (proxyNumber.length > 120) {
        if (message) {
            message.textContent =
                "Proxy number must be 120 characters or less.";
        }

        numberInput.focus();
        return;
    }

    adminEditProxyState.submitting =
        true;

    if (message) {
        message.textContent =
            "Saving proxy...";
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            "Saving...";
    }

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            error
        } = await supabase
            .from("proxy_inventory")
            .update({
                proxy_name: proxyName,
                proxy_number: proxyNumber
            })
            .eq(
                "id",
                adminEditProxyState.proxyId
            );

        if (error) {
            if (error.code === "23505") {
                throw new Error(
                    "Proxy name or proxy number already exists."
                );
            }

            if (error.code === "42501") {
                throw new Error(
                    "You do not have permission to update proxy inventory."
                );
            }

            throw error;
        }

        showAdminToast(
            "Proxy updated successfully.",
            "success"
        );

        closeAdminEditProxyModal();

        await loadAdminDashboardData();
    } catch (error) {
        console.error(
            "Failed to update proxy inventory:",
            error
        );

        if (message) {
            message.textContent =
                error.message ||
                "Failed to update proxy.";
        }
    } finally {
        adminEditProxyState.submitting =
            false;

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent =
                "Save Changes";
        }
    }
}


/**
 * Change Proxy Inventory status.
 */
async function handleAdminProxyStatusChange(
    proxy,
    nextStatus
) {
    if (!proxy || !proxy.id) {
        return;
    }

    if (
        nextStatus !== "AVAILABLE" &&
        nextStatus !== "DISABLED"
    ) {
        return;
    }

    const currentStatus =
        proxy.status;

    if (
        currentStatus === "ASSIGNED"
    ) {
        setAdminMessage(
            "Assigned proxies cannot be manually changed from inventory.",
            "error"
        );

        return;
    }

    if (
        currentStatus === nextStatus
    ) {
        return;
    }

    const actionLabel =
        nextStatus === "DISABLED"
            ? "disable"
            : "enable";

    const confirmed =
        window.confirm(
            `Are you sure you want to ${actionLabel} "${proxy.proxy_name}"?`
        );

    if (!confirmed) {
        return;
    }

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            error
        } = await supabase
            .from("proxy_inventory")
            .update({
                status: nextStatus
            })
            .eq(
                "id",
                proxy.id
            );

        if (error) {
            if (error.code === "42501") {
                throw new Error(
                    "You do not have permission to update proxy inventory."
                );
            }

            throw error;
        }

        setAdminMessage(
            `Proxy ${actionLabel}d successfully.`,
            "success"
        );

        await loadAdminDashboardData();
    } catch (error) {
        console.error(
            "Failed to change proxy status:",
            error
        );

        setAdminMessage(
            error.message ||
                "Failed to update proxy status.",
            "error"
        );
    }
}


/**
 * Create a standard inventory text cell.
 */
function createAdminInventoryTextCell(
    value
) {
    const cell =
        document.createElement("td");

    cell.textContent =
        value || "—";

    return cell;
}


/**
 * Create an inventory status cell.
 */
function createAdminInventoryStatusCell(
    status
) {
    const cell =
        document.createElement("td");

    const statusText =
        document.createElement("span");

    statusText.className =
        "admin-status";

    statusText.textContent =
        formatAdminInventoryStatus(
            status
        );

    cell.appendChild(
        statusText
    );

    return cell;
}


/**
 * Format Proxy Inventory status.
 */
function formatAdminInventoryStatus(
    status
) {
    const labels = {
        AVAILABLE: "Available",
        ASSIGNED: "Assigned",
        DISABLED: "Disabled"
    };

    return (
        labels[status] ||
        status ||
        "Unknown"
    );
}

/**
 * Build customer-facing records from orders
 * and proxy assignments.
 *
 * One customer row represents one order.
 */
function buildAdminCustomerRecords(
    orders,
    assignments
) {
    return orders.map(
        (order) => {
            const orderAssignments =
                assignments.filter(
                    (assignment) =>
                        assignment.order_id ===
                        order.order_id
                );

            /*
             * The latest assignment is the active
             * operational record when one exists.
             */
            const activeAssignment =
                orderAssignments.find(
                    (assignment) =>
                        assignment.status === "ACTIVE"
                ) ||
                orderAssignments[0] ||
                null;

            return {
                order,
                assignments: orderAssignments,
                assignment: activeAssignment,
                state: getAdminCustomerState(
                    order,
                    activeAssignment
                )
            };
        }
    );
}


/**
 * Determine the display/filter state of a customer.
 *
 * State priority:
 *
 * REPLACED
 * EXPIRED
 * EXPIRING_SOON
 * TRIAL
 * ASSIGNED
 * ACTIVE
 */
function getAdminCustomerState(
    order,
    assignment
) {
    if (!assignment) {
        return "UNASSIGNED";
    }

    if (assignment.status === "REPLACED") {
        return "REPLACED";
    }

    if (assignment.status === "EXPIRED") {
        return "EXPIRED";
    }

    if (assignment.status === "ACTIVE") {

        if (
            assignment.assignment_type ===
            "TRIAL"
        ) {
            return "TRIAL";
        }

        if (
            isAdminAssignmentExpiringSoon(
                assignment.expires_at
            )
        ) {
            return "EXPIRING_SOON";
        }

        if (
            assignment.assignment_type ===
            "ASSIGNED"
        ) {
            return "ASSIGNED";
        }

        return "ACTIVE";
    }

    return "ACTIVE";
}


/**
 * Return true when an active assignment
 * expires within the next 24 hours.
 */
function isAdminAssignmentExpiringSoon(
    expiresAt
) {
    if (!expiresAt) {
        return false;
    }

    const expiry =
        new Date(expiresAt).getTime();

    const now =
        Date.now();

    const twentyFourHours =
        24 * 60 * 60 * 1000;

    return (
        expiry > now &&
        expiry - now <= twentyFourHours
    );
}


/**
 * Calculate dashboard statistics.
 */
function calculateAdminDashboardStats() {
    const customers =
        adminDashboardState.customers;

    const assignments =
        adminDashboardState.assignments;

    return {
        active:
            customers.filter(
                (customer) =>
                    customer.state === "ACTIVE"
            ).length,

        expiringSoon:
            customers.filter(
                (customer) =>
                    customer.state ===
                    "EXPIRING_SOON"
            ).length,

        trials:
            assignments.filter(
                (assignment) =>
                    assignment.status === "ACTIVE" &&
                    assignment.assignment_type ===
                        "TRIAL"
            ).length,

        assigned:
            assignments.filter(
                (assignment) =>
                    assignment.status === "ACTIVE" &&
                    assignment.assignment_type ===
                        "ASSIGNED"
            ).length,

        expired:
            assignments.filter(
                (assignment) =>
                    assignment.status === "EXPIRED"
            ).length,

        replaced:
            assignments.filter(
                (assignment) =>
                    assignment.status === "REPLACED"
            ).length,

        pendingPayments:
            adminDashboardState.orders.filter(
                (order) =>
                    order.payment_status ===
                    "PAYMENT_SUBMITTED"
            ).length
    };
}


/**
 * Render dashboard statistics.
 */
function renderAdminDashboardStats() {
    const stats =
        calculateAdminDashboardStats();

    setAdminStatValue(
        "stat-active",
        stats.active
    );

    setAdminStatValue(
        "stat-expiring-soon",
        stats.expiringSoon
    );

    setAdminStatValue(
        "stat-trials",
        stats.trials
    );

    setAdminStatValue(
        "stat-expired",
        stats.expired
    );

    setAdminStatValue(
        "stat-replaced",
        stats.replaced
    );

    setAdminStatValue(
        "stat-pending-payments",
        stats.pendingPayments
    );
}


/**
 * Safely update a dashboard statistic.
 */
function setAdminStatValue(
    elementId,
    value
) {
    const element =
        adminElement(elementId);

    if (!element) {
        return;
    }

    element.textContent =
        String(
            Number.isFinite(value)
                ? value
                : 0
        );
}


/**
 * Initialize customer search/filter controls.
 */
function initAdminCustomerControls() {
    const filter =
        adminElement("customer-filter");

    const search =
        adminElement("customer-search");

    if (
        filter &&
        !filter.dataset.initialized
    ) {
        filter.addEventListener(
            "change",
            () => {
                adminDashboardState.customerFilter =
                    filter.value || "ALL";

                renderAdminCustomerTable();
            }
        );

        filter.dataset.initialized =
            "true";
    }

    if (
        search &&
        !search.dataset.initialized
    ) {
        search.addEventListener(
            "input",
            () => {
                adminDashboardState.customerSearch =
                    search.value.trim();

                renderAdminCustomerTable();
            }
        );

        search.dataset.initialized =
            "true";
    }
}


/**
 * Return filtered customer records.
 */
function getFilteredAdminCustomers() {
    const filter =
        adminDashboardState.customerFilter;

    const search =
        adminDashboardState.customerSearch
            .toLowerCase();

    return adminDashboardState.customers.filter(
        (customer) => {

            /*
             * Filter.
             */
            if (
                filter !== "ALL" &&
                customer.state !== filter
            ) {
                return false;
            }

            /*
             * Search.
             */
            if (!search) {
                return true;
            }

            const order =
                customer.order;

            const assignment =
                customer.assignment;

            const searchableText = [
                order.order_id,
                order.full_name,
                order.email,
                order.telegram,
                order.plan_name,
                assignment
                    ? assignment.proxy_nickname
                    : "",
                assignment
                    ? assignment.proxy_number
                    : "",
                assignment
                    ? assignment.host
                    : "",
                assignment
                    ? assignment.port
                    : ""
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return searchableText.includes(
                search
            );
        }
    );
}


/**
 * Render customer table.
 */
function renderAdminCustomerTable() {
    const tableBody =
        adminElement(
            "customer-table-body"
        );

    if (!tableBody) {
        return;
    }

    const customers =
        getFilteredAdminCustomers();

    tableBody.innerHTML = "";

    if (!customers.length) {
        setCustomerTableMessage(
            adminDashboardState.customers.length
                ? "No customers match the current filter."
                : "No customer records found."
        );

        return;
    }

    setCustomerTableMessage("");

    const fragment =
        document.createDocumentFragment();

    customers.forEach(
        (customer) => {
            fragment.appendChild(
                createAdminCustomerRow(
                    customer
                )
            );
        }
    );

    tableBody.appendChild(
        fragment
    );
}


/**
 * Create one customer table row.
 */
function createAdminCustomerRow(
    customer
) {
    const row =
        document.createElement("tr");

    const order =
        customer.order;

    const assignment =
        customer.assignment;

    const state =
        customer.state;

    const cells = [
        createAdminTableCell(
            formatAdminCustomer(
                order.full_name
            )
        ),

        createAdminTableCell(
            formatAdminContact(
                order.email,
                order.telegram
            )
        ),

        createAdminTableCell(
            formatAdminOrder(
                order.order_id,
                order.plan_name
            )
        ),

        createAdminTableCell(
            assignment
                ? formatAdminProxy(
                    assignment
                )
                : "—"
        ),

        createAdminTableCell(
            formatAdminAssignmentType(
                assignment
            )
        ),

        createAdminTableCell(
            assignment
                ? formatAdminDate(
                    assignment.start_at
                )
                : "—"
        ),

        createAdminTableCell(
            assignment
                ? formatAdminDate(
                    assignment.expires_at
                )
                : "—"
        ),

        createAdminTableCell(
            formatAdminStatus(
                state
            )
        ),

        createAdminActionCell(
            customer
        )
    ];

    cells.forEach(
        (cell) => {
            row.appendChild(cell);
        }
    );

    return row;
}


/**
 * Create safe table cell.
 */
function createAdminTableCell(
    text
) {
    const cell =
        document.createElement("td");

    cell.textContent =
        text || "—";

    return cell;
}


/**
 * Create customer action cell.
 *
 * Detailed customer actions will be wired
 * in the next operational stage.
 */

/**
 * Find fulfillment record for an order.
 */
function getAdminFulfillmentForOrder(
    orderId
) {
    return (
        adminDashboardState.fulfillments.find(
            (fulfillment) =>
                fulfillment.order_id === orderId
        ) || null
    );
}


/**
 * Determine whether fulfillment repair is
 * appropriate for an order.
 */
function canRepairAdminFulfillment(customer) {
    if (!customer?.order) return false;

    const order = customer.order;
    const assignment = customer.assignment;
    const fulfillment = getAdminFulfillmentForOrder(order.order_id);

    if (order.payment_status !== "PAYMENT_VERIFIED") return false;
    if (order.order_status !== "PROXY_ASSIGNED") return false;
    if (!assignment) return false;
    if (assignment.status !== "ACTIVE") return false;
    if (!fulfillment) return false;

    const inventory = adminDashboardState.inventory.find(
        (item) => item.proxy_number === assignment?.proxy_number
    );

    if (!inventory) return false;
    if (inventory.status !== "ASSIGNED") return false;

    if (fulfillment.status === "DELIVERED") return false;

    const synchronized =
        fulfillment.status === "ASSIGNED" &&
        fulfillment.proxy_assigned === true &&
        fulfillment.proxy_reference === assignment.proxy_number &&
        fulfillment.assigned_at === assignment.start_at;

    return !synchronized;
}

/**
 * Create customer action cell.
 */
function createAdminActionCell(
    customer
) {
    const cell =
        document.createElement("td");

    const viewButton =
        document.createElement("button");

    viewButton.type = "button";

    viewButton.className =
        "admin-btn admin-btn-secondary admin-btn-small";

    viewButton.textContent =
        "View";

    viewButton.dataset.orderId =
        customer.order.order_id;

    viewButton.addEventListener(
        "click",
        () => {
            openAdminCustomerDetailModal(
                customer
            );
        }
    );

    cell.appendChild(viewButton);

    /*
     * --------------------------------------------------
     * ASSIGN PROXY
     * --------------------------------------------------
     *
     * Only payment-verified orders without an active
     * assignment should expose the Assign action.
     */

    const canAssignProxy =
        customer.order.payment_status ===
            "PAYMENT_VERIFIED" &&
        !customer.assignment;

    if (canAssignProxy) {
        const assignButton =
            document.createElement("button");

        assignButton.type = "button";

        assignButton.className =
            "admin-btn admin-btn-primary admin-btn-small";

        assignButton.textContent =
            "Assign";

        assignButton.dataset.orderId =
            customer.order.order_id;

        assignButton.addEventListener(
            "click",
            () => {
                openAdminAssignProxyModal(
                    customer.order
                );
            }
        );

        cell.appendChild(assignButton);
    }

        /*
    * --------------------------------------------------
    * REPAIR FULFILLMENT
    * --------------------------------------------------
    *
    * Only expose repair when the fulfillment record
    * is inconsistent with the active assignment.
    */

    if (
        canRepairAdminFulfillment(
            customer
        )
    ) {
        const repairButton =
            document.createElement(
                "button"
            );

        repairButton.type =
            "button";

        repairButton.className =
            "admin-btn admin-btn-secondary admin-btn-small";

        repairButton.textContent =
            "Repair Fulfillment";

        repairButton.dataset.orderId =
            customer.order.order_id;

        repairButton.addEventListener(
            "click",
            () => {
                openAdminRepairFulfillmentModal(
                    customer.order
                );
            }
        );

        cell.appendChild(
            repairButton
        );
    }

    return cell;
}

/* =========================================================
   CUSTOMER DETAIL OPERATIONS
   ========================================================= */

/**
 * Open Customer Detail modal.
 */
function openAdminCustomerDetailModal(
    customer
) {
    const modal =
        adminElement(
            "customer-detail-modal"
        );

    const content =
        adminElement(
            "customer-detail-content"
        );

    if (!modal || !content || !customer) {
        return;
    }

    const order =
        customer.order || null;

    const assignment =
        customer.assignment || null;

    if (!order) {
        return;
    }

    content.innerHTML = "";

    const details = [
        [
            "Customer",
            formatAdminCustomer(
                order.full_name
            )
        ],
        [
            "Email",
            order.email || "—"
        ],
        [
            "Telegram",
            order.telegram || "—"
        ],
        [
            "Order ID",
            order.order_id || "—"
        ],
        [
            "Plan",
            order.plan_name || "—"
        ],
        [
            "Price",
            order.plan_price !== null &&
            order.plan_price !== undefined
                ? `$${order.plan_price}`
                : "—"
        ],
        [
            "Payment Status",
            order.payment_status || "—"
        ],
        [
            "Payment Method",
            order.payment_method || "—"
        ],
        [
            "Payment Reference",
            order.payment_reference || "—"
        ],
        [
            "Order Status",
            order.order_status || "—"
        ],
        [
            "Proxy",
            assignment
                ? formatAdminProxy(
                    assignment
                )
                : "Unassigned"
        ],
        [
            "Assignment Type",
            formatAdminAssignmentType(
                assignment
            )
        ],
        [
            "Proxy Status",
            assignment?.status || "—"
        ],
        [
            "Start",
            assignment
                ? formatAdminDate(
                    assignment.start_at
                )
                : "—"
        ],
        [
            "Expiry",
            assignment
                ? formatAdminDate(
                    assignment.expires_at
                )
                : "—"
        ],
        [
            "Duration",
            assignment
                ? `${assignment.duration_days} days`
                : "—"
        ],
        [
            "Extension Days",
            assignment
                ? String(
                    assignment.extension_days || 0
                )
                : "—"
        ]
    ];

    const grid =
        document.createElement("div");

    grid.className =
        "admin-detail-grid";

    details.forEach(
        ([label, value]) => {
            const item =
                document.createElement("div");

            item.className =
                "admin-detail-item";

            const labelElement =
                document.createElement("div");

            labelElement.className =
                "admin-detail-label";

            labelElement.textContent =
                label;

            const valueElement =
                document.createElement("div");

            valueElement.className =
                "admin-detail-value";

            valueElement.textContent =
                value;

            item.appendChild(
                labelElement
            );

            item.appendChild(
                valueElement
            );

            grid.appendChild(
                item
            );
        }
    );

    content.appendChild(grid);


        /*
     * --------------------------------------------------
     * ACTIVE ASSIGNMENT ACTIONS
     * --------------------------------------------------
     *
     * Active proxy assignments can be extended
     * or replaced.
     */
    if (
        assignment &&
        assignment.status === "ACTIVE"
    ) {
        const actions =
            document.createElement("div");

        actions.className =
            "admin-modal-actions";

        /*
         * EXTEND SUBSCRIPTION
         */
        const extendButton =
            document.createElement("button");

        extendButton.type =
            "button";

        extendButton.className =
            "admin-btn admin-btn-primary";

        extendButton.textContent =
            "Extend Subscription";

        extendButton.addEventListener(
            "click",
            () => {
                modal.classList.add(
                    "is-hidden"
                );

                openAdminExtensionModal(
                    assignment
                );
            }
        );

        actions.appendChild(
            extendButton
        );


        /*
         * REPLACE PROXY
         */
        const replaceButton =
            document.createElement("button");

        replaceButton.type =
            "button";

        replaceButton.className =
            "admin-btn admin-btn-secondary";

        replaceButton.textContent =
            "Replace Proxy";

        replaceButton.addEventListener(
            "click",
            () => {
                modal.classList.add(
                    "is-hidden"
                );

                openAdminReplacementModal(
                    assignment
                );
            }
        );

        actions.appendChild(
            replaceButton
        );


        content.appendChild(
            actions
        );
    }


    modal.classList.remove(
        "is-hidden"
    );
}

/* =========================================================
   EXTENSION OPERATIONS
   ========================================================= */

const adminExtensionState = {
    submitting: false
};


/**
 * Open Extension modal.
 */
function openAdminExtensionModal(
    assignment
) {
    const modal =
        adminElement(
            "extension-modal"
        );

    if (!modal || !assignment) {
        return;
    }

    const form =
        adminElement(
            "extension-form"
        );

    const assignmentIdInput =
        adminElement(
            "extension-assignment-id"
        );

    const currentExpiry =
        adminElement(
            "extension-current-expiry"
        );

    const message =
        adminElement(
            "extension-message"
        );

    if (form) {
        form.reset();
    }

    if (assignmentIdInput) {
        assignmentIdInput.value =
            assignment.id || "";
    }

    if (currentExpiry) {
        currentExpiry.textContent =
            `Current expiry: ${
                assignment.expires_at
                    ? formatAdminDate(
                        assignment.expires_at
                    )
                    : "—"
            }`;
    }

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }

    modal.classList.remove(
        "is-hidden"
    );
}


/**
 * Close Extension modal.
 */
function closeAdminExtensionModal() {
    const modal =
        adminElement(
            "extension-modal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add(
        "is-hidden"
    );

    const form =
        adminElement(
            "extension-form"
        );

    if (form) {
        form.reset();
    }

    const message =
        adminElement(
            "extension-message"
        );

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }
}


/**
 * Initialize Extension controls.
 */
function initAdminExtensionControls() {
    const form =
        adminElement(
            "extension-form"
        );

    if (
        form &&
        !form.dataset.initialized
    ) {
        form.addEventListener(
            "submit",
            handleAdminExtensionSubmit
        );

        form.dataset.initialized =
            "true";
    }

    const cancelButton =
        adminElement(
            "extension-cancel"
        );

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminExtensionModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}


/**
 * Submit Extension.
 */
async function handleAdminExtensionSubmit(
    event
) {
    event.preventDefault();

    if (
        adminExtensionState.submitting
    ) {
        return;
    }

    const assignmentId =
        adminElement(
            "extension-assignment-id"
        )?.value.trim() || "";

    const extensionDays =
        Number(
            adminElement(
                "extension-days"
            )?.value
        );

    const reason =
        adminElement(
            "extension-reason"
        )?.value.trim() || "";

    const message =
        adminElement(
            "extension-message"
        );

    const submitButton =
        adminElement(
            "extension-submit"
        );

    if (!assignmentId) {
        setAdminMessage(
            message,
            "Assignment ID is required.",
            "error"
        );

        return;
    }

    if (
        !Number.isInteger(
            extensionDays
        ) ||
        extensionDays <= 0 ||
        extensionDays > 365
    ) {
        setAdminMessage(
            message,
            "Extension days must be between 1 and 365.",
            "error"
        );

        return;
    }

    adminExtensionState.submitting =
        true;

    if (submitButton) {
        submitButton.disabled =
            true;

        submitButton.textContent =
            "Adding...";
    }

    setAdminMessage(
        message,
        "Adding extension..."
    );

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            data,
            error
        } = await supabase.rpc(
            "extend_proxy_assignment",
            {
                p_assignment_id:
                    assignmentId,
                p_extension_days:
                    extensionDays,
                p_reason:
                    reason || null
            }
        );

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                "Extension was not completed."
            );
        }

        showAdminToast(
            "Subscription extended successfully.",
            "success"
        );

        closeAdminExtensionModal();

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy admin extension error:",
            error
        );

        setAdminMessage(
            message,
            getFriendlyAdminOperationError(
                error,
                "Unable to extend subscription."
            ),
            "error"
        );

    } finally {
        adminExtensionState.submitting =
            false;

        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                "Add Extension";
        }
    }
}

/* =========================================================
   PROXY ASSIGNMENT OPERATIONS
   ========================================================= */

const adminAssignmentState = {
    submitting: false
};


/* =========================================================
   PROXY INVENTORY — ADD PROXY MODAL
   ========================================================= */

/**
 * Open Add Proxy modal.
 */
function openAdminAddProxyModal() {
    const modal =
        adminElement("add-proxy-modal");

    if (!modal) {
        return;
    }

    const form =
        adminElement("add-proxy-form");

    const message =
        adminElement("add-proxy-message");

    if (form) {
        form.reset();
    }

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }

    modal.classList.remove(
        "is-hidden"
    );

    const nameInput =
        adminElement("add-proxy-name");

    if (nameInput) {
        nameInput.focus();
    }
}


/**
 * Close Add Proxy modal.
 */
function closeAdminAddProxyModal() {
    const modal =
        adminElement("add-proxy-modal");

    if (!modal) {
        return;
    }

    modal.classList.add(
        "is-hidden"
    );

    const form =
        adminElement("add-proxy-form");

    if (form) {
        form.reset();
    }

    const message =
        adminElement("add-proxy-message");

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }
}


/**
 * Initialize Add Proxy modal controls.
 */
function initAdminAddProxyControls() {
    const addButton =
        adminElement("admin-add-proxy");

    const closeButton =
        adminElement("add-proxy-close");

    const cancelButton =
        adminElement("add-proxy-cancel");

    if (
        addButton &&
        !addButton.dataset.initialized
    ) {
        addButton.addEventListener(
            "click",
            openAdminAddProxyModal
        );

        addButton.dataset.initialized =
            "true";
    }

    if (
        closeButton &&
        !closeButton.dataset.initialized
    ) {
        closeButton.addEventListener(
            "click",
            closeAdminAddProxyModal
        );

        closeButton.dataset.initialized =
            "true";
    }

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminAddProxyModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}


/**
 * Add Proxy submission state.
 */
const adminAddProxyState = {
    submitting: false
};


/**
 * Submit a new Proxy Inventory record.
 */
async function handleAdminAddProxySubmit(
    event
) {
    event.preventDefault();

    if (
        adminAddProxyState.submitting
    ) {
        return;
    }

    const nameInput =
        adminElement("add-proxy-name");

    const numberInput =
        adminElement("add-proxy-number");

    const message =
        adminElement("add-proxy-message");

    const submitButton =
        adminElement("add-proxy-submit");

    if (
        !nameInput ||
        !numberInput
    ) {
        return;
    }

    const proxyName =
        nameInput.value.trim();

    const proxyNumber =
        numberInput.value.trim();

    /*
     * Client-side validation.
     */
    if (!proxyName) {
        setAdminMessage(
            message,
            "Proxy Name is required.",
            "error"
        );

        nameInput.focus();

        return;
    }

    if (!proxyNumber) {
        setAdminMessage(
            message,
            "Proxy Number is required.",
            "error"
        );

        numberInput.focus();

        return;
    }

    if (
        proxyName.length > 120
    ) {
        setAdminMessage(
            message,
            "Proxy Name must be 120 characters or fewer.",
            "error"
        );

        nameInput.focus();

        return;
    }

    if (
        proxyNumber.length > 120
    ) {
        setAdminMessage(
            message,
            "Proxy Number must be 120 characters or fewer.",
            "error"
        );

        numberInput.focus();

        return;
    }

    /*
     * Begin submission.
     */
    adminAddProxyState.submitting =
        true;

    if (submitButton) {
        submitButton.disabled =
            true;

        submitButton.textContent =
            "Adding...";
    }

    setAdminMessage(
        message,
        "Adding proxy..."
    );

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            error
        } = await supabase
            .from("proxy_inventory")
            .insert({
                proxy_name:
                    proxyName,

                proxy_number:
                    proxyNumber
            });

        if (error) {
            console.error(
                "NexProxy add proxy error:",
                error
            );

            if (
                error.code === "23505"
            ) {
                setAdminMessage(
                    message,
                    "A proxy with this name or number already exists.",
                    "error"
                );

                return;
            }

            if (
                error.code === "42501"
            ) {
                setAdminMessage(
                    message,
                    "You are not authorized to add proxy inventory.",
                    "error"
                );

                return;
            }

            setAdminMessage(
                message,
                "Unable to add proxy. Please try again.",
                "error"
            );

            return;
        }

        showAdminToast(
            "Proxy added successfully.",
            "success"
        );

        closeAdminAddProxyModal();

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy add proxy error:",
            error
        );

        setAdminMessage(
            message,
            "Unable to add proxy. Please try again.",
            "error"
        );

    } finally {
        adminAddProxyState.submitting =
            false;

        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                "Add Proxy";
        }
    }
}

/**
 * Initialize Add Proxy form.
 */
function initAdminAddProxyForm() {
    const form =
        adminElement("add-proxy-form");

    if (
        form &&
        !form.dataset.initialized
    ) {
        form.addEventListener(
            "submit",
            handleAdminAddProxySubmit
        );

        form.dataset.initialized =
            "true";
    }
}

/**
 * Open Assign Proxy modal.
 */
function openAdminAssignProxyModal(order) {
    const modal =
        adminElement("assign-proxy-modal");

    if (!modal || !order) {
        return;
    }

    const form =
        adminElement("assign-proxy-form");

    const orderIdInput =
        adminElement("assign-proxy-order-id");

    const message =
        adminElement("assign-proxy-message");

    if (form) {
        form.reset();
    }

    if (orderIdInput) {
        orderIdInput.value =
            order.order_id || "";
    }

    if (message) {
        setAdminMessage(message, "");
    }

    modal.classList.remove("is-hidden");
}


/**
 * Close Assign Proxy modal.
 */
function closeAdminAssignProxyModal() {
    const modal =
        adminElement("assign-proxy-modal");

    if (!modal) {
        return;
    }

    modal.classList.add("is-hidden");

    const form =
        adminElement("assign-proxy-form");

    if (form) {
        form.reset();
    }

    const message =
        adminElement("assign-proxy-message");

    if (message) {
        setAdminMessage(message, "");
    }
}


/**
 * Initialize Proxy Assignment controls.
 */
function initAdminAssignmentControls() {
    const form =
        adminElement("assign-proxy-form");

    if (
        form &&
        !form.dataset.initialized
    ) {
        form.addEventListener(
            "submit",
            handleAdminAssignProxySubmit
        );

        form.dataset.initialized = "true";
    }

    const cancelButton =
        adminElement("assign-proxy-cancel");

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminAssignProxyModal
        );

        cancelButton.dataset.initialized = "true";
    }
}


/**
 * Submit Proxy Assignment.
 */
async function handleAdminAssignProxySubmit(event) {
    event.preventDefault();

    if (adminAssignmentState.submitting) {
        return;
    }

    const orderId =
        adminElement(
            "assign-proxy-order-id"
        )?.value.trim() || "";

    const nickname =
        adminElement(
            "assign-proxy-nickname"
        )?.value.trim() || "";

    const proxyNumber =
        adminElement(
            "assign-proxy-number"
        )?.value.trim() || "";

    const host =
        adminElement(
            "assign-proxy-host"
        )?.value.trim() || "";

    const port =
        adminElement(
            "assign-proxy-port"
        )?.value.trim() || "";

    const assignmentType =
        adminElement(
            "assign-proxy-type"
        )?.value || "ASSIGNED";

    const durationDays =
        Number(
            adminElement(
                "assign-proxy-duration"
            )?.value
        );

    const message =
        adminElement(
            "assign-proxy-message"
        );

    const submitButton =
        adminElement(
            "assign-proxy-submit"
        );


    /* --------------------------------------------------
       VALIDATION
       -------------------------------------------------- */

    if (!orderId) {
        setAdminMessage(
            message,
            "Order ID is required.",
            "error"
        );

        return;
    }

    if (!nickname) {
        setAdminMessage(
            message,
            "Proxy nickname is required.",
            "error"
        );

        return;
    }

    if (!proxyNumber) {
        setAdminMessage(
            message,
            "Proxy number is required.",
            "error"
        );

        return;
    }

    if (
        !["ASSIGNED", "TRIAL"].includes(
            assignmentType
        )
    ) {
        setAdminMessage(
            message,
            "Invalid assignment type.",
            "error"
        );

        return;
    }

    if (
        !Number.isInteger(durationDays) ||
        durationDays <= 0
    ) {
        setAdminMessage(
            message,
            "Duration must be greater than zero.",
            "error"
        );

        return;
    }


    /* --------------------------------------------------
       RPC
       -------------------------------------------------- */

    adminAssignmentState.submitting = true;

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Assigning...";
    }

    setAdminMessage(
        message,
        "Creating proxy assignment..."
    );

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            data,
            error
        } = await supabase.rpc(
            "create_proxy_assignment",
            {
                p_order_id: orderId,
                p_proxy_nickname: nickname,
                p_proxy_number: proxyNumber,
                p_host: host || null,
                p_port: port || null,
                p_assignment_type: assignmentType,
                p_duration_days: durationDays
            }
        );

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                "Proxy assignment was not created."
            );
        }

        closeAdminAssignProxyModal();

        showAdminToast(
            "Proxy assigned successfully.",
            "success"
        );

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy proxy assignment error:",
            error
        );

        setAdminMessage(
            message,
            getFriendlyAdminOperationError(
                error,
                "Unable to assign proxy."
            ),
            "error"
        );

        showAdminToast(
            "Unable to assign proxy.",
            "error"
        );

    } finally {
        adminAssignmentState.submitting = false;

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Assign Proxy";
        }
    }
}


/**
 * Convert admin operation errors into safe UI messages.
 */
function getFriendlyAdminOperationError(
    error,
    fallback
) {
    const message =
        error?.message || "";

    if (
        message.includes(
            "Admin access required"
        )
    ) {
        return "You do not have permission to perform this action.";
    }

    if (
        message.includes(
            "Payment must be verified"
        )
    ) {
        return "Payment must be verified before assigning a proxy.";
    }

    if (
        message.includes(
            "already has an active proxy"
        )
    ) {
        return "This order already has an active proxy assignment.";
    }

    if (
        message.includes(
            "Order not found"
        )
    ) {
        return "The selected order could not be found.";
    }

    if (
        message.includes(
            "Delivered fulfillment cannot be repaired"
        )
    ) {
        return "A delivered fulfillment cannot be repaired.";
    }

    if (
        message.includes(
            "Active proxy assignment not found"
        )
    ) {
        return "This order does not have an active proxy assignment.";
    }

    if (
        message.includes(
            "Active assignment proxy is missing from inventory"
        )
    ) {
        return "The active proxy is missing from inventory.";
    }

    if (
        message.includes(
            "Active assignment proxy inventory is not ASSIGNED"
        )
    ) {
        return "The active proxy inventory state is inconsistent.";
    }

    if (
        message.includes(
            "Fulfillment is already synchronized"
        )
    ) {
        return "This fulfillment is already synchronized.";
    }

    return message || fallback;
}

/**
 * Format customer name.
 */
function formatAdminCustomer(
    value
) {
    return value || "Unknown";
}


/**
 * Format contact information.
 */
function formatAdminContact(
    email,
    telegram
) {
    const parts = [];

    if (email) {
        parts.push(email);
    }

    if (telegram) {
        parts.push(telegram);
    }

    return parts.length
        ? parts.join(" · ")
        : "—";
}


/**
 * Format order information.
 */
function formatAdminOrder(
    orderId,
    planName
) {
    if (!orderId) {
        return planName || "—";
    }

    return planName
        ? `${orderId} · ${planName}`
        : orderId;
}


/**
 * Format proxy information.
 */
function formatAdminProxy(
    assignment
) {
    const parts = [];

    if (assignment.proxy_nickname) {
        parts.push(
            assignment.proxy_nickname
        );
    }

    if (assignment.proxy_number) {
        parts.push(
            `#${assignment.proxy_number}`
        );
    }

    return parts.length
        ? parts.join(" · ")
        : "—";
}


/**
 * Format assignment type.
 */
function formatAdminAssignmentType(
    assignment
) {
    if (!assignment) {
        return "Unassigned";
    }

    if (
        assignment.assignment_type ===
        "TRIAL"
    ) {
        return "Trial";
    }

    return "Assigned";
}


/**
 * Format status label.
 */
function formatAdminStatus(
    state
) {
    const labels = {
        ACTIVE: "Active",
        EXPIRING_SOON: "Expiring Soon",
        ASSIGNED: "Assigned",
        UNASSIGNED: "Awaiting Assignment",
        TRIAL: "Trial",
        EXPIRED: "Expired",
        REPLACED: "Replaced"
    };

    return (
        labels[state] ||
        state ||
        "Unknown"
    );
}


/**
 * Format dates for the admin UI.
 */
function formatAdminDate(
    value
) {
    if (!value) {
        return "—";
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        undefined,
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    ).format(date);
}

/* =========================================================
   PAYMENT OPERATIONS
   ========================================================= */

/**
 * Runtime state for Payment Review.
 */
const adminPaymentState = {
    filter: "SUBMITTED"
};


/**
 * Initialize Payment Review controls.
 */
function initAdminPaymentControls() {
    const filter =
        adminElement("payment-filter");

    if (
        filter &&
        !filter.dataset.initialized
    ) {
        filter.addEventListener(
            "change",
            () => {
                adminPaymentState.filter =
                    filter.value || "SUBMITTED";

                renderAdminPaymentTable();
            }
        );

        filter.dataset.initialized =
            "true";
    }
}



/**
 * Return orders relevant to Payment Review.
 */
function getAdminPaymentRecords() {
    const filter =
        adminPaymentState.filter;

    return adminDashboardState.orders.filter(
        (order) => {
            if (filter === "SUBMITTED") {
                return (
                    order.payment_status ===
                    "PAYMENT_SUBMITTED"
                );
            }

            if (filter === "VERIFIED") {
                return (
                    order.payment_status ===
                    "PAYMENT_VERIFIED"
                );
            }

            return Boolean(
                order.payment_status
            );
        }
    );
}


/**
 * Render Payment Review table.
 */
function renderAdminPaymentTable() {
    const tableBody =
        adminElement(
            "payment-table-body"
        );

    if (!tableBody) {
        return;
    }

    const records =
        getAdminPaymentRecords();

    tableBody.innerHTML = "";

    if (!records.length) {
        setPaymentTableMessage(
            "No payment records found."
        );

        return;
    }

    setPaymentTableMessage("");

    records.forEach(
        (order) => {
            tableBody.appendChild(
                createAdminPaymentRow(order)
            );
        }
    );
}


/**
 * Create one Payment Review row.
 */
function createAdminPaymentRow(order) {
    const row =
        document.createElement("tr");

    const customerCell =
        createAdminTableCell(
            formatAdminPaymentCustomer(order)
        );

    const orderCell =
        createAdminTableCell(
            formatAdminPaymentOrder(order)
        );

    const amountCell =
        createAdminTableCell(
            formatAdminPaymentAmount(
                order.plan_price
            )
        );

    const methodCell =
        createAdminTableCell(
            formatAdminPaymentMethod(
                order.payment_method
            )
        );

    const txidCell =
        createAdminTableCell(
            order.payment_reference
                ? order.payment_reference
                : "—"
        );

    const proofCell =
        createAdminPaymentProofCell(order);

    const statusCell =
        createAdminTableCell(
            formatAdminPaymentStatus(
                order.payment_status
            )
        );

    const actionCell =
        createAdminPaymentActionCell(order);

    row.appendChild(customerCell);
    row.appendChild(orderCell);
    row.appendChild(amountCell);
    row.appendChild(methodCell);
    row.appendChild(txidCell);
    row.appendChild(proofCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);

    return row;
}


/**
 * Create payment proof cell.
 */
function createAdminPaymentProofCell(order) {
    const cell =
        document.createElement("td");

    /*
     * Payment proof records are stored separately.
     * Until proof lookup/storage integration is added,
     * display a neutral state rather than exposing
     * internal storage paths.
     */

    const proofButton =
        document.createElement("button");

    proofButton.type =
        "button";

    proofButton.className =
        "admin-btn admin-btn-secondary admin-btn-small";

    proofButton.textContent =
        "View";

    proofButton.disabled = true;

    proofButton.title =
        "Payment proof viewer will be enabled in the next payment-proof stage.";

    cell.appendChild(proofButton);

    return cell;
}


/**
 * Create payment action cell.
 */
function createAdminPaymentActionCell(order) {
    const cell =
        document.createElement("td");

    if (
        order.payment_status ===
        "PAYMENT_SUBMITTED"
    ) {
        const button =
            document.createElement("button");

        button.type =
            "button";

        button.className =
            "admin-btn admin-btn-primary admin-btn-small";

        button.textContent =
            "Verify";

        button.dataset.orderId =
            order.order_id;

        button.addEventListener(
            "click",
            () => {
                handleAdminVerifyPayment(
                    order.order_id
                );
            }
        );

        cell.appendChild(button);

        return cell;
    }

    const statusText =
        document.createElement("span");

    statusText.className =
        "admin-action-muted";

    statusText.textContent =
        "—";

    cell.appendChild(statusText);

    return cell;
}


/**
 * Verify one submitted payment.
 */
async function handleAdminVerifyPayment(
    orderId
) {
    if (!orderId) {
        showAdminToast(
            "Order ID is missing.",
            "error"
        );

        return;
    }

    const confirmed =
        window.confirm(
            "Verify payment for order " +
            orderId +
            "?"
        );

    if (!confirmed) {
        return;
    }

    try {
        const supabase =
            initializeAdminSupabase();

        showAdminToast(
            "Verifying payment..."
        );

        const {
            data,
            error
        } = await supabase.rpc(
            "verify_payment",
            {
                p_order_id:
                    orderId
            }
        );

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                "Payment verification returned no data."
            );
        }

        showAdminToast(
            "Payment verified successfully.",
            "success"
        );

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy payment verification error:",
            error
        );

        showAdminToast(
            getFriendlyPaymentErrorMessage(
                error
            ),
            "error"
        );
    }
}


/**
 * Convert payment verification errors
 * into admin-friendly messages.
 */
function getFriendlyPaymentErrorMessage(
    error
) {
    const message =
        error &&
        typeof error.message === "string"
            ? error.message
            : "";

    if (
        message.includes(
            "Admin access required"
        )
    ) {
        return (
            "Administrator access is required."
        );
    }

    if (
        message.includes(
            "Order not found"
        )
    ) {
        return (
            "Order could not be found."
        );
    }

    if (
        message.includes(
            "Only submitted payments"
        )
    ) {
        return (
            "Only submitted payments can be verified."
        );
    }

    if (
        message.includes(
            "Payment reference is missing"
        )
    ) {
        return (
            "Payment reference is missing."
        );
    }

    if (
        error &&
        error.code === "42501"
    ) {
        return (
            "You do not have permission to verify payments."
        );
    }

    return (
        "Unable to verify payment. Please try again."
    );
}


/**
 * Format customer information for Payment Review.
 */
function formatAdminPaymentCustomer(order) {
    if (!order) {
        return "—";
    }

    return (
        order.full_name ||
        order.email ||
        "—"
    );
}


/**
 * Format order information for Payment Review.
 */
function formatAdminPaymentOrder(order) {
    if (!order) {
        return "—";
    }

    return (
        order.order_id ||
        "—"
    );
}

/**
 * Payment amount formatter.
 */
function formatAdminPaymentAmount(
    amount
) {
    if (
        amount === null ||
        amount === undefined ||
        amount === ""
    ) {
        return "—";
    }

    const numericAmount =
        Number(amount);

    if (
        !Number.isFinite(
            numericAmount
        )
    ) {
        return String(amount);
    }

    return (
        "$" +
        numericAmount.toFixed(2)
    );
}


/**
 * Payment method formatter.
 */
function formatAdminPaymentMethod(
    method
) {
    const labels = {
        USDT: "USDT",
        ACH: "ACH",
        PENDING: "Pending"
    };

    return (
        labels[method] ||
        method ||
        "—"
    );
}


/**
 * Payment status formatter.
 */
function formatAdminPaymentStatus(
    status
) {
    const labels = {
        UNPAID: "Unpaid",
        PAYMENT_SUBMITTED:
            "Payment Submitted",
        PAYMENT_VERIFIED:
            "Payment Verified"
    };

    return (
        labels[status] ||
        status ||
        "Unknown"
    );
}


/**
 * Set Payment Review table message.
 */
function setPaymentTableMessage(
    message
) {
    const element =
        adminElement(
            "payment-table-message"
        );

    if (!element) {
        return;
    }

    element.textContent =
        message || "";
}

/**
 * Update customer table message.
 */
function setCustomerTableMessage(
    message
) {
    const element =
        adminElement(
            "customer-table-message"
        );

    if (!element) {
        return;
    }

    element.textContent =
        message || "";
}


/* =========================================================
   TOAST
   ========================================================= */

/**
 * Show global admin toast.
 */
function showAdminToast(
    message,
    type = ""
) {
    const toast =
        adminElement("admin-toast");

    if (!toast) {
        return;
    }

    toast.textContent =
        message || "";

    toast.classList.remove(
        "is-hidden",
        "is-error",
        "is-success"
    );

    if (type === "error") {
        toast.classList.add(
            "is-error"
        );
    }

    if (type === "success") {
        toast.classList.add(
            "is-success"
        );
    }

    window.clearTimeout(
        showAdminToast.timeoutId
    );

    showAdminToast.timeoutId =
        window.setTimeout(
            () => {
                toast.classList.add(
                    "is-hidden"
                );
            },
            4000
        );
}


/* =========================================================
   MODAL FOUNDATION
   ========================================================= */

/**
 * Close all currently open admin modals.
 */
function closeAllAdminModals() {
    const modals =
        document.querySelectorAll(
            ".admin-modal"
        );

    modals.forEach(
        (modal) => {
            modal.classList.add(
                "is-hidden"
            );
        }
    );
}


/* =========================================================
   PROXY RFULILLMENT / REPAIR OPERATIONS
   ========================================================= */

const adminFulfillmentRepairState = {
    submitting: false
};

/**
 * Open Repair Fulfillment modal.
 */
function openAdminRepairFulfillmentModal(order) {
    const modal =
        adminElement("repair-fulfillment-modal");

    if (!modal || !order) {
        return;
    }

    const form =
        adminElement("repair-fulfillment-form");

    const orderIdInput =
        adminElement(
            "repair-fulfillment-order-id"
        );

    const orderDisplay =
        adminElement(
            "repair-fulfillment-order-display"
        );

    const proxyDisplay =
        adminElement(
            "repair-fulfillment-proxy-display"
        );

    const message =
        adminElement(
            "repair-fulfillment-message"
        );

    const activeAssignment =
        adminDashboardState.assignments.find(
            (assignment) =>
                assignment.order_id ===
                    order.order_id &&
                assignment.status === "ACTIVE"
        );

    if (!activeAssignment) {
        showAdminToast(
            "Active proxy assignment not found.",
            "error"
        );

        return;
    }

    if (form) {
        form.reset();
    }

    if (orderIdInput) {
        orderIdInput.value =
            order.order_id || "";
    }

    if (orderDisplay) {
        orderDisplay.value =
            order.order_id || "";
    }

    if (proxyDisplay) {
        proxyDisplay.value =
            activeAssignment.proxy_number || "—";
    }

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }

    modal.classList.remove(
        "is-hidden"
    );
}


/**
 * Close Repair Fulfillment modal.
 */
function closeAdminRepairFulfillmentModal() {
    const modal =
        adminElement(
            "repair-fulfillment-modal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add(
        "is-hidden"
    );

    const form =
        adminElement(
            "repair-fulfillment-form"
        );

    if (form) {
        form.reset();
    }

    const message =
        adminElement(
            "repair-fulfillment-message"
        );

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }
}


/**
 * Initialize Repair Fulfillment controls.
 */
function initAdminFulfillmentRepairControls() {
    const form =
        adminElement(
            "repair-fulfillment-form"
        );

    if (
        form &&
        !form.dataset.initialized
    ) {
        form.addEventListener(
            "submit",
            handleAdminRepairFulfillmentSubmit
        );

        form.dataset.initialized =
            "true";
    }

    const cancelButton =
        adminElement(
            "repair-fulfillment-cancel"
        );

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminRepairFulfillmentModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}


/**
 * Submit Repair Fulfillment.
 */
async function handleAdminRepairFulfillmentSubmit(
    event
) {
    event.preventDefault();

    if (
        adminFulfillmentRepairState.submitting
    ) {
        return;
    }

    const orderId =
        adminElement(
            "repair-fulfillment-order-id"
        )?.value.trim() || "";

    const message =
        adminElement(
            "repair-fulfillment-message"
        );

    const submitButton =
        adminElement(
            "repair-fulfillment-submit"
        );

    if (!orderId) {
        setAdminMessage(
            message,
            "Order ID is required.",
            "error"
        );

        return;
    }

    adminFulfillmentRepairState.submitting =
        true;

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            "Repairing...";
    }

    setAdminMessage(
        message,
        "Repairing fulfillment..."
    );

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            data,
            error
        } = await supabase.rpc(
            "repair_proxy_fulfillment",
            {
                p_order_id: orderId
            }
        );

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                "Fulfillment repair was not completed."
            );
        }

        closeAdminRepairFulfillmentModal();

        showAdminToast(
            "Fulfillment repaired successfully.",
            "success"
        );

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy fulfillment repair error:",
            error
        );

        setAdminMessage(
            message,
            getFriendlyAdminOperationError(
                error,
                "Unable to repair fulfillment."
            ),
            "error"
        );

        showAdminToast(
            "Unable to repair fulfillment.",
            "error"
        );

    } finally {
        adminFulfillmentRepairState.submitting =
            false;

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent =
                "Repair Fulfillment";
        }
    }
}

/* =========================================================
   PROXY REPLACEMENT OPERATIONS
   ========================================================= */

const adminReplacementState = {
    submitting: false
};


/**
 * Open Replace Proxy modal.
 */
function openAdminReplacementModal(
    assignment
) {
    const modal =
        adminElement(
            "replacement-modal"
        );

    if (!modal || !assignment) {
        return;
    }

    const form =
        adminElement(
            "replacement-form"
        );

    const assignmentIdInput =
        adminElement(
            "replacement-assignment-id"
        );

    const currentProxy =
        adminElement(
            "replacement-current-proxy"
        );

    const message =
        adminElement(
            "replacement-message"
        );

    if (form) {
        form.reset();
    }

    if (assignmentIdInput) {
        assignmentIdInput.value =
            assignment.id || "";
    }

    if (currentProxy) {
        currentProxy.textContent =
            `Current proxy: ${
                formatAdminProxy(
                    assignment
                )
            }`;
    }

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }

    modal.classList.remove(
        "is-hidden"
    );
}


/**
 * Close Replace Proxy modal.
 */
function closeAdminReplacementModal() {
    const modal =
        adminElement(
            "replacement-modal"
        );

    if (!modal) {
        return;
    }

    modal.classList.add(
        "is-hidden"
    );

    const form =
        adminElement(
            "replacement-form"
        );

    if (form) {
        form.reset();
    }

    const message =
        adminElement(
            "replacement-message"
        );

    if (message) {
        setAdminMessage(
            message,
            ""
        );
    }
}


/**
 * Initialize Replacement controls.
 */
function initAdminReplacementControls() {
    const form =
        adminElement(
            "replacement-form"
        );

    if (
        form &&
        !form.dataset.initialized
    ) {
        form.addEventListener(
            "submit",
            handleAdminReplacementSubmit
        );

        form.dataset.initialized =
            "true";
    }

    const cancelButton =
        adminElement(
            "replacement-cancel"
        );

    if (
        cancelButton &&
        !cancelButton.dataset.initialized
    ) {
        cancelButton.addEventListener(
            "click",
            closeAdminReplacementModal
        );

        cancelButton.dataset.initialized =
            "true";
    }
}


/**
 * Submit Proxy Replacement.
 */
async function handleAdminReplacementSubmit(
    event
) {
    event.preventDefault();

    if (
        adminReplacementState.submitting
    ) {
        return;
    }

    const assignmentId =
        adminElement(
            "replacement-assignment-id"
        )?.value.trim() || "";

    const nickname =
        adminElement(
            "replacement-proxy-nickname"
        )?.value.trim() || "";

    const proxyNumber =
        adminElement(
            "replacement-proxy-number"
        )?.value.trim() || "";

    const host =
        adminElement(
            "replacement-proxy-host"
        )?.value.trim() || "";

    const port =
        adminElement(
            "replacement-proxy-port"
        )?.value.trim() || "";

    const message =
        adminElement(
            "replacement-message"
        );

    const submitButton =
        adminElement(
            "replacement-submit"
        );

    if (!assignmentId) {
        setAdminMessage(
            message,
            "Assignment ID is required.",
            "error"
        );

        return;
    }

    if (!nickname) {
        setAdminMessage(
            message,
            "New proxy nickname is required.",
            "error"
        );

        return;
    }

    if (!proxyNumber) {
        setAdminMessage(
            message,
            "New proxy number is required.",
            "error"
        );

        return;
    }

    adminReplacementState.submitting =
        true;

    if (submitButton) {
        submitButton.disabled =
            true;

        submitButton.textContent =
            "Replacing...";
    }

    setAdminMessage(
        message,
        "Replacing proxy..."
    );

    try {
        const supabase =
            initializeAdminSupabase();

        const {
            data,
            error
        } = await supabase.rpc(
            "replace_proxy_assignment",
            {
                p_assignment_id:
                    assignmentId,
                p_proxy_nickname:
                    nickname,
                p_proxy_number:
                    proxyNumber,
                p_host:
                    host || null,
                p_port:
                    port || null
            }
        );

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                "Proxy replacement was not completed."
            );
        }

        showAdminToast(
            "Proxy replaced successfully.",
            "success"
        );

        closeAdminReplacementModal();

        await loadAdminDashboardData();

    } catch (error) {
        console.error(
            "NexProxy admin replacement error:",
            error
        );

        setAdminMessage(
            message,
            getFriendlyAdminOperationError(
                error,
                "Unable to replace proxy."
            ),
            "error"
        );

    } finally {
        adminReplacementState.submitting =
            false;

        if (submitButton) {
            submitButton.disabled =
                false;

            submitButton.textContent =
                "Replace Proxy";
        }
    }
}

/**
 * Initialize generic modal close behavior.
 */
function initAdminModalBehavior() {
    const closeButtons =
        document.querySelectorAll(
            ".admin-modal-close"
        );

    closeButtons.forEach(
        (button) => {
            button.addEventListener(
                "click",
                () => {
                    const modal =
                        button.closest(
                            ".admin-modal"
                        );

                    if (modal) {
                        modal.classList.add(
                            "is-hidden"
                        );
                    }
                }
            );
        }
    );

    const backdrops =
        document.querySelectorAll(
            ".admin-modal-backdrop"
        );

    backdrops.forEach(
        (backdrop) => {
            backdrop.addEventListener(
                "click",
                () => {
                    const modal =
                        backdrop.closest(
                            ".admin-modal"
                        );

                    if (modal) {
                        modal.classList.add(
                            "is-hidden"
                        );
                    }
                }
            );
        }
    );

    document.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Escape"
            ) {
                closeAllAdminModals();
            }
        }
    );
}


/* =========================================================
   GLOBAL ERROR HANDLING
   ========================================================= */

window.addEventListener(
    "error",
    (event) => {
        console.error(
            "NexProxy admin runtime error:",
            event.error || event.message
        );
    }
);


window.addEventListener(
    "unhandledrejection",
    (event) => {
        console.error(
            "NexProxy admin promise error:",
            event.reason
        );
    }
);


/* =========================================================
   INITIAL APPLICATION BOOTSTRAP
   ========================================================= */

/**
 * Bootstrap the admin application.
 */
async function initializeAdminApplication() {
    if (adminState.initialized) {
        return;
    }

    adminState.initialized = true;

    try {
        /*
         * Supabase CDN is loaded with defer.
         * This script is also deferred, therefore
         * the library should already be available.
         */

        initializeAdminSupabase();

        initAdminLoginForm();

        initAdminLogout();

        initAdminModalBehavior();

        initAdminAddProxyControls();

        initAdminAddProxyForm();

        initAdminAssignmentControls();

        initAdminExtensionControls();

        initAdminReplacementControls();

        initAdminFulfillmentRepairControls();

        initAdminEditProxyControls();

        initAdminEditProxyForm();

        initAdminPaymentSettingsControls();

        initAdminAuthListener();

        /*
         * Check whether a session already exists.
         */

        const session =
            await getCurrentAdminSession();

        if (!session) {
            showAdminLogin();

            return;
        }

        adminState.session =
            session;

        adminState.user =
            session.user;

        /*
         * Authentication is not enough.
         * Verify database-side admin membership.
         */

        const isAdmin =
            await checkAdminAuthorization();

        if (!isAdmin) {
            showAdminAccessDenied();

            return;
        }

        updateCurrentAdminDisplay();

        showAdminDashboard();

        await initializeAdminDashboard();

    } catch (error) {
        console.error(
            "NexProxy admin initialization error:",
            error
        );

        showAdminLogin();

        setAdminMessage(
            adminElement(
                "admin-login-message"
            ),
            getFriendlyAuthErrorMessage(
                error
            ),
            "error"
        );
    }
}


/* =========================================================
   DOM READY
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {
        initializeAdminApplication();
    }
);
