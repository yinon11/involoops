import { handlers } from "@/auth";

/** Drizzle + postgres TCP must run on Node; Edge cannot open DB connections. */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
