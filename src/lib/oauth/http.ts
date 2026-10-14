import { oauthConfigured, oauthIssuer } from "./config";
import { getOidcProvider, oidcListenPort } from "./provider";

/**
 * Public scheme and host from `AUTH_URL`. The Node request behind the proxy
 * often reports localhost, and oidc-provider copies that into absolute
 * redirects when `proxy` is enabled.
 */
function publicForwarding(): { proto: string; host: string } | null {
  const issuer = oauthIssuer();
  if (!issuer) return null;
  const url = new URL(issuer);
  return { proto: url.protocol.replace(":", ""), host: url.host };
}

/**
 * Forward a public request to the in-process oidc-provider listener.
 * The listener is bound to 127.0.0.1 only. `redirect: "manual"` keeps
 * 302 + Set-Cookie on the response the browser sees.
 */
export async function proxyToOidc(request: Request): Promise<Response> {
  if (!oauthConfigured()) {
    return Response.json(
      { error: "oauth_not_configured" },
      { status: 404 },
    );
  }
  const port = await oidcListenPort();
  const url = new URL(request.url);
  const target = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  const published = publicForwarding();
  const forwardedProto =
    published?.proto ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const forwardedHost =
    published?.host ||
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  headers.set("x-forwarded-proto", forwardedProto);
  headers.set("x-forwarded-host", forwardedHost);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Buffer.from(await request.arrayBuffer());
  }
  const upstream = await fetch(target, init);
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    out.append("set-cookie", cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

type HeaderBag = {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): void;
  getHeader(name: string): string | string[] | undefined;
  removeHeader(name: string): void;
  end(): void;
};

/**
 * Minimal Node req/res pair for `interactionDetails` / `interactionFinished`.
 * Those helpers only read the Cookie header and write status, Location, and
 * Set-Cookie — they do not need a live socket.
 */
export function interactionHttp(request: Request): {
  req: { method: string; url: string; headers: Record<string, string>; socket: Record<string, never> };
  res: HeaderBag;
  toResponse(): Response;
} {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const published = publicForwarding();
  if (published) {
    headers["x-forwarded-proto"] = published.proto;
    headers["x-forwarded-host"] = published.host;
  }
  const stored = new Map<string, string[]>();
  const res: HeaderBag = {
    statusCode: 200,
    setHeader(name, value) {
      stored.set(
        name.toLowerCase(),
        Array.isArray(value) ? value.map(String) : [String(value)],
      );
    },
    getHeader(name) {
      const list = stored.get(name.toLowerCase());
      if (!list) return undefined;
      return list.length === 1 ? list[0] : list;
    },
    removeHeader(name) {
      stored.delete(name.toLowerCase());
    },
    end() {},
  };
  return {
    req: {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers,
      socket: {},
    },
    res,
    toResponse() {
      const out = new Headers();
      for (const [key, values] of stored) {
        for (const value of values) out.append(key, value);
      }
      return new Response(null, { status: res.statusCode, headers: out });
    },
  };
}

export function getProviderOrThrow() {
  return getOidcProvider();
}
