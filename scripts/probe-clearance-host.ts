/**
 * CLI wrapper for `probeShaamClearance` (ops / sandbox debugging).
 *
 *   ENTITY_ID=<uuid> npx tsx scripts/probe-clearance-host.ts
 */
import { probeShaamClearance } from "@/lib/shaam/probe-clearance";

const entityId = process.env.ENTITY_ID?.trim();
if (!entityId) {
  console.error("Set ENTITY_ID to a business_entities.id");
  process.exit(1);
}

probeShaamClearance({ businessEntityId: entityId, environment: "UAT" })
  .then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
