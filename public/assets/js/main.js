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