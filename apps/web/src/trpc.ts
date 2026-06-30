import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@limon/api/router";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});
