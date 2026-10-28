"use strict";

document.addEventListener("DOMContentLoaded", () => {
    initPaymentPage();
});

/**
 * Initialize the payment page.
 */
async function initPaymentPage() {
    const orderData = getStoredOrder();

    if (!orderData) {
        redirectToOrderForm();
        return;
    }

    ensurePaymentState(orderData);

    const paymentSettings = await loadPaymentSettings();

    populatePaymentSummary(
        orderData,
        paymentSettings
    );

}

/**
 * Retrieve the saved order from sessionStorage.
 */
function getStoredOrder() {
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
 * Load the currently active payment settings
 * from the NexProxy backend.
 */
async function loadPaymentSettings() {
    const supabasePublishableKey =
        window.NEXPROXY_SUPABASE_PUBLISHABLE_KEY;

    if (!supabasePublishableKey) {
        console.error(
            "Supabase configuration is unavailable."
        );

        return [];
    }

    try {
        const response = await fetch(
            "https://fzvxuhumtebqlpwqpkvt.supabase.co/functions/v1/dynamic-action",
            {
                method: "POST",
                headers: {
                    "apikey": supabasePublishableKey,
                    "Authorization":
                        `Bearer ${supabasePublishableKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    action: "get_payment_settings"
                })
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result?.error ||
                "Unable to load payment settings."
            );
        }

        return Array.isArray(result.paymentSettings)
            ? result.paymentSettings
            : [];

    } catch (error) {
        console.error(
            "Unable to load payment settings.",
            error
        );

        return [];
    }
}

/**
 * Upload an optional payment screenshot.
 */
async function uploadPaymentProof(
    orderData,
    file,
    supabasePublishableKey
) {
    if (!file) {
        return null;
    }

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    const maxFileSize = 5 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
        throw new Error(
            "Payment screenshot must be JPG, PNG, or WEBP."
        );
    }

    if (file.size > maxFileSize) {
        throw new Error(
            "Payment screenshot must be 5 MB or smaller."
        );
    }

    const formData = new FormData();

    formData.append(
        "action",
        "upload_payment_proof"
    );

    formData.append(
        "orderId",
        orderData.orderId
    );

    formData.append(
        "email",
        orderData.email
    );

    formData.append(
        "file",
        file
    );

    const response = await fetch(
        "https://fzvxuhumtebqlpwqpkvt.supabase.co/functions/v1/dynamic-action",
        {
            method: "POST",
            headers: {
                "apikey":
                    supabasePublishableKey,

                "Authorization":
                    `Bearer ${supabasePublishableKey}`
            },
            body: formData
        }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
        throw new Error(
            result?.error ||
            "Unable to upload the payment screenshot."
        );
    }

    return result.proof || null;
}

/**
 * Initialize the payment submission form.
 */
function initPaymentForm(orderData) {
    const paymentForm =
        document.querySelector("#payment-form");

    if (!paymentForm) {
        return;
    }

    // Prevent duplicate event listeners after UI re-render.
    if (paymentForm.dataset.nexproxyBound === "true") {
        return;
    }

    paymentForm.dataset.nexproxyBound = "true";

    // Do not allow another payment submission after submission/verification.
    if (
        orderData.paymentStatus === "PAYMENT_SUBMITTED" ||
        orderData.paymentStatus === "PAYMENT_VERIFIED"
    ) {
        paymentForm
            .querySelectorAll("input, button")
            .forEach((element) => {
                element.disabled = true;
            });

        return;
    }

    paymentForm.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            const paymentMethod =
                paymentForm.paymentMethod.value.trim();

            const paymentReference =
                paymentForm.paymentReference.value.trim();

            const screenshotInput =
                document.querySelector(
                    "#payment-screenshot"
                );

            const screenshotFile =
                screenshotInput?.files?.[0] || null;

            const submitButton =
                document.querySelector(
                    "#submit-payment"
                );

            const message =
                document.querySelector(
                    "#payment-form-message"
                );

            if (
                !paymentMethod ||
                !paymentReference
            ) {
                if (message) {
                    message.textContent =
                        "Please enter your transaction ID / TXID.";
                }

                return;
            }

            // Prevent double-click / duplicate submission.
            if (paymentForm.dataset.submitting === "true") {
                return;
            }

            paymentForm.dataset.submitting = "true";

            if (submitButton) {
                submitButton.disabled = true;

                submitButton.setAttribute(
                    "aria-busy",
                    "true"
                );
            }

            try {
                const supabasePublishableKey =
                    window
                        .NEXPROXY_SUPABASE_PUBLISHABLE_KEY;

                if (!supabasePublishableKey) {
                    throw new Error(
                        "Supabase configuration is unavailable."
                    );
                }

                /*
                 * --------------------------------------------------
                 * OPTIONAL PAYMENT SCREENSHOT
                 * --------------------------------------------------
                 */

                let paymentProof = null;

                if (screenshotFile) {
                    if (message) {
                        message.textContent =
                            "Uploading your payment screenshot...";
                    }

                    paymentProof =
                        await uploadPaymentProof(
                            orderData,
                            screenshotFile,
                            supabasePublishableKey
                        );
                }

                /*
                 * --------------------------------------------------
                 * SUBMIT PAYMENT
                 * --------------------------------------------------
                 */

                if (message) {
                    message.textContent =
                        "Submitting your payment information...";
                }

                const response = await fetch(
                    "https://fzvxuhumtebqlpwqpkvt.supabase.co/functions/v1/dynamic-action",
                    {
                        method: "POST",

                        headers: {
                            "apikey":
                                supabasePublishableKey,

                            "Authorization":
                                `Bearer ${supabasePublishableKey}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            action:
                                "submit_payment",

                            orderId:
                                orderData.orderId,

                            email:
                                orderData.email,

                            paymentMethod,

                            paymentReference
                        })
                    }
                );

                const result =
                    await response.json();

                if (
                    !response.ok ||
                    !result.success
                ) {
                    throw new Error(
                        result?.error ||
                        "Unable to submit your payment."
                    );
                }

                /*
                 * --------------------------------------------------
                 * UPDATE LOCAL PAYMENT STATE
                 * --------------------------------------------------
                 */

                updatePaymentState(
                    orderData,
                    "PAYMENT_SUBMITTED"
                );

                orderData.paymentMethod =
                    paymentMethod;

                orderData.paymentReference =
                    paymentReference;

                orderData.paymentSubmittedAt =
                    new Date().toISOString();

                /*
                 * Store the proof ID locally when
                 * a screenshot was uploaded.
                 */

                if (paymentProof?.id) {
                    orderData.paymentProofId =
                        paymentProof.id;
                }

                sessionStorage.setItem(
                    "nexproxyOrder",
                    JSON.stringify(orderData)
                );

                paymentForm.dataset.submitting = "false";

                populatePaymentSummary(
                    orderData
                );

            } catch (error) {
                console.error(
                    "Unable to submit payment.",
                    error
                );

                if (message) {
                    message.textContent =
                        error?.message ||
                        "We could not submit your payment right now. Please try again.";
                }

                if (submitButton) {
                    submitButton.disabled =
                        false;

                    submitButton.removeAttribute(
                        "aria-busy"
                    );
                }

                paymentForm.dataset.submitting = "false";
            }
        }
    );
}


