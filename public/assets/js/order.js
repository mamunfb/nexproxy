"use strict";

document.addEventListener("DOMContentLoaded", () => {
    initOrderForm();
    initCountryDetection();
    restoreSavedOrder();
    applyPlanQuery();
});

/**
 * Initialize order form behavior.
 */
function initOrderForm() {
    const form = document.querySelector("#order-form");

    if (!form) {
        return;
    }

    const planInputs = form.querySelectorAll('input[name="plan"]');
    const summaryPlan = document.querySelector("#summary-plan");
    const summaryPrice = document.querySelector("#summary-price");
    const customQuantity = document.querySelector("#order-custom-quantity");

    planInputs.forEach((input) => {
        input.addEventListener("change", () => {
            updateOrderSummary(input, summaryPlan, summaryPrice);
            clearFormError("plan-error");
        });
    });

    customQuantity?.addEventListener("change", () => {
        const selectedPlan = form.querySelector('input[name="plan"]:checked');
        if (selectedPlan?.value === "custom") {
            updateOrderSummary(selectedPlan, summaryPlan, summaryPrice);
        }
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const isValid = validateOrderForm(form);

        if (!isValid) {
            return;
        }

        prepareOrderReview(form);
    });
}

/**
 * Update the visible order summary.
 */
function updateOrderSummary(input, summaryPlan, summaryPrice) {
    const planName = input.dataset.planName || "Select a plan";
    const planPrice = input.dataset.planPrice || "";

    summaryPlan.textContent = planName;

    if (planPrice === "custom") {
        const quantity = document.querySelector("#order-custom-quantity")?.value || 1;
        const pricing = window.NexProxyPricing?.calculateCustomPricing(quantity);
        setCustomQuantityVisibility(true);
        summaryPrice.textContent = pricing
            ? `${window.NexProxyPricing.formatCurrency(pricing.totalPrice)} / month`
            : "Custom";
        updateCustomPricingSummary(pricing);
        return;
    }

    setCustomQuantityVisibility(false);

    if (planPrice) {
        summaryPrice.textContent = `$${Number(planPrice).toFixed(2)} / month`;
        return;
    }

    summaryPrice.textContent = "—";
}

function setCustomQuantityVisibility(isVisible) {
    const field = document.querySelector("#custom-quantity-field");
    if (field) field.hidden = !isVisible;
}

function updateCustomPricingSummary(pricing) {
    const summary = document.querySelector("#custom-pricing-summary");
    if (!summary || !pricing || !window.NexProxyPricing) return;
    summary.textContent = `${pricing.quantity} ${pricing.quantity === 1 ? "proxy" : "proxies"} · ${window.NexProxyPricing.formatCurrency(pricing.perProxyPrice)} per proxy · ${window.NexProxyPricing.formatCurrency(pricing.totalPrice)} total · ${pricing.discountPercent.toFixed(2)}% off · ${window.NexProxyPricing.formatCurrency(pricing.savings)} saved/month`;
}

/**
 * Validate the order form.
 */
function validateOrderForm(form) {
    let isValid = true;

    const selectedPlan = form.querySelector(
        'input[name="plan"]:checked'
    );

    const planError = document.querySelector("#plan-error");

    if (!selectedPlan) {
        showFormError(
            planError,
            "Please select a plan before continuing."
        );

        isValid = false;
    } else {
        clearFormError("plan-error");
    }

    if (selectedPlan?.value === "custom") {
        const customQuantity = Number.parseInt(document.querySelector("#order-custom-quantity")?.value, 10);
        if (!Number.isInteger(customQuantity) || customQuantity < 1 || customQuantity > 100) {
            showFormError(planError, "Please select a custom quantity from 1 to 100 proxies.");
            isValid = false;
        }
    }

    const requiredFields = form.querySelectorAll(
        "input[required], select[required], textarea[required]"
    );

    requiredFields.forEach((field) => {
        if (field.name === "plan") {
            return;
        }

        const fieldError = getFieldErrorElement(field);

        if (!field.checkValidity()) {
            field.setAttribute("aria-invalid", "true");

            if (fieldError) {
                fieldError.textContent = getFieldErrorMessage(field);
            }

            isValid = false;
        } else {
            field.removeAttribute("aria-invalid");

            if (fieldError) {
                fieldError.textContent = "";
            }
        }

        field.addEventListener(
            "input",
            () => {
                if (field.checkValidity()) {
                    field.removeAttribute("aria-invalid");

                    if (fieldError) {
                        fieldError.textContent = "";
                    }
                }
            },
            { once: true }
        );
    });

    const consent = form.querySelector("#terms-consent");
    const consentError = document.querySelector("#consent-error");

    if (!consent.checked) {
        showFormError(
            consentError,
            "Please agree to the Terms of Service and Acceptable Use Policy."
        );

        isValid = false;
    } else {
        clearFormError("consent-error");
    }

    if (!isValid) {
        focusFirstInvalidField(form);
    }

    return isValid;
}

