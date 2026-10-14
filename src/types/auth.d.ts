import type { DefaultSession } from "next-auth";

/** One entry in the current user's "accounts you can switch into" list. */
export type LinkedAccount = {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
};

/**
 * The account that initiated the current switched session. Null means the user
 * logged in directly. When set, the avatar menu offers a "Switch back" action
 * and the user is considered to be acting-as the current `sub`.
 */
export type SessionOriginator = {
  id: string;
  email: string;
  name: string | null;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyName: string | null;
      isAdmin: boolean;
      linkedAccounts: LinkedAccount[];
      originator: SessionOriginator | null;
      /**
       * True when the current acting-as session is "locked" to the originator
       * (owner): the owner enabled "Sign in directly to my account" for this
       * member and the member is a dedicated sub-user (single link, not
       * opted-out, not admin). While locked, the member cannot switch back to
       * their own account — they always stay inside the owner's account.
       * Always false when not acting-as.
       */
      originatorLocked: boolean;
      /**
       * The user's saved UI locale, or `null` if they have not made an
       * explicit choice yet (the resolver falls back to geo / Accept-Language).
       */
      preferredLocale: string | null;
      /**
       * Capability codes the user holds while acting-as another account.
       * `null` means the user is on their own account (full access — owners
       * are not capability-gated) or is acting-as via admin impersonation.
       * An array (possibly empty) means the user is a sub-user; the array
       * is the exact set of permissions the owner granted them. Empty
       * array = no permissions, deny everything.
       */
      actingAsCapabilities: string[] | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    companyName?: string | null;
    isAdmin?: boolean;
    linkedAccounts?: LinkedAccount[];
    originator?: SessionOriginator | null;
    /** See Session.user.originatorLocked. */
    originatorLocked?: boolean;
    preferredLocale?: string | null;
    /** ms timestamp of the last DB-backed profile refresh (role, company, …). */
    refreshedAt?: number;
    /** See Session.user.actingAsCapabilities. */
    actingAsCapabilities?: string[] | null;
  }
}
