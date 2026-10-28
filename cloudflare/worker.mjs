import { httpServerHandler } from "cloudflare:node";
import nexproxy from "../server.js";

const apiHandler = httpServerHandler(nexproxy.createServer({ serveStaticFiles: false }));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return apiHandler.fetch(request, env, ctx);
    }

    if ((request.method === "GET" || request.method === "HEAD") && /^\/blog\/[a-z0-9-]+\/?$/i.test(url.pathname) && url.pathname !== "/blog/") {
      const templateUrl = new URL(request.url);
      templateUrl.pathname = "/blog/post";
      return env.ASSETS.fetch(new Request(templateUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
