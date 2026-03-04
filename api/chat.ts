import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 30;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const systemPrompt = `You are Kairo, a friendly assistant that helps Canadian high school students (grades 9-12) organize their extracurricular activities into clear, categorized profiles. You speak in a casual, encouraging tone — like a chill guidance counsellor who actually gets it.

Your job is to take messy brain dumps of activities and turn them into structured profiles. You categorize activities into these groups:
- Academics (tutoring, competitions, academic clubs, courses)
- Sports (team sports, individual sports, coaching, fitness)
- Arts & Music (band, choir, theatre, visual arts, dance, film)
- Volunteering (community service, charity work, mentoring)
- Clubs (school clubs, debate, Model UN, robotics, coding)
- Work & Leadership (jobs, student council, leadership roles)
- Certifications (first aid, lifeguard, language certs, etc.)

When asking follow-up questions:
- Be specific and casual — "How many hours a week do you spend on basketball?" not "Please elaborate on your sports involvement"
- Ask about: role/position, time commitment, achievements, duration, impact
- Group questions by activity
- Don't ask about things the student already told you
- Activities that are already detailed enough don't need questions
- Keep it to 2-3 questions per activity that needs more detail

Always respond with valid JSON. Never include markdown code fences or extra text outside the JSON.`;

function buildParsePrompt(brainDump: string): string {
  return `A student just brain-dumped their activities. Parse them into structured activities and generate follow-up questions for any that need more detail.

Here's their brain dump:
"""
${brainDump}
"""

Respond with a JSON object in this exact format:
{
  "activities": [
    {
      "id": "act_1",
      "name": "Activity Name",
      "category": "one of: Academics | Sports | Arts & Music | Volunteering | Clubs | Work & Leadership | Certifications",
      "description": "A 1-2 sentence summary of the activity. Do NOT include hours, duration, or achievements here.",
      "details": ["Specific facts not in the description — responsibilities, projects, events"],
      "yearsActive": "e.g. Grade 9-11 or 2 years (if mentioned)",
      "role": "their role if mentioned",
      "achievements": ["Only standout accomplishments: awards, certifications, competitions, leadership titles"],
      "hoursPerWeek": null,
      "isDetailedEnough": false
    }
  ],
  "followUpQuestions": [
    {
      "id": "q_1",
      "activityId": "act_1",
      "activityName": "Activity Name",
      "question": "A casual, specific follow-up question"
    }
  ]
}

Rules:
- Generate a unique id for each activity (act_1, act_2, etc.) and question (q_1, q_2, etc.)
- CRITICAL: Do not duplicate information across fields. Each fact goes in exactly ONE place:
  - "description": 1-2 sentence summary only
  - "details": specific facts NOT already in the description
  - "yearsActive": duration ONLY goes here
  - "hoursPerWeek": time commitment ONLY goes here (as a number)
  - "role": position/title ONLY goes here
  - "achievements": ONLY impressive accomplishments (awards, certs, competitions, ranks)
- Set isDetailedEnough to true if the student gave enough info (role, duration, specifics)
- Only generate follow-up questions for activities where isDetailedEnough is false
- 2 questions max per activity
- Questions should be casual and specific
- If an activity is very detailed already, don't ask about it
- Categorize each activity into the best-fit category`;
}

function buildFollowUpPrompt(
  activities: unknown[],
  answers: unknown[]
): string {
  const activitiesJson = JSON.stringify(activities, null, 2);
  const answersJson = JSON.stringify(answers, null, 2);

  return `A student answered follow-up questions about their activities. Update their activity profiles with the new info. Do NOT generate any follow-up questions — this is the final round.

Current activities:
${activitiesJson}

Their answers:
${answersJson}

Respond with a JSON object in this exact format:
{
  "updatedActivities": [
    {
      "id": "act_1",
      "name": "Activity Name",
      "category": "Category",
      "description": "A 1-2 sentence summary of what this activity is and the student's involvement. Do NOT include hours, duration, or achievements here.",
      "details": ["Specific facts NOT already in the description — e.g. specific responsibilities, projects, events. Do NOT repeat hours, duration, or role here."],
      "yearsActive": "updated if answered",
      "role": "updated if answered",
      "achievements": ["Only standout accomplishments: awards, certifications, competitions, leadership titles. NOT hours or duration."],
      "hoursPerWeek": 5,
      "isDetailedEnough": true
    }
  ],
  "followUpQuestions": []
}

Rules:
- Merge the answers into the existing activity data
- CRITICAL: Do not duplicate information across fields. Each fact should appear in exactly ONE place:
  - "description": 1-2 sentence summary of the activity
  - "details": specific facts, responsibilities, projects — things not in the description
  - "yearsActive": duration info ONLY goes here
  - "hoursPerWeek": time commitment ONLY goes here (as a number)
  - "role": position/title ONLY goes here
  - "achievements": ONLY impressive accomplishments (awards, certs, competitions, ranks)
- Set followUpQuestions to an empty array — no more questions
- Return ALL activities (even ones that weren't asked about), not just updated ones`;
}

function buildExpandPrompt(activity: { name: string; description: string; details: string[]; role?: string }): string {
  return `A student has an activity called "${activity.name}" in their profile with this info:
Description: ${activity.description}
Details: ${activity.details.join(", ") || "none yet"}
Role: ${activity.role || "not specified"}

Generate 2-3 deeper follow-up questions to make this activity richer. Ask about specific moments, challenges, leadership, impact, or what they learned — not basic facts like hours or duration.

Respond with JSON: { "questions": ["question 1", "question 2", "question 3"] }`;
}

function buildExpandAnswerPrompt(
  activity: unknown,
  answers: { question: string; answer: string }[]
): string {
  return `A student answered deeper questions about one of their activities. Update the activity with richer detail.

Current activity:
${JSON.stringify(activity, null, 2)}

Their answers:
${JSON.stringify(answers, null, 2)}

Respond with JSON containing the full updated activity:
{
  "updatedActivity": {
    "id": "...",
    "name": "...",
    "category": "...",
    "description": "A richer 1-2 sentence summary weaving in the new depth. Do NOT include hours, duration, or achievements here.",
    "details": ["Expanded details including new specifics from answers. Each detail should be unique."],
    "yearsActive": "...",
    "role": "...",
    "achievements": ["Only standout accomplishments"],
    "hoursPerWeek": null,
    "isDetailedEnough": true
  }
}

Rules:
- Weave the answers into a richer description and details
- Do NOT duplicate info across fields
- Keep all existing info, just make it deeper`;
}

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
    } else if (body.type === "expand") {
      userPrompt = buildExpandPrompt(body.activity);
    } else if (body.type === "expand-answer") {
      userPrompt = buildExpandAnswerPrompt(body.activity, body.answers);
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