/**
 * Ensure the order has the payment and fulfillment fields
 * required by the order lifecycle.
 */

function ensurePaymentState(orderData) {
    let changed = false;

    if (!orderData.paymentMethod) {
        orderData.paymentMethod = "PENDING";
        changed = true;
    }

    if (!orderData.paymentStatus) {
        orderData.paymentStatus = Number(orderData.planPrice) === 0
            ? "NO_PAYMENT_REQUIRED"
            : "UNPAID";
        changed = true;
    }

    if (!orderData.paymentReference) {
        orderData.paymentReference = "";
        changed = true;
    }

    if (!orderData.paymentSubmittedAt) {
        orderData.paymentSubmittedAt = "";
        changed = true;
    }

    if (!orderData.orderStatus) {
        orderData.orderStatus = "PENDING_PAYMENT";
        changed = true;
    }

    if (!orderData.fulfillment) {
        orderData.fulfillment = {
            status: "NOT_ASSIGNED",
            proxyAssigned: false,
            deliveryMethod: "",
            assignedAt: "",
            deliveredAt: ""
        };
        changed = true;
    }

    if (changed) {
        sessionStorage.setItem(
            "nexproxyOrder",
            JSON.stringify(orderData)
        );
    }
}

/**
 * Redirect visitors back to the order form.
 */
