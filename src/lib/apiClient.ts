import type { ParseRequest, FollowUpRequest, ParseResponse, FollowUpResponse } from "../types/profile";

export async function callApi(request: ParseRequest): Promise<ParseResponse>;
export async function callApi(request: FollowUpRequest): Promise<FollowUpResponse>;
export async function callApi(
  request: ParseRequest | FollowUpRequest
): Promise<ParseResponse | FollowUpResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `API error: ${response.status}`);
  }

  return response.json();
}