/**
 * Prepare the submitted order data for the review step.
 *
 * The actual payment process will be implemented in Sprint 16.
 */
function prepareOrderReview(form) {
    const selectedPlan = form.querySelector(
        'input[name="plan"]:checked'
    );

    if (!selectedPlan) {
        return;
    }

    const isCustom = selectedPlan.value === "custom";
    const customPricing = isCustom
        ? window.NexProxyPricing.calculateCustomPricing(document.querySelector("#order-custom-quantity")?.value || 1)
        : null;
    const requestedOrderId = new URLSearchParams(window.location.search).get("orderId");
    const previousOrder = requestedOrderId ? readStoredOrderDraft() : null;
    const orderData = {
        orderId: previousOrder?.orderId || createLocalOrderId(),
        plan: selectedPlan.value,
        planName: isCustom ? `Custom (${customPricing.quantity} proxies)` : selectedPlan.dataset.planName,
        planPrice: isCustom ? customPricing.totalPrice.toFixed(2) : Number(selectedPlan.dataset.planPrice || 0).toFixed(2),
        regularPrice: isCustom ? customPricing.regularPrice.toFixed(2) : (Number(selectedPlan.dataset.planQuantity || 0) * 120).toFixed(2),
        savings: isCustom ? customPricing.savings.toFixed(2) : Number((Number(selectedPlan.dataset.planQuantity || 0) * 120) - Number(selectedPlan.dataset.planPrice || 0)).toFixed(2),
        discountPercent: isCustom ? customPricing.discountPercent.toFixed(2) : selectedPlan.dataset.planDiscount || "0.00",
        perProxyPrice: isCustom ? customPricing.perProxyPrice.toFixed(2) : selectedPlan.dataset.planQuantity ? (Number(selectedPlan.dataset.planPrice) / Number(selectedPlan.dataset.planQuantity)).toFixed(2) : "0.00",
        customQuantity: isCustom ? customPricing.quantity : null,
        country: form.country?.value || "Unknown",
        countryCode: form.country?.dataset.countryCode || "",
        fullName: form.fullName.value.trim(),
        email: form.email.value.trim(),
        telegram: form.telegram.value.trim(),
        intendedUse: form.intendedUse.value,
        requirements: form.requirements.value.trim(),
        termsConsent: form.termsConsent.checked
    };

    sessionStorage.setItem(
        "nexproxyOrder",
        JSON.stringify(orderData)
    );

    localStorage.setItem(
        `nexproxyOrder:${orderData.orderId}`,
        JSON.stringify(orderData)
    );

    /*
    * Continue to the Order Review page.
    */
    window.location.href = `review/?orderId=${encodeURIComponent(orderData.orderId)}`;
}

async function initCountryDetection() {
    const select = document.querySelector("#country");
    const summary = document.querySelector("#summary-country");
    if (!select) return;

    try {
        const response = await fetch("/api/geo", { headers: { Accept: "application/json" } });
        const data = await response.json();
        const country = String(data?.country || "Unknown").trim() || "Unknown";
        const countryCode = String(data?.countryCode || "").trim().toUpperCase();
        select.innerHTML = "";
        const option = document.createElement("option");
        option.value = country;
        option.textContent = countryCode ? `${country} (${countryCode})` : country;
        option.selected = true;
        select.appendChild(option);
        select.dataset.countryCode = countryCode;
        if (summary) summary.textContent = option.textContent;
    } catch (error) {
        select.innerHTML = '<option value="Unknown" selected>Unknown</option>';
        if (summary) summary.textContent = "Unknown";
    }
}