function redirectToOrderForm() {
    window.location.href = "../order/";
}

/**
 * Populate the payment summary.
 */
/**
 * Populate the payment summary and current payment state.
 */

/**
 * Populate the payment summary and current payment state.
 */
function populatePaymentSummary(
    orderData,
    paymentSettings = []
) {
    const orderId =
        document.querySelector("#payment-order-id");

    const plan =
        document.querySelector("#payment-plan");

    const price =
        document.querySelector("#payment-price");

    const statusValue =
        document.querySelector("#payment-status-value");

    const statusMessage =
        document.querySelector("#payment-status-message");

    const paymentAction =
        document.querySelector("#payment-action");

    const cryptoNotice =
        document.querySelector("#payment-crypto-notice");

    if (orderId) {
        orderId.textContent =
            orderData.orderId || "—";
    }

    if (plan) {
        plan.textContent =
            orderData.planName || "—";
    }

    if (price) {
        price.textContent =
            formatPrice(orderData.planPrice);
    }

    if (statusValue) {
        statusValue.textContent =
            getPaymentStatusLabel(
                orderData.paymentStatus
            );
    }

    if (statusMessage) {
        statusMessage.textContent =
            getPaymentStatusMessage(
                orderData.paymentStatus
            );
    }

    if (paymentAction) {
        paymentAction.innerHTML =
            getPaymentActionMarkup(
                orderData.paymentStatus,
                orderData,
                paymentSettings
            );
    }

    if (cryptoNotice) {
        cryptoNotice.hidden = orderData.paymentStatus === "NO_PAYMENT_REQUIRED";
    }

    initPaymentInstructionControls();
    initPaymentForm(orderData);
}


/**
 * Return a customer-friendly payment status label.
 */
function getPaymentStatusLabel(paymentStatus) {
    switch (paymentStatus) {
        case "NO_PAYMENT_REQUIRED":
            return "No payment required";

        case "PAYMENT_SUBMITTED":
            return "Payment Submitted";

        case "PAYMENT_VERIFIED":
            return "Payment Verified";

        case "UNPAID":
        default:
            return "Awaiting Payment";
    }
}

/**
 * Return a customer-friendly payment status message.
 */
function getPaymentStatusMessage(paymentStatus) {
    switch (paymentStatus) {
        case "NO_PAYMENT_REQUIRED":
            return "Your free trial order has been submitted. No payment is required for this 10-minute trial.";

        case "PAYMENT_SUBMITTED":
            return "Your payment information has been submitted and is waiting for verification.";

        case "PAYMENT_VERIFIED":
            return "Your payment has been verified. We are preparing your proxy.";

        case "UNPAID":
        default:
            return "Your order is ready for payment. Payment instructions will appear here when an approved payment method is available.";
    }
}

/**
 * Return the appropriate payment action markup.
 */

/**
 * Return the appropriate payment action markup.
 */

