import type { ParseRequest, FollowUpRequest, ParseResponse, FollowUpResponse, ExpandRequest, ExpandResponse, ExpandAnswerRequest, ExpandAnswerResponse, AdvisorRequest, AdvisorResponse, AppHelperRequest, AppHelperResponse, StrategyGuideRequest, StrategyGuideResponse, StrategyAORequest, StrategyAOResponse, QuickInsightRequest, QuickInsightResponse } from "../types/profile";

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 45_000; // 45 seconds

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

type ApiRequest = ParseRequest | FollowUpRequest | ExpandRequest | ExpandAnswerRequest | AdvisorRequest | AppHelperRequest | StrategyGuideRequest | StrategyAORequest | QuickInsightRequest;
type ApiResponse = ParseResponse | FollowUpResponse | ExpandResponse | ExpandAnswerResponse | AdvisorResponse | AppHelperResponse | StrategyGuideResponse | StrategyAOResponse | QuickInsightResponse;

export async function callApi(request: ParseRequest): Promise<ParseResponse>;
export async function callApi(request: FollowUpRequest): Promise<FollowUpResponse>;
export async function callApi(request: ExpandRequest): Promise<ExpandResponse>;
export async function callApi(request: ExpandAnswerRequest): Promise<ExpandAnswerResponse>;
export async function callApi(request: AdvisorRequest): Promise<AdvisorResponse>;
export async function callApi(request: AppHelperRequest): Promise<AppHelperResponse>;
export async function callApi(request: StrategyGuideRequest): Promise<StrategyGuideResponse>;
export async function callApi(request: StrategyAORequest): Promise<StrategyAOResponse>;
export async function callApi(request: QuickInsightRequest): Promise<QuickInsightResponse>;
export async function callApi(request: ApiRequest): Promise<ApiResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }, FETCH_TIMEOUT_MS);

      // Only retry on 429 or 5xx (transient errors), not 4xx (permanent)
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        let errorText: string;
        try {
          const json = await response.json();
          errorText = json.error || `Request failed (${response.status})`;
        } catch {
          errorText = `Request failed (${response.status})`;
        }
        throw new Error(errorText);
      }

      return response.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error("Request timed out — please try again");
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      // Only retry on network errors or timeouts, not on user-facing errors
      if (attempt < MAX_RETRIES && (lastError.message.includes("timed out") || lastError.message.includes("fetch"))) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Request failed after retries");
}
