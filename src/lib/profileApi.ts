import type { StudentProfile } from "../types/profile";

export async function createProfile(profile: StudentProfile): Promise<string> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "create", profile }),
  });

  if (!res.ok) throw new Error("Failed to create profile");
  const data = await res.json();
  return data.id;
}

export async function updateProfile(id: string, profile: StudentProfile): Promise<void> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "update", id, profile }),
  });

  if (!res.ok) throw new Error("Failed to update profile");
}

export async function loadProfile(id: string): Promise<StudentProfile | null> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "load", id }),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to load profile");
  const data = await res.json();
  return data.profile;
}
