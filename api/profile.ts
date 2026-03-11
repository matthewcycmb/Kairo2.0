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
const RATE_MAX_LOOKUP = 5; // identifier lookups per minute per IP
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

    if (type === "save-advisor-messages") {
      const { profileId, messages, conversationId } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages are required" });
      }

      const rows = messages.map((m: { id: string; role: string; content: string; analysis?: unknown; suggestions?: unknown; timestamp: string; conversationId?: string }) => ({
        id: m.id,
        profile_id: profileId,
        role: m.role,
        content: m.content,
        analysis: m.analysis || null,
        suggestions: m.suggestions || null,
        created_at: m.timestamp || new Date().toISOString(),
        conversation_id: m.conversationId || conversationId || null,
      }));

      const { error } = await supabase
        .from("advisor_messages")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.error("Supabase save messages error:", error);
        return res.status(500).json({ error: "Failed to save messages" });
      }

      return res.status(200).json({ ok: true });
    }

    if (type === "load-advisor-messages") {
      const { profileId, conversationId } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }

      let query = supabase
        .from("advisor_messages")
        .select("*")
        .eq("profile_id", profileId);

      if (conversationId) {
        if (typeof conversationId !== "string" || conversationId.length > 100) {
          return res.status(400).json({ error: "Invalid conversation ID" });
        }
        // Load a specific conversation
        query = query.eq("conversation_id", conversationId);
      } else {
        // Load the most recent conversation: find its conversation_id first
        const { data: latest } = await supabase
          .from("advisor_messages")
          .select("conversation_id")
          .eq("profile_id", profileId)
          .not("conversation_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        const latestConvId = latest?.[0]?.conversation_id;
        if (latestConvId) {
          query = query.eq("conversation_id", latestConvId);
        } else {
          // Legacy: load all messages that have no conversation_id
          query = query.is("conversation_id", null);
        }
      }

      const { data, error } = await query.order("created_at", { ascending: true });

      if (error) {
        console.error("Supabase load messages error:", error);
        return res.status(500).json({ error: "Failed to load messages" });
      }

      const messages = (data || []).map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.created_at,
        analysis: row.analysis || undefined,
        suggestions: row.suggestions || undefined,
        conversationId: row.conversation_id || undefined,
      }));

      return res.status(200).json({ messages });
    }

    if (type === "list-conversations") {
      const { profileId } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }

      // Get all messages grouped by conversation_id, ordered by most recent first
      const { data, error } = await supabase
        .from("advisor_messages")
        .select("conversation_id, role, content, created_at")
        .eq("profile_id", profileId)
        .not("conversation_id", "is", null)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Supabase list conversations error:", error);
        return res.status(500).json({ error: "Failed to list conversations" });
      }

      // Group by conversation_id and extract preview + timestamp
      const convMap = new Map<string, { preview: string; timestamp: string }>();
      for (const row of data || []) {
        const cid = row.conversation_id as string;
        if (!convMap.has(cid)) {
          convMap.set(cid, { preview: "", timestamp: row.created_at });
        }
        const entry = convMap.get(cid)!;
        // Use first assistant message as preview
        if (!entry.preview && row.role === "assistant") {
          entry.preview = (row.content as string)
            .replace(/[#*_~`>\-\[\]()!]/g, "")
            .replace(/\n+/g, " ")
            .trim()
            .slice(0, 120);
        }
        // Track latest timestamp
        entry.timestamp = row.created_at;
      }

      const conversations = Array.from(convMap.entries())
        .map(([id, { preview, timestamp }]) => ({
          id,
          preview: preview || "Conversation",
          timestamp,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return res.status(200).json({ conversations });
    }

    if (type === "delete-conversation") {
      const { profileId, conversationId } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (!conversationId || typeof conversationId !== "string" || conversationId.length > 100) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }

      const { error } = await supabase
        .from("advisor_messages")
        .delete()
        .eq("profile_id", profileId)
        .eq("conversation_id", conversationId);

      if (error) {
        console.error("Supabase delete conversation error:", error);
        return res.status(500).json({ error: "Failed to delete conversation" });
      }

      return res.status(200).json({ ok: true });
    }

    if (type === "save-action-items") {
      const { profileId, items } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Items are required" });
      }

      const rows = items.map((item: { id: string; action: string; gap: string; status: string; createdAt: string; completedAt?: string }) => ({
        id: item.id,
        profile_id: profileId,
        action: item.action,
        gap: item.gap,
        status: item.status,
        created_at: item.createdAt || new Date().toISOString(),
        completed_at: item.completedAt || null,
      }));

      const { error } = await supabase
        .from("advisor_action_items")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.error("Supabase save action items error:", error);
        return res.status(500).json({ error: "Failed to save action items" });
      }

      return res.status(200).json({ ok: true });
    }

    if (type === "load-action-items") {
      const { profileId } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }

      // Load pending + recently completed (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("advisor_action_items")
        .select("*")
        .eq("profile_id", profileId)
        .or(`status.eq.pending,completed_at.gte.${thirtyDaysAgo}`)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Supabase load action items error:", error);
        return res.status(500).json({ error: "Failed to load action items" });
      }

      const items = (data || []).map((row) => ({
        id: row.id,
        action: row.action,
        gap: row.gap,
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at || undefined,
      }));

      return res.status(200).json({ items });
    }

    if (type === "update-action-item") {
      const { profileId, itemId, updates } = body;
      if (!isValidUUID(profileId)) {
        return res.status(400).json({ error: "Invalid profile ID" });
      }
      if (!isValidUUID(itemId)) {
        return res.status(400).json({ error: "Invalid item ID" });
      }

      const updateData: Record<string, unknown> = {};
      if (updates.status) updateData.status = updates.status;
      if (updates.status === "completed") updateData.completed_at = new Date().toISOString();

      const { error } = await supabase
        .from("advisor_action_items")
        .update(updateData)
        .eq("id", itemId)
        .eq("profile_id", profileId);

      if (error) {
        console.error("Supabase update action item error:", error);
        return res.status(500).json({ error: "Failed to update action item" });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Invalid request type" });
  } catch (error) {
    console.error("Profile API error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
