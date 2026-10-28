"use strict";

document.addEventListener("DOMContentLoaded", () => {
    initOrderReview();
});

/**
 * Initialize the order review page.
 */
function initOrderReview() {
    const orderData = getStoredOrder();

    if (!orderData) {
        if (new URLSearchParams(window.location.search).has("orderId")) {
            showOrderLookupMessage("That Order ID was not found in this browser.");
            initOrderLookup();
        } else {
            redirectToOrderForm();
        }
        return;
    }

    if (!orderData.orderId) {
        orderData.orderId = createLocalOrderId();
        localStorage.setItem(`nexproxyOrder:${orderData.orderId}`, JSON.stringify(orderData));
    }

    sessionStorage.setItem("nexproxyOrder", JSON.stringify(orderData));
    populateOrderDetails(orderData);
    populateCustomerDetails(orderData);
    initReviewActions();
    initOrderLookup();

    const editOrder = document.querySelector("#edit-order");
    if (editOrder) {
        editOrder.href = `../?orderId=${encodeURIComponent(orderData.orderId)}`;
    }
}

/**
 * Retrieve the saved order from sessionStorage.
 */
function getStoredOrder() {
    const requestedOrderId = new URLSearchParams(window.location.search).get("orderId");
    if (requestedOrderId) {
        const savedById = localStorage.getItem(`nexproxyOrder:${requestedOrderId}`);
        if (!savedById) return null;
        try {
            return JSON.parse(savedById);
        } catch (error) {
            localStorage.removeItem(`nexproxyOrder:${requestedOrderId}`);
            return null;
        }
    }

    const storedOrder = sessionStorage.getItem("nexproxyOrder");

    if (!storedOrder) {
        return null;
    }

    try {
        return JSON.parse(storedOrder);
    } catch (error) {
        console.error("Unable to read stored order data.", error);
        sessionStorage.removeItem("nexproxyOrder");
        return null;
    }
}

/**
 * Redirect visitors back to the order form when no order exists.
 */
function redirectToOrderForm() {
    window.location.href = "../";
}

/**
 * Populate plan and pricing information.
 */
function populateOrderDetails(orderData) {
    const reviewPlan = document.querySelector("#review-plan");
    const reviewDuration = document.querySelector("#review-duration");
    const reviewPrice = document.querySelector("#review-price");
    const reviewOrderId = document.querySelector("#review-order-id");
    const reviewCountry = document.querySelector("#review-country");
    const summaryPlan = document.querySelector("#summary-plan");
    const summaryPrice = document.querySelector("#summary-price");
    const summaryCountry = document.querySelector("#summary-country");
    const trialCreditNote = document.querySelector("#trial-credit-note");

    const planName = orderData.planName || "—";
    const planPrice = orderData.planPrice || "";
    const duration = getPlanDuration(orderData.plan);

    if (reviewPlan) {
        reviewPlan.textContent = planName;
    }

    if (reviewOrderId) {
        reviewOrderId.textContent = orderData.orderId || "—";
    }

    if (reviewDuration) {
        reviewDuration.textContent = duration;
    }

    if (reviewPrice) {
        reviewPrice.textContent = formatPrice(planPrice);
    }

    const country = orderData.countryCode
        ? `${orderData.country} (${orderData.countryCode})`
        : orderData.country || "Unknown";
    if (reviewCountry) reviewCountry.textContent = country;

    if (summaryPlan) {
        summaryPlan.textContent = planName;
    }

    if (summaryPrice) {
        summaryPrice.textContent = formatPrice(planPrice);
    }

    if (summaryCountry) summaryCountry.textContent = country;

    if (trialCreditNote) {
        trialCreditNote.hidden = orderData.plan !== "trial";
    }
}

/**
 * Populate customer information.
 */
function populateCustomerDetails(orderData) {
    const fields = {
        "#review-name": orderData.fullName,
        "#review-email": orderData.email,
        "#review-telegram": orderData.telegram,
        "#review-intended-use": orderData.intendedUse,
        "#review-requirements": orderData.requirements || "None"
    };

    Object.entries(fields).forEach(([selector, value]) => {
        const element = document.querySelector(selector);

        if (!element) {
            return;
        }

        element.textContent = value || "—";
    });
}

/**
 * Initialize review page actions.
 */

/**
 * Initialize review page actions.
 */
