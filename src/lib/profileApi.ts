import type { StudentProfile } from "../types/profile";

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
