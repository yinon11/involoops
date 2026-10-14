import { auth } from "@/auth";
import { isScope } from "@/lib/api/scopes";
import { renderConsentPage, renderOauthMessage } from "@/lib/oauth/consent-page";
import { mcpResourceIndicator, oauthConfigured } from "@/lib/oauth/config";
import { interactionHttp } from "@/lib/oauth/http";
import { getOidcProvider } from "@/lib/oauth/provider";
import { getPublicAppOrigin } from "@/lib/public-app-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InteractionView = {
  uid: string;
  grantId?: string;
  prompt: { name: string };
  params: Record<string, unknown>;
  session?: { accountId?: string };
};

export async function GET(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  const { uid } = await context.params;
  return handleInteraction(request, uid, null);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  const { uid } = await context.params;
  const form = await request.formData();
  const decision = form.get("decision");
  return handleInteraction(
    request,
    uid,
    decision === "allow" || decision === "deny" ? decision : null,
  );
}

async function handleInteraction(
  request: Request,
  uid: string,
  decision: "allow" | "deny" | null,
): Promise<Response> {
  if (!oauthConfigured()) {
    return renderOauthMessage(
      "OAuth is not configured",
      "This server is not accepting connector sign-in yet.",
      404,
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !session.user.email) {
    const callback = `/oauth/interaction/${uid}`;
    // `request.url` is the in-container address (https://localhost:3000) behind
    // the reverse proxy. Basing the redirect on it sends the browser off the
    // public site, so the MCP consent login never completes.
    return Response.redirect(
      new URL(
        `/login?callbackUrl=${encodeURIComponent(callback)}`,
        getPublicAppOrigin(request),
      ),
      302,
    );
  }

  const provider = getOidcProvider();
  const http = interactionHttp(request);
  let details: InteractionView;
  try {
    details = (await provider.interactionDetails(
      http.req,
      http.res,
    )) as InteractionView;
  } catch {
    return renderOauthMessage(
      "Sign-in expired",
      "Start the connection again from Claude.",
    );
  }
  if (details.uid !== uid) {
    return renderOauthMessage(
      "Sign-in mismatch",
      "Start the connection again from Claude.",
    );
  }

  if (details.prompt.name === "login") {
    await provider.interactionFinished(http.req, http.res, {
      login: { accountId: userId },
    });
    return http.toResponse();
  }

  if (details.prompt.name !== "consent") {
    return renderOauthMessage(
      "Cannot continue",
      "This sign-in step is not supported. Start again from Claude.",
    );
  }

  if (decision === "deny") {
    await provider.interactionFinished(http.req, http.res, {
      error: "access_denied",
      error_description: "The account holder denied the request.",
    });
    return http.toResponse();
  }

  if (decision !== "allow") {
    const clientId = stringParam(details.params.client_id);
    const client = clientId ? await provider.Client.find(clientId) : undefined;
    const redirectUri = stringParam(details.params.redirect_uri);
    let redirectHost = "the application";
    if (redirectUri) {
      try {
        redirectHost = new URL(redirectUri).host;
      } catch {
        redirectHost = "the application";
      }
    }
    const scopes = requestedScopes(details.params.scope);
    return new Response(
      renderConsentPage({
        clientName: client?.clientName || "Claude",
        accountEmail: session.user.email,
        redirectHost,
        scopes,
        uid,
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const clientId = stringParam(details.params.client_id);
  if (!clientId) {
    return renderOauthMessage("Missing client", "Start again from Claude.");
  }
  const requested = requestedScopes(details.params.scope);
  // API scopes are advertised as authorization-server scopes (so Claude can
  // request them) and as resource scopes (so the access token carries them
  // for /api/mcp). Grant both or the consent prompt stays open.
  const oidcScopes = requested.filter(
    (scope) =>
      scope === "openid" || scope === "offline_access" || isScope(scope),
  );
  const resourceScopes = requested.filter((scope) => isScope(scope));
  const resource =
    stringParam(details.params.resource) || mcpResourceIndicator();

  // A later consent step must extend the grant from the earlier step.
  // Replacing it drops scopes already accepted, including offline_access.
  const existingId = details.grantId;
  const existing = existingId ? await provider.Grant.find(existingId) : undefined;
  const grant =
    existing && existing.accountId === userId
      ? existing
      : new provider.Grant({ accountId: userId, clientId });
  if (oidcScopes.length > 0) grant.addOIDCScope(oidcScopes.join(" "));
  if (resourceScopes.length > 0) {
    grant.addResourceScope(resource, resourceScopes.join(" "));
  }
  const grantId = await grant.save();
  // The grant belongs to the Auth.js user who clicked Allow. The OIDC
  // session may still be an earlier account; sending login lets
  // oidc-provider switch to this user before it checks the grant.
  // A mismatch there is an unexposed error ("oops! something went wrong").
  await provider.interactionFinished(http.req, http.res, {
    login: { accountId: userId },
    consent: { grantId },
  });
  return http.toResponse();
}

function stringParam(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function requestedScopes(value: unknown): string[] {
  const raw = stringParam(value) ?? "";
  return raw.split(" ").map((scope) => scope.trim()).filter(Boolean);
}
