import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const { type } = req.body;

    if (type === "create") {
      const id = crypto.randomUUID();
      const { error } = await supabase
        .from("profiles")
        .insert({ id, data: req.body.profile });

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ error: "Failed to create profile" });
      }

      return res.status(200).json({ id });
    }

    if (type === "update") {
      const { id, profile } = req.body;
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
      const { id } = req.body;
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

    return res.status(400).json({ error: "Invalid request type" });
  } catch (error) {
    console.error("Profile API error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