function getPaymentActionMarkup(
    paymentStatus,
    orderData,
    paymentSettings = []
) {
    switch (paymentStatus) {
        case "NO_PAYMENT_REQUIRED":
            return `
                <p class="payment-help-text">
                    No payment is required. Our team can now review and prepare your free trial access.
                </p>
            `;

        case "PAYMENT_SUBMITTED":
            return `
                <p class="payment-help-text">
                    We are reviewing your payment.
                    Please keep your Order ID for reference.
                </p>
            `;

        case "PAYMENT_VERIFIED":
            return `
                <p class="payment-help-text">
                    Your order has moved to fulfillment.
                </p>
            `;

        case "UNPAID":
        default: {
            const activeSettings =
                paymentSettings.find(
                    (setting) =>
                        setting.payment_method === "USDT" &&
                        setting.network === "TRC20" &&
                        setting.enabled === true
                );

            if (!activeSettings) {
                return `
                    <p class="payment-help-text">
                        Payment instructions are temporarily unavailable.
                        Please contact support.
                    </p>
                `;
            }

            const walletAddress =
                activeSettings.wallet_address;

            const amount =
                formatPrice(orderData.planPrice);

            return `
                <div class="payment-instructions">

                    <button
                        type="button"
                        class="btn btn-primary"
                        id="continue-to-payment"
                    >
                        Continue to Payment
                    </button>

                    <div
                        id="payment-details"
                        style="display: none;"
                    >

                        <div class="payment-summary">

                            <p>
                                <strong>Payment Method:</strong>
                                USDT
                            </p>

                            <p>
                                <strong>Network:</strong>
                                TRC20
                            </p>

                            <p>
                                <strong>Amount:</strong>
                                ${amount}
                            </p>

                            <p>
                                <strong>Receiving Address:</strong>
                            </p>

                            <div class="payment-wallet-address">
                                <code id="payment-wallet-address">
                                    ${walletAddress}
                                </code>

                                <button
                                    type="button"
                                    class="btn btn-secondary"
                                    id="copy-wallet-address"
                                >
                                    Copy Address
                                </button>
                            </div>

                            <p class="payment-help-text">
                                Send the exact amount to the
                                USDT TRC20 address above.
                            </p>

                        </div>

                        <form id="payment-form">

                            <div class="form-group">

                                <label for="payment-reference">
                                    Transaction ID / TXID
                                </label>

                                <input
                                    type="text"
                                    id="payment-reference"
                                    name="paymentReference"
                                    placeholder="Enter your transaction ID / TXID"
                                    required
                                >

                            </div>

                            <div class="form-group">

                                <label for="payment-screenshot">
                                    Payment Screenshot
                                    <span class="payment-optional">
                                        (Optional)
                                    </span>
                                </label>

                                <input
                                    type="file"
                                    id="payment-screenshot"
                                    name="paymentScreenshot"
                                    accept="image/jpeg,image/png,image/webp"
                                >

                                <p class="payment-help-text">
                                    You may upload a screenshot to help us
                                    verify your payment faster.
                                    JPG, PNG, or WEBP up to 5 MB.
                                </p>

                            </div>

                            <input
                                type="hidden"
                                name="paymentMethod"
                                value="USDT"
                            >

                            <button
                                type="submit"
                                class="btn btn-primary"
                                id="submit-payment"
                            >
                                Submit Payment
                            </button>

                            <p
                                id="payment-form-message"
                                class="payment-help-text"
                                aria-live="polite"
                            ></p>

                        </form>

                    </div>

                </div>
            `;
        }
    }
}

/**
 * Initialize payment instruction controls.
 */
