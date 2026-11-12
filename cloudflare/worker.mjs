import { httpServerHandler } from "cloudflare:node";
import nexproxy from "../server.js";

const apiHandler = httpServerHandler(nexproxy.createServer({ serveStaticFiles: false }));

function isAdminPath(pathname) {
  return /^\/admin(?:\/|$)/i.test(pathname);
}

function injectLiveChat(request, response, env) {
  const pathname = new URL(request.url).pathname;
  const contentType = response.headers.get("content-type") || "";
  if (env.NEXPROXY_LIVE_CHAT_ENABLED !== "true") return response;
  if (
    request.method !== "GET" ||
    isAdminPath(pathname) ||
    response.status < 200 ||
    response.status >= 300 ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    return response;
  }

  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append('<link rel="stylesheet" href="/assets/css/live-chat.css">', { html: true });
      }
    })
    .on("body", {
      element(element) {
        element.append('<script src="/assets/js/live-chat.js" defer></script>', { html: true });
      }
    })
    .transform(response);
}

async function runSupportChatCleanup(env) {
  const cleanupUrl = env.SUPPORT_CHAT_CLEANUP_URL;
  const cleanupSecret = env.SUPPORT_CHAT_CLEANUP_SECRET;
  if (!cleanupUrl || !cleanupSecret) {
    console.warn("Support chat cleanup is not configured.");
    return;
  }

  try {
    const response = await fetch(cleanupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-support-chat-cleanup-secret": cleanupSecret
      },
      body: "{}"
    });
    const result = await response.json().catch(() => null);
    const countFields = ["tempPathsSwept", "pendingUploadsExpired", "finalFilesExpired", "tombstonesDeleted", "abandonedMessagesDeleted", "cleanupFailures", "blockedMessages"];
    const invalidCount = countFields.some((field) => !Number.isSafeInteger(result?.[field]) || result[field] < 0);
    if (!response.ok) {
      console.warn("Support chat cleanup returned a non-success response.");
    } else if (result?.success !== true || typeof result?.backlogPossible !== "boolean" || invalidCount) {
      console.warn("Support chat cleanup returned an incomplete response.");
    } else if (result.backlogPossible) {
      const cleanupFailures = Number.isSafeInteger(result.cleanupFailures) ? result.cleanupFailures : 0;
      const blockedMessages = Number.isSafeInteger(result.blockedMessages) ? result.blockedMessages : 0;
      console.warn(`Support chat cleanup has retryable backlog (failures=${cleanupFailures}, blocked=${blockedMessages}).`);
    }
  } catch (_) {
    console.warn("Support chat cleanup request failed.");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return apiHandler.fetch(request, env, ctx);
    }

    let response;
    if ((request.method === "GET" || request.method === "HEAD") && /^\/blog\/[a-z0-9-]+\/?$/i.test(url.pathname) && url.pathname !== "/blog/") {
      const templateUrl = new URL(request.url);
      templateUrl.pathname = "/blog/post";
      response = await env.ASSETS.fetch(new Request(templateUrl, request));
    } else {
      response = await env.ASSETS.fetch(request);
    }

    return injectLiveChat(request, response, env);
  },

  scheduled(controller, env, ctx) {
    if (env.SUPPORT_CHAT_CLEANUP_ENABLED !== "true") return;
    ctx.waitUntil(runSupportChatCleanup(env));
  }
};
