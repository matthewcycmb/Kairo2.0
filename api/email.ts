import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

// How many days after signup to send re-engagement email
const REENGAGEMENT_DAYS = 3;

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

function isEmail(identifier: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

function reengagementHtml(profileUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px; font-size: 15px; color: #333; line-height: 1.7;">
      <p>Hey!</p>
      <p>Your Kairo Advisor went through everything you submitted and flagged some gaps that admissions officers actually look for.</p>
      <p>Not trying to freak you out, just better to know now than when you're mid-application.</p>
      <p><a href="${profileUrl}" style="color: #111; font-weight: 500;">${profileUrl}</a></p>
      <p>Matthew</p>
    </div>
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is called by Vercel Cron (or with a secret)
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Find profiles created ~REENGAGEMENT_DAYS ago that have email identifiers
    // and haven't been emailed yet
    const cutoffStart = new Date();
    cutoffStart.setDate(cutoffStart.getDate() - REENGAGEMENT_DAYS - 1);
    const cutoffEnd = new Date();
    cutoffEnd.setDate(cutoffEnd.getDate() - REENGAGEMENT_DAYS + 1);

    // Get identifiers that look like emails, joined with profile creation date
    const { data: identifiers, error: dbError } = await supabase
      .from("profile_identifiers")
      .select("profile_id, identifier, created_at")
      .gte("created_at", cutoffStart.toISOString())
      .lte("created_at", cutoffEnd.toISOString());

    if (dbError) {
      console.error("DB error:", dbError);
      return res.status(500).json({ error: "Database error" });
    }

    const emails = (identifiers || []).filter((row) => isEmail(row.identifier));

    // Check which have already been emailed
    const alreadySent = new Set<string>();
    if (emails.length > 0) {
      const { data: sent } = await supabase
        .from("emails_sent")
        .select("profile_id")
        .in("profile_id", emails.map((e) => e.profile_id))
        .eq("email_type", "reengagement");

      for (const row of sent || []) {
        alreadySent.add(row.profile_id);
      }
    }

    const toSend = emails.filter((e) => !alreadySent.has(e.profile_id));

    let sent = 0;
    for (const row of toSend) {
      const profileUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://kairo.app"}?p=${row.profile_id}`;

      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: row.identifier,
          subject: "[ URGENT ] your profile has gaps",
          html: reengagementHtml(profileUrl),
        });

        // Record that we sent this email
        await supabase.from("emails_sent").insert({
          profile_id: row.profile_id,
          email_type: "reengagement",
          sent_at: new Date().toISOString(),
        });

        sent++;
      } catch (err) {
        console.error(`Failed to send to ${row.identifier}:`, err);
      }
    }

    return res.status(200).json({ sent, total: toSend.length });
  } catch (err) {
    console.error("Email cron error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