function initReviewActions() {
    const confirmButton = document.querySelector("#confirm-order");

    if (!confirmButton) {
        return;
    }

    confirmButton.addEventListener("click", async () => {
        const orderData = getStoredOrder();

        if (!orderData) {
            redirectToOrderForm();
            return;
        }

        const updatedOrder = {
            ...orderData,
            orderId: orderData.orderId || createLocalOrderId(),
            orderStatus: "PENDING_PAYMENT",
            paymentStatus: Number(orderData.planPrice) === 0
                ? "NO_PAYMENT_REQUIRED"
                : "UNPAID"
        };

        confirmButton.disabled = true;
        confirmButton.setAttribute("aria-busy", "true");

        try {
            const supabase = getReviewSupabaseClient();
            const { data: sessionData, error: sessionError } =
                await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!sessionData?.session?.user) {
                throw new Error("Please sign in before confirming your order.");
            }

            const location = readIpLocationForOrder(updatedOrder.orderId);
            const { data: result, error } = await supabase.rpc(
                "create_customer_order",
                {
                    p_order_id: updatedOrder.orderId,
                    p_plan: updatedOrder.plan,
                    p_plan_name: updatedOrder.planName,
                    p_plan_price: toOrderNumber(updatedOrder.planPrice),
                    p_regular_price: toOrderNumber(updatedOrder.regularPrice),
                    p_savings: toOrderNumber(updatedOrder.savings),
                    p_discount_percent: toOrderNumber(updatedOrder.discountPercent),
                    p_per_proxy_price: toOrderNumber(updatedOrder.perProxyPrice),
                    p_custom_quantity: updatedOrder.customQuantity !== null &&
                        updatedOrder.customQuantity !== undefined &&
                        Number.isInteger(Number(updatedOrder.customQuantity))
                        ? Number(updatedOrder.customQuantity)
                        : null,
                    p_country: updatedOrder.country,
                    p_country_code: updatedOrder.countryCode || null,
                    p_full_name: updatedOrder.fullName,
                    p_email: updatedOrder.email,
                    p_telegram: updatedOrder.telegram || null,
                    p_intended_use: updatedOrder.intendedUse || null,
                    p_requirements: updatedOrder.requirements || null,
                    p_terms_consent: Boolean(updatedOrder.termsConsent),
                    p_geo_country: location?.country || null,
                    p_geo_country_code: location?.countryCode || null,
                    p_geo_region: location?.region || null,
                    p_geo_city: location?.city || null,
                    p_geo_latitude: location?.latitude ?? null,
                    p_geo_longitude: location?.longitude ?? null
                }
            );

            if (error) throw error;
            if (!result?.success) {
                throw new Error("Unable to create your order.");
            }

            sessionStorage.setItem(
                "nexproxyOrder",
                JSON.stringify(updatedOrder)
            );
            localStorage.setItem(
                `nexproxyOrder:${updatedOrder.orderId}`,
                JSON.stringify(updatedOrder)
            );
            sessionStorage.removeItem(
                `nexproxyIpLocation:${updatedOrder.orderId}`
            );

            window.location.href = "../../payment/";
        } catch (error) {
            console.error(
                "Unable to create order in Supabase.",
                error
            );

            confirmButton.disabled = false;
            confirmButton.removeAttribute("aria-busy");

            alert(
                "We could not create your order right now. Please try again."
            );
        }
    });
}

function getReviewSupabaseClient() {
    if (window.NEXPROXY_SUPABASE_CLIENT) {
        return window.NEXPROXY_SUPABASE_CLIENT;
    }

    if (
        typeof window.supabase?.createClient !== "function" ||
        !window.NEXPROXY_SUPABASE_URL ||
        !window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY
    ) {
        throw new Error("Supabase configuration is unavailable.");
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

function toOrderNumber(value) {
    if (value === "" || value === null || value === undefined || value === "custom") {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function readIpLocationForOrder(orderId) {
    const key = `nexproxyIpLocation:${orderId}`;
    const value = sessionStorage.getItem(key);
    if (!value) return null;

    try {
        const location = JSON.parse(value);
        const latitudeSource = location.latitude;
        const longitudeSource = location.longitude;
        const latitude = latitudeSource === null || latitudeSource === undefined || latitudeSource === ""
            ? NaN
            : Number(latitudeSource);
        const longitude = longitudeSource === null || longitudeSource === undefined || longitudeSource === ""
            ? NaN
            : Number(longitudeSource);
        return {
            country: String(location.country || "").slice(0, 100),
            countryCode: String(location.countryCode || "").toUpperCase().match(/^[A-Z]{2}$/)?.[0] || "",
            region: String(location.region || "").slice(0, 100),
            city: String(location.city || "").slice(0, 100),
            latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
                ? latitude
                : null,
            longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
                ? longitude
                : null
        };
    } catch {
        sessionStorage.removeItem(key);
        return null;
    }
}

/**
 * Return the duration associated with a plan.
 */
function getPlanDuration(plan) {
    switch (plan) {
        case "trial":
            return "10 minutes";

        case "starter":
        case "growth":
        case "professional":
        case "business":
        case "custom":
            return "30 days";

        default:
            return "—";
    }
}

/**
 * Format a stored plan price for display.
 */
function formatPrice(price) {
    if (price === "" || price === null || price === undefined) {
        return "Custom";
    }

    if (price === "custom") {
        return "Custom";
    }

    return `$${price}`;
}

function initOrderLookup() {
    const form = document.querySelector("#order-lookup-form");
    if (!form || form.dataset.bound === "true") return;
    form.dataset.bound = "true";

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = document.querySelector("#order-lookup-id");
        const orderId = input?.value.trim();
        if (!orderId) {
            showOrderLookupMessage("Enter an Order ID to continue.");
            return;
        }
        window.location.href = `?orderId=${encodeURIComponent(orderId)}`;
    });
}

function showOrderLookupMessage(message) {
    const element = document.querySelector("#order-lookup-message");
    if (element) element.textContent = message;
}


function createLocalOrderId() {
    return `NP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}
