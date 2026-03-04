import type { ParseRequest, FollowUpRequest, ParseResponse, FollowUpResponse } from "../types/profile";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callApi(request: ParseRequest): Promise<ParseResponse>;
export async function callApi(request: FollowUpRequest): Promise<FollowUpResponse>;
export async function callApi(
  request: ParseRequest | FollowUpRequest
): Promise<ParseResponse | FollowUpResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      // Retry on 429 (rate limit) or 500+ (server error / timeout)
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `API error: ${response.status}`);
      }

      return response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Retry on network errors (timeout, connection refused)
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}
