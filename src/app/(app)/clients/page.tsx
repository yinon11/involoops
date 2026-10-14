import { redirect } from "next/navigation";

/**
 * `/clients` and `/customers` were the same page, duplicated only because the
 * expense sidebar and the Studio sidebar each wanted their own link. One nav,
 * one route: this is now an alias so existing links and bookmarks keep working.
 */
export default function ClientsAliasPage() {
  redirect("/customers");
}
