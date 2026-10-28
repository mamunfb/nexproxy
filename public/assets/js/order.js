"use strict";

let latestIpLocation = null;

document.addEventListener("DOMContentLoaded", async () => {
    initOrderForm();
    await populateCountryOptions();
    restoreSavedOrder();
    applyPlanQuery();
    initCountryDetection();
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
    const countryControl = form.elements.namedItem("country");
    const selectedCountry = countryControl?.selectedOptions?.[0] || null;
    const countryCode = String(
        selectedCountry?.value || countryControl?.dataset.countryCode || ""
    ).toUpperCase().match(/^[A-Z]{2}$/)?.[0] || "";
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
        country: selectedCountry?.dataset.countryName || countryControl?.value?.trim() || "Unknown",
        countryCode,
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

    if (latestIpLocation) {
        sessionStorage.setItem(
            `nexproxyIpLocation:${orderData.orderId}`,
            JSON.stringify(latestIpLocation)
        );
    }

    /*
    * Continue to the Order Review page.
    */
    window.location.href = `review/?orderId=${encodeURIComponent(orderData.orderId)}`;
}

async function populateCountryOptions() {
    const select = document.querySelector("#country");
    if (!(select instanceof HTMLSelectElement)) return;

    try {
        const response = await fetch("/assets/data/countries.json", {
            headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error("The country list could not be loaded.");

        const countries = await response.json();
        if (!Array.isArray(countries) || countries.length < 200) {
            throw new Error("The country list is incomplete.");
        }

        const options = document.createDocumentFragment();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Detecting country…";
        options.appendChild(placeholder);

        countries.forEach((country) => {
            const code = String(country?.code || "").toUpperCase();
            const name = String(country?.name || "").trim();
            if (!/^[A-Z]{2}$/.test(code) || !name) return;

            const option = document.createElement("option");
            option.value = code;
            option.textContent = `${name} (${code})`;
            option.dataset.countryName = name;
            options.appendChild(option);
        });

        select.replaceChildren(options);
        select.dataset.countryOptionsLoaded = "true";
        select.addEventListener("change", () => {
            const summary = document.querySelector("#summary-country");
            if (summary) summary.textContent = select.selectedOptions[0]?.textContent || "Select a country";
        });
    } catch (error) {
        console.warn("Unable to load the complete country list.", error);
        useManualCountryInput(select, document.querySelector("#summary-country"));
    }
}

async function initCountryDetection() {
    const select = document.querySelector("#country");
    const summary = document.querySelector("#summary-country");
    if (!select) return;

    let detectedCountry = null;
    try {
        const response = await fetch("/api/geo", { headers: { Accept: "application/json" } });
        if (response.ok) detectedCountry = normalizeDetectedCountry(await response.json());
    } catch {
        // The browser-side provider can still detect the visitor's IP region.
    }

    if (!detectedCountry || !hasCoordinates(detectedCountry)) {
        try {
            const browserLocation = await detectCountryFromBrowser();
            if (browserLocation) {
                if (detectedCountry?.source === "ipinfo-lite") {
                    const providersAgree = browserLocation.countryCode === detectedCountry.countryCode;
                    detectedCountry = providersAgree
                        ? {
                            ...browserLocation,
                            country: detectedCountry.country,
                            countryCode: detectedCountry.countryCode,
                            source: "ipinfo-lite"
                        }
                        : { ...detectedCountry, city: "", region: "", latitude: null, longitude: null };
                } else {
                    detectedCountry = { ...detectedCountry, ...browserLocation };
                }
            }
        } catch (error) {
            console.warn("Automatic country detection failed.", error);
        }
    }

    if (!detectedCountry) {
        const help = document.querySelector("#country-help");
        if (help) help.textContent = "Could not detect your country. Choose it from the full list.";
        if (summary) summary.textContent = "Select a country";
        return;
    }

    latestIpLocation = {
        country: detectedCountry.country,
        countryCode: detectedCountry.countryCode,
        city: detectedCountry.city || "",
        region: detectedCountry.region || "",
        latitude: detectedCountry.latitude,
        longitude: detectedCountry.longitude
    };

    // Keep the customer's manual choice if it changed while IP lookup was running.
    if (select.value) return;

    if (select instanceof HTMLSelectElement) {
        const option = Array.from(select.options).find(
            (candidate) => candidate.value === detectedCountry.countryCode
        );
        if (!option) {
            const help = document.querySelector("#country-help");
            if (help) help.textContent = "Could not match the detected region. Choose your country from the full list.";
            return;
        }
        select.value = detectedCountry.countryCode;
        const help = document.querySelector("#country-help");
        if (help) help.textContent = "Auto-selected from your IP address. Change it if needed.";
        if (summary) summary.textContent = option.textContent;
    } else {
        select.value = detectedCountry.country;
        select.dataset.countryCode = detectedCountry.countryCode;
        if (summary) summary.textContent = detectedCountry.country;
    }
}

function normalizeDetectedCountry(data) {
    if (!data || data.error) return null;

    const countryCode = String(data.countryCode || data.country_code || "")
        .trim()
        .toUpperCase()
        .match(/^[A-Z]{2}$/)?.[0] || "";
    let country = String(data.country_name || data.country || "").trim();

    if ((!country || /^(unknown|uncommon|n\/a)$/i.test(country) || country.toUpperCase() === countryCode) && countryCode) {
        try {
            const displayName = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode);
            country = displayName && displayName !== countryCode ? displayName : countryCode;
        } catch {
            country = countryCode;
        }
    }

    if (!country || /^(unknown|uncommon|n\/a)$/i.test(country)) return null;

    const latitudeSource = data.latitude ?? data.lat;
    const longitudeSource = data.longitude ?? data.lon ?? data.lng;
    const latitudeValue = latitudeSource === "" || latitudeSource == null ? NaN : Number(latitudeSource);
    const longitudeValue = longitudeSource === "" || longitudeSource == null ? NaN : Number(longitudeSource);

    return {
        country,
        countryCode,
        source: ["ipinfo-lite", "ipapi", "hosting-header", "none"].includes(data.source) ? data.source : "",
        city: String(data.city || "").trim().slice(0, 100),
        region: String(data.region || data.region_name || "").trim().slice(0, 100),
        latitude: Number.isFinite(latitudeValue) && latitudeValue >= -90 && latitudeValue <= 90
            ? Math.round(latitudeValue * 100) / 100
            : null,
        longitude: Number.isFinite(longitudeValue) && longitudeValue >= -180 && longitudeValue <= 180
            ? Math.round(longitudeValue * 100) / 100
            : null
    };
}

function hasCoordinates(location) {
    return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

async function detectCountryFromBrowser() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch("https://ipapi.co/json/", {
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
        if (!response.ok) throw new Error("The country lookup provider is unavailable.");

        const result = normalizeDetectedCountry(await response.json());
        if (!result) throw new Error("The country lookup provider returned no country.");
        return result;
    } finally {
        window.clearTimeout(timer);
    }
}

function useManualCountryInput(select, summary) {
    const input = document.createElement("input");
    input.type = "text";
    input.id = select.id;
    input.name = select.name;
    input.className = select.className;
    input.required = select.required;
    input.autocomplete = "country-name";
    input.placeholder = "Enter your country";
    input.setAttribute("aria-describedby", select.getAttribute("aria-describedby") || "country-help");
    input.dataset.countryCode = "";
    select.replaceWith(input);

    const help = document.querySelector("#country-help");
    if (help) help.textContent = "The country list is unavailable. Enter your country manually.";
    if (summary) summary.textContent = "Enter country";
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
        const countryField = form.country;
        countryField.dataset.countryCode = orderData.countryCode || "";
        let countryLabel = orderData.country;
        if (countryField instanceof HTMLSelectElement) {
            const savedCode = String(orderData.countryCode || "").toUpperCase();
            let option = Array.from(countryField.options).find(
                (candidate) => savedCode && candidate.value === savedCode
            );
            option ||= Array.from(countryField.options).find(
                (candidate) => candidate.dataset.countryName?.toLowerCase() === orderData.country.toLowerCase()
            );
            if (!option) {
                option = document.createElement("option");
                option.value = savedCode || orderData.country;
                option.textContent = savedCode
                    ? `${orderData.country} (${savedCode})`
                    : orderData.country;
                option.dataset.countryName = orderData.country;
                countryField.appendChild(option);
            }
            countryField.value = option.value;
            countryLabel = option.textContent;
        } else {
            countryField.value = orderData.country;
        }
        const summaryCountry = document.querySelector("#summary-country");
        if (summaryCountry) summaryCountry.textContent = countryLabel;
    }

    if (form.termsConsent) {
        form.termsConsent.checked = Boolean(
            orderData.termsConsent
        );
    }
}
