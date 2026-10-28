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
            const supabasePublishableKey =
                window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY;

            if (!supabasePublishableKey) {
                throw new Error(
                    "Supabase configuration is unavailable."
                );
            }

            const response = await fetch(
                "https://fzvxuhumtebqlpwqpkvt.supabase.co/functions/v1/dynamic-action",
                {
                    method: "POST",
                    headers: {
                        "apikey": supabasePublishableKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        orderId: updatedOrder.orderId,
                        plan: updatedOrder.plan,
                        planName: updatedOrder.planName,
                        planPrice: updatedOrder.planPrice,
                        regularPrice: updatedOrder.regularPrice,
                        savings: updatedOrder.savings,
                        discountPercent: updatedOrder.discountPercent,
                        perProxyPrice: updatedOrder.perProxyPrice,
                        customQuantity: updatedOrder.customQuantity,
                        country: updatedOrder.country,
                        countryCode: updatedOrder.countryCode,
                        fullName: updatedOrder.fullName,
                        email: updatedOrder.email,
                        telegram: updatedOrder.telegram,
                        intendedUse: updatedOrder.intendedUse,
                        requirements: updatedOrder.requirements,
                        termsConsent: updatedOrder.termsConsent
                    })
                }
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(
                    result?.error ||
                    "Unable to create your order."
                );
            }

            sessionStorage.setItem(
                "nexproxyOrder",
                JSON.stringify(updatedOrder)
            );
            localStorage.setItem(
                `nexproxyOrder:${updatedOrder.orderId}`,
                JSON.stringify(updatedOrder)
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