function initPaymentInstructionControls() {
    const continueButton =
        document.querySelector(
            "#continue-to-payment"
        );

    const paymentDetails =
        document.querySelector(
            "#payment-details"
        );

    const copyButton =
        document.querySelector(
            "#copy-wallet-address"
        );

    const walletAddress =
        document.querySelector(
            "#payment-wallet-address"
        );

    if (continueButton && paymentDetails) {
        continueButton.addEventListener(
            "click",
            () => {
                paymentDetails.style.display =
                    "block";

                continueButton.style.display =
                    "none";

                const statusMessage =
                    document.querySelector(
                        "#payment-status-message"
                    );

                if (statusMessage) {
                    statusMessage.textContent =
                        "Payment instructions are now available below. Send the exact amount to the provided wallet address, then submit your transaction ID.";
                }
            }
        );
    }

    if (
        copyButton &&
        walletAddress
    ) {
        copyButton.addEventListener(
            "click",
            async () => {
                try {
                    await navigator.clipboard.writeText(
                        walletAddress.textContent.trim()
                    );

                    copyButton.textContent =
                        "Copied";

                    setTimeout(() => {
                        copyButton.textContent =
                            "Copy Address";
                    }, 2000);

                } catch (error) {
                    console.error(
                        "Unable to copy wallet address.",
                        error
                    );
                }
            }
        );
    }
}

/**
 * Update and persist the payment state for the current order.
 */
function updatePaymentState(orderData, paymentStatus) {
    orderData.paymentStatus = paymentStatus;

    switch (paymentStatus) {
        case "PAYMENT_SUBMITTED":
            orderData.orderStatus = "PENDING_PAYMENT";
            break;

        case "PAYMENT_VERIFIED":
            orderData.orderStatus = "PROCESSING";
            break;

        case "UNPAID":
        default:
            orderData.orderStatus = "PENDING_PAYMENT";
            break;
    }

    sessionStorage.setItem(
        "nexproxyOrder",
        JSON.stringify(orderData)
    );

    return orderData;
}



/**
 * Update and persist the fulfillment state for the current order.
 */
function updateFulfillmentState(orderData, fulfillmentStatus) {
    if (!orderData.fulfillment) {
        orderData.fulfillment = {
            status: "NOT_ASSIGNED",
            proxyAssigned: false,
            deliveryMethod: "",
            assignedAt: "",
            deliveredAt: ""
        };
    }

    orderData.fulfillment.status = fulfillmentStatus;

    switch (fulfillmentStatus) {
        case "ASSIGNED":
            orderData.fulfillment.proxyAssigned = true;
            orderData.orderStatus = "PROXY_ASSIGNED";

            if (!orderData.fulfillment.assignedAt) {
                orderData.fulfillment.assignedAt =
                    new Date().toISOString();
            }
            break;

        case "DELIVERED":
            orderData.fulfillment.proxyAssigned = true;
            orderData.orderStatus = "DELIVERED";

            if (!orderData.fulfillment.deliveredAt) {
                orderData.fulfillment.deliveredAt =
                    new Date().toISOString();
            }
            break;

        case "NOT_ASSIGNED":
        default:
            orderData.fulfillment.status = "NOT_ASSIGNED";
            orderData.fulfillment.proxyAssigned = false;
            orderData.orderStatus = "PROCESSING";
            break;
    }

    sessionStorage.setItem(
        "nexproxyOrder",
        JSON.stringify(orderData)
    );

    return orderData;
}


/**
 * Set and persist the delivery method for the current order.
 */
function setDeliveryMethod(orderData, deliveryMethod) {
    const normalizedMethod = String(deliveryMethod)
        .trim()
        .toUpperCase();

    if (!["TELEGRAM", "EMAIL"].includes(normalizedMethod)) {
        return orderData;
    }

    if (!orderData.fulfillment) {
        orderData.fulfillment = {
            status: "NOT_ASSIGNED",
            proxyAssigned: false,
            deliveryMethod: "",
            assignedAt: "",
            deliveredAt: ""
        };
    }

    orderData.fulfillment.deliveryMethod = normalizedMethod;

    sessionStorage.setItem(
        "nexproxyOrder",
        JSON.stringify(orderData)
    );

    return orderData;
}

/**
 * Format the order price for display.
 */
function formatPrice(price) {
    if (!price || price === "custom") {
        return "Custom";
    }

    return `$${price}`;
}
