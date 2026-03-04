import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt } from "../src/prompts/systemPrompt";
import { buildParsePrompt } from "../src/prompts/parsePrompt";
import { buildFollowUpPrompt } from "../src/prompts/followUpPrompt";

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Extends timeout to 30s on Vercel Pro plan (Hobby is capped at 10s)
export const maxDuration = 30;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    let userPrompt: string;

    if (body.type === "parse") {
      userPrompt = buildParsePrompt(body.text);
    } else if (body.type === "followup") {
      userPrompt = buildFollowUpPrompt(body.activities, body.answers);
    } else {
      return res.status(400).send("Invalid request type");
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return res.status(500).send("No text response from AI");
    }

    const rawText = textBlock.text;

    try {
      const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return res.status(200).json(parsed);
    } catch {
      return res.status(500).send("AI returned invalid JSON");
    }
  } catch (error) {
    console.error("API error:", error);

    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).send("Too many requests — please try again in a moment");
    }

    return res.status(500).send("Internal server error");
  }
}
