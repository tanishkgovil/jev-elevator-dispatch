import { TypeSafeClient } from "@typesafe-ai/sdk";

// Server-side only: the client reads TYPESAFE_API_KEY from the environment.
// Jev's p95 is ~200ms, so a call still running at 1.2s is stuck: abort and
// retry quickly rather than waiting, and let callers fall back after that.
let client: TypeSafeClient | undefined;

export function jev(): TypeSafeClient {
  client ??= new TypeSafeClient({
    timeout: 1200,
    retry: { maxRetries: 2, backoffInitialMs: 50, backoffMaxMs: 200 },
  });
  return client;
}
