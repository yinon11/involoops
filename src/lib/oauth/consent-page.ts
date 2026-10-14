import { SCOPE_LABELS } from "./config";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function renderConsentPage(input: {
  clientName: string;
  accountEmail: string;
  redirectHost: string;
  scopes: string[];
  uid: string;
}): string {
  const local =
    input.redirectHost === "localhost" ||
    input.redirectHost.startsWith("127.0.0.1");
  const items = input.scopes
    .map((scope) => {
      const label = SCOPE_LABELS[scope] ?? scope;
      return `<li>${escapeHtml(label)}</li>`;
    })
    .join("");
  const warning = local
    ? `<p class="warn">This sign-in returns to ${escapeHtml(input.redirectHost)} on this computer. Continue only if you started it.</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect ${escapeHtml(input.clientName)} — InvoLoops</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
    main { max-width: 32rem; margin: 4rem auto; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 1.75rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { line-height: 1.5; color: #3f3f46; }
    ul { padding-left: 1.2rem; }
    li { margin: 0.35rem 0; }
    .host { font-weight: 600; color: #18181b; }
    .warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 0.75rem; color: #9a3412; }
    form { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.5rem; }
    button { font: inherit; border-radius: 8px; padding: 0.55rem 1rem; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: default; }
    .allow { background: #4f46e5; color: #fff; border: 0; }
    .deny { background: #fff; border: 1px solid #d4d4d8; }
    .who { font-size: 0.875rem; }
    .status { flex-basis: 100%; margin: 0.25rem 0 0; font-size: 0.875rem; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(input.clientName)} wants to access InvoLoops</h1>
    <p class="who">Signed in as ${escapeHtml(input.accountEmail)}</p>
    <p>${escapeHtml(input.clientName)} is asking to:</p>
    <ul>${items}</ul>
    <p>After you allow this, you will be sent back to <span class="host">${escapeHtml(input.redirectHost)}</span>.</p>
    ${warning}
    <form method="post" action="/oauth/interaction/${escapeHtml(input.uid)}">
      <input type="hidden" data-decision value="" />
      <button class="allow" type="submit" name="decision" value="allow">Allow</button>
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <p class="status" hidden>Connecting…</p>
    </form>
    <script>
      const form = document.querySelector("form");
      form.addEventListener("submit", (event) => {
        if (form.dataset.submitted === "1") {
          event.preventDefault();
          return;
        }
        form.dataset.submitted = "1";
        const chosen = event.submitter && event.submitter.value;
        const hidden = form.querySelector("[data-decision]");
        if (chosen && hidden) {
          hidden.name = "decision";
          hidden.value = chosen;
        }
        const status = form.querySelector(".status");
        if (status) status.hidden = false;
        for (const button of form.querySelectorAll("button")) button.disabled = true;
      });
    </script>
  </main>
</body>
</html>`;
}

export function renderOauthMessage(title: string, detail: string, status = 400): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto;">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(detail)}</p>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