function createLocalOrderId() {
    return `NP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function readStoredOrderDraft() {
    const requestedOrderId = new URLSearchParams(window.location.search).get("orderId");
    const storedOrder = requestedOrderId
        ? localStorage.getItem(`nexproxyOrder:${requestedOrderId}`)
        : sessionStorage.getItem("nexproxyOrder");
    if (!storedOrder) return null;
    try {
        return JSON.parse(storedOrder);
    } catch (error) {
        sessionStorage.removeItem("nexproxyOrder");
        return null;
    }
}

function applyPlanQuery() {
    const form = document.querySelector("#order-form");
    if (!form) return;
    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get("plan");
    const requestedQuantity = params.get("quantity");
    if (!requestedPlan) return;

    const planInput = form.querySelector(`input[name="plan"][value="${CSS.escape(requestedPlan)}"]`);
    if (!planInput) return;
    planInput.checked = true;
    const customQuantity = document.querySelector("#order-custom-quantity");
    if (requestedPlan === "custom" && customQuantity && requestedQuantity) {
        customQuantity.value = String(Math.min(100, Math.max(1, Number.parseInt(requestedQuantity, 10) || 1)));
    }
    updateOrderSummary(planInput, document.querySelector("#summary-plan"), document.querySelector("#summary-price"));
}

/**
 * Display a form error message.
 */
function showFormError(element, message) {
    if (!element) {
        return;
    }

    element.textContent = message;
}

/**
 * Clear a form error message.
 */
function clearFormError(id) {
    const element = document.querySelector(`#${id}`);

    if (!element) {
        return;
    }

    element.textContent = "";
}

/**
 * Focus the first invalid field.
 */
function focusFirstInvalidField(form) {
    const invalidField = form.querySelector(
        ":invalid"
    );

    if (invalidField) {
        invalidField.focus();
    }
}


/**
 * Find or create the error element for a form field.
 */
function getFieldErrorElement(field) {
    let errorElement = document.querySelector(
        `#${field.id}-error`
    );

    if (!errorElement) {
        errorElement = document.createElement("p");
        errorElement.className = "form-error";
        errorElement.id = `${field.id}-error`;
        errorElement.setAttribute("role", "alert");

        field.closest(".form-field")?.appendChild(errorElement);
    }

    return errorElement;
}


/**
 * Return a user-friendly validation message.
 */
function getFieldErrorMessage(field) {
    switch (field.id) {
        case "full-name":
            return "Please enter your full name.";

        case "email":
            return "Please enter a valid email address.";

        case "telegram":
            return "Please enter your Telegram username.";

        case "intended-use":
            return "Please select your intended use.";

        default:
            return "Please complete this field.";
    }
}


/**
 * Restore previously entered order information.
 */
function restoreSavedOrder() {
    const requestedOrderId = new URLSearchParams(window.location.search).get("orderId");
    const storedOrder = requestedOrderId
        ? localStorage.getItem(`nexproxyOrder:${requestedOrderId}`)
        : sessionStorage.getItem("nexproxyOrder");

    if (!storedOrder) {
        return;
    }

    let orderData;

    try {
        orderData = JSON.parse(storedOrder);
    } catch (error) {
        console.error("Unable to restore saved order data.", error);
        return;
    }

    const form = document.querySelector("#order-form");

    if (!form) {
        return;
    }

    const planInput = form.querySelector(
        `input[name="plan"][value="${orderData.plan}"]`
    );

    if (planInput) {
        planInput.checked = true;

        const summaryPlan = document.querySelector("#summary-plan");
        const summaryPrice = document.querySelector("#summary-price");

        updateOrderSummary(
            planInput,
            summaryPlan,
            summaryPrice
        );

        if (orderData.customQuantity) {
            const customQuantity = document.querySelector("#order-custom-quantity");
            if (customQuantity) {
                customQuantity.value = String(orderData.customQuantity);
                updateOrderSummary(planInput, summaryPlan, summaryPrice);
            }
        }
    }

    if (form.fullName && orderData.fullName) {
        form.fullName.value = orderData.fullName;
    }

    if (form.email && orderData.email) {
        form.email.value = orderData.email;
    }

    if (form.telegram && orderData.telegram) {
        form.telegram.value = orderData.telegram;
    }

    if (form.intendedUse && orderData.intendedUse) {
        form.intendedUse.value = orderData.intendedUse;
    }

    if (form.requirements && orderData.requirements) {
        form.requirements.value = orderData.requirements;
    }

    if (form.country && orderData.country) {
        form.country.innerHTML = "";
        const option = document.createElement("option");
        option.value = orderData.country;
        option.textContent = orderData.countryCode
            ? `${orderData.country} (${orderData.countryCode})`
            : orderData.country;
        option.selected = true;
        form.country.appendChild(option);
        form.country.dataset.countryCode = orderData.countryCode || "";
        const summaryCountry = document.querySelector("#summary-country");
        if (summaryCountry) summaryCountry.textContent = option.textContent;
    }

    if (form.termsConsent) {
        form.termsConsent.checked = Boolean(
            orderData.termsConsent
        );
    }
}
