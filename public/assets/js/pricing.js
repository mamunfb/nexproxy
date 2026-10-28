"use strict";

(function initializePricingModule() {
    const FIXED_PLANS = {
        trial: { name: "Free Trial", price: 0, regularPrice: 0, discount: 0, quantity: 0 },
        starter: { name: "Starter", price: 25, regularPrice: 120, discount: 79.17, quantity: 1 },
        growth: { name: "Growth", price: 100, regularPrice: 720, discount: 86.11, quantity: 6 },
        professional: { name: "Professional", price: 200, regularPrice: 1800, discount: 88.89, quantity: 15 },
        business: { name: "Business", price: 300, regularPrice: 3000, discount: 90, quantity: 25 }
    };

    function calculateCustomPricing(rawQuantity) {
        const quantity = Math.min(100, Math.max(1, Number.parseInt(rawQuantity, 10) || 1));
        let perProxyPrice;
        let tier;

        if (quantity <= 5) {
            perProxyPrice = 25;
            tier = "Starter rate";
        } else if (quantity <= 14) {
            perProxyPrice = 100 / 6;
            tier = "Growth rate";
        } else if (quantity <= 24) {
            perProxyPrice = 200 / 15;
            tier = "Professional rate";
        } else if (quantity === 25) {
            perProxyPrice = 300 / 25;
            tier = "Business rate";
        } else {
            const additionalBlocks = Math.floor((quantity - 25) / 5);
            perProxyPrice = Math.max(10, 12 * (0.98 ** additionalBlocks));
            tier = additionalBlocks > 0 ? `${additionalBlocks} compounded discount block${additionalBlocks === 1 ? "" : "s"}` : "Above-25 starting rate";
        }

        const regularPrice = quantity * 120;
        const totalPrice = quantity * perProxyPrice;
        const savings = regularPrice - totalPrice;
        const discountPercent = regularPrice ? (savings / regularPrice) * 100 : 0;

        return {
            quantity,
            perProxyPrice,
            regularPrice,
            totalPrice,
            savings,
            discountPercent,
            tier
        };
    }

    function formatCurrency(value) {
        return `$${Number(value).toFixed(2)}`;
    }

    function populateQuantitySelect(select, selectedValue = 1) {
        if (!select) return;
        const selected = Math.min(100, Math.max(1, Number.parseInt(selectedValue, 10) || 1));
        select.innerHTML = "";
        for (let quantity = 1; quantity <= 100; quantity += 1) {
            const option = document.createElement("option");
            option.value = String(quantity);
            option.textContent = `${quantity} ${quantity === 1 ? "proxy" : "proxies"}`;
            option.selected = quantity === selected;
            select.appendChild(option);
        }
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function updateHomepageCustomPricing(quantity) {
        const pricing = calculateCustomPricing(quantity);
        setText("custom-total-price", formatCurrency(pricing.totalPrice));
        setText("custom-regular-price", `${formatCurrency(pricing.regularPrice)}/month regular`);
        setText("custom-discount", `${pricing.discountPercent.toFixed(2)}% off`);
        setText("custom-savings", `${formatCurrency(pricing.savings)} saved/month`);
        setText("custom-per-proxy", `${formatCurrency(pricing.perProxyPrice)} per proxy`);

        const customCta = document.getElementById("custom-pricing-cta");
        if (customCta) customCta.href = `./order/?plan=custom&quantity=${pricing.quantity}`;
    }

    function initPricingControls() {
        const homepageQuantity = document.getElementById("custom-quantity");
        if (homepageQuantity) {
            populateQuantitySelect(homepageQuantity, homepageQuantity.dataset.selected || 1);
            updateHomepageCustomPricing(homepageQuantity.value);
            homepageQuantity.addEventListener("change", () => updateHomepageCustomPricing(homepageQuantity.value));
        }

        const orderQuantity = document.getElementById("order-custom-quantity");
        if (orderQuantity) populateQuantitySelect(orderQuantity, orderQuantity.dataset.selected || 1);
    }

    window.NexProxyPricing = {
        FIXED_PLANS,
        calculateCustomPricing,
        formatCurrency,
        populateQuantitySelect
    };

    document.addEventListener("DOMContentLoaded", initPricingControls);
})();
