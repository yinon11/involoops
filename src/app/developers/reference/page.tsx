import { permanentRedirect } from "next/navigation";
import { ROUTE_PATHS } from "../_components/_routes";

/**
 * `/developers/reference` previously hosted the Scalar renderer. We replaced
 * it with Swagger UI at `/developers/swagger`, so this route 308-redirects
 * for any external bookmarks that still point here.
 *
 * Hash fragments (`#tag/...`) are NOT forwarded — they're client-side and
 * the new renderer uses a different anchor scheme. That's acceptable for
 * the small audience this URL has so far.
 */
export default function ReferenceRedirect() {
  permanentRedirect(ROUTE_PATHS.swagger);
}
