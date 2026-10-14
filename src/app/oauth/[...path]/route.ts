import { proxyToOidc } from "@/lib/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  return proxyToOidc(request);
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as DELETE,
  handle as OPTIONS,
};
