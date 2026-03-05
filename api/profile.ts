import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Rate limiting for writes/lookups ---
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CREATE = 5; // profile creates per minute per IP
const RATE_MAX_LOOKUP = 15; // identifier lookups per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRate(key: string, max: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetAt) rateLimitMap.delete(k);
  }
}, 300_000);

function getClientIp(req: VercelRequest): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
}

// --- Validation helpers ---
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDENTIFIER_LENGTH = 100;
const MAX_PROFILE_SIZE = 500_000; // 500KB

function isValidUUID(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    if (!body || typeof body.type !== "string") {
      return res.status(400).json({ error: "Invalid request" });
    }

    const ip = getClientIp(req);
    const { type } = body;

    if (type === "create") {
      if (!checkRate(`create:${ip}`, RATE_MAX_CREATE)) {
        return res.status(429).json({ error: "Too many requests" });
      }
      if (!body.profile || typeof body.profile !== "object") {
        return res.status(400).json({ error: "Profile data is required" });
      }
      if (JSON.stringify(body.profile).length > MAX_PROFILE_SIZE) {
        return res.status(400).json({ error: "Profile data too large" });
      }

      const id = crypto.randomUUID();
      const { error } = await supabase
        .from("profiles")
        .insert({ id, data: body.profile });

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ error: "Failed to create profile" });
      }

      return res.status(200).json({ id });
    }

    if (type === "update") {
      const { id, profile } = body;
      if (!isValidUUID(id)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (!profile || typeof profile !== "object") {
        return res.status(400).json({ error: "Profile data is required" });
      }
      if (JSON.stringify(profile).length > MAX_PROFILE_SIZE) {
        return res.status(400).json({ error: "Profile data too large" });
      }

      const { error } = await supabase
        .from("profiles")
        .upsert({ id, data: profile, updated_at: new Date().toISOString() });

      if (error) {
        console.error("Supabase upsert error:", error);
        return res.status(500).json({ error: "Failed to update profile" });
      }

      return res.status(200).json({ ok: true });
    }

    if (type === "load") {
      const { id } = body;
      if (!isValidUUID(id)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("data")
        .eq("id", id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Profile not found" });
      }

      return res.status(200).json({ profile: data.data });
    }

    if (type === "save-identifier") {
      const { profileId, identifier } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (typeof identifier !== "string" || identifier.trim().length === 0 || identifier.length > MAX_IDENTIFIER_LENGTH) {
        return res.status(400).json({ error: "Identifier must be 1-100 characters" });
      }

      const normalized = identifier.toLowerCase().replace(/^@/, "").trim();
      if (normalized.length === 0) {
        return res.status(400).json({ error: "Invalid identifier" });
      }

      const { error } = await supabase
        .from("profile_identifiers")
        .upsert(
          { profile_id: profileId, identifier: normalized },
          { onConflict: "identifier" }
        );

      if (error) {
        console.error("Supabase identifier upsert error:", error);
        return res.status(500).json({ error: "Failed to save identifier" });
      }

      return res.status(200).json({ ok: true });
    }

    if (type === "lookup-identifier") {
      if (!checkRate(`lookup:${ip}`, RATE_MAX_LOOKUP)) {
        return res.status(429).json({ error: "Too many lookups — please wait" });
      }
      const { identifier } = body;
      if (typeof identifier !== "string" || identifier.trim().length === 0 || identifier.length > MAX_IDENTIFIER_LENGTH) {
        return res.status(400).json({ error: "Invalid identifier" });
      }

      const normalized = identifier.toLowerCase().replace(/^@/, "").trim();

      const { data, error } = await supabase
        .from("profile_identifiers")
        .select("profile_id")
        .eq("identifier", normalized)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "No profile found for that identifier" });
      }

      return res.status(200).json({ profileId: data.profile_id });
    }

    return res.status(400).json({ error: "Invalid request type" });
  } catch (error) {
    console.error("Profile API error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
