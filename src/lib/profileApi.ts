import type { StudentProfile, AdvisorMessage, ActionItem, ConversationSummary } from "../types/profile";

const TIMEOUT_MS = 15_000; // 15 seconds for DB operations

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function createProfile(profile: StudentProfile): Promise<string> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "create", profile }),
  });

  if (!res.ok) throw new Error("Failed to create profile");
  const data = await res.json();
  return data.id;
}

export async function updateProfile(id: string, profile: StudentProfile): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "update", id, profile }),
  });

  if (!res.ok) throw new Error("Failed to update profile");
}

export async function loadProfile(id: string): Promise<StudentProfile | null> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "load", id }),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load profile");
  const data = await res.json();
  return data.profile;
}

export async function saveIdentifier(profileId: string, identifier: string): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "save-identifier", profileId, identifier }),
  });

  if (!res.ok) throw new Error("Failed to save identifier");
}

export async function lookupIdentifier(identifier: string): Promise<string | null> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "lookup-identifier", identifier }),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to look up identifier");
  const data = await res.json();
  return data.profileId;
}

export async function saveAdvisorMessages(profileId: string, messages: AdvisorMessage[], conversationId?: string): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "save-advisor-messages", profileId, messages, conversationId }),
  });

  if (!res.ok) throw new Error("Failed to save advisor messages");
}

export async function loadAdvisorMessages(profileId: string, conversationId?: string): Promise<AdvisorMessage[]> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "load-advisor-messages", profileId, conversationId }),
  });

  if (!res.ok) throw new Error("Failed to load advisor messages");
  const data = await res.json();
  return data.messages;
}

export async function listConversations(profileId: string): Promise<ConversationSummary[]> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "list-conversations", profileId }),
  });

  if (!res.ok) throw new Error("Failed to list conversations");
  const data = await res.json();
  return data.conversations;
}

export async function deleteConversation(profileId: string, conversationId: string): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "delete-conversation", profileId, conversationId }),
  });

  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function saveActionItems(profileId: string, items: ActionItem[]): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "save-action-items", profileId, items }),
  });

  if (!res.ok) throw new Error("Failed to save action items");
}

export async function loadActionItems(profileId: string): Promise<ActionItem[]> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "load-action-items", profileId }),
  });

  if (!res.ok) throw new Error("Failed to load action items");
  const data = await res.json();
  return data.items;
}

export async function updateActionItem(profileId: string, itemId: string, updates: { status?: string }): Promise<void> {
  const res = await fetchWithTimeout("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "update-action-item", profileId, itemId, updates }),
  });

  if (!res.ok) throw new Error("Failed to update action item");
}
