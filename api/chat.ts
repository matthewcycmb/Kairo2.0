import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 30;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// --- Rate limiting (in-memory, per Vercel instance) ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);

// --- Input validation ---
const MAX_TEXT_LENGTH = 10_000;
const MAX_ACTIVITIES = 50;
const MAX_ANSWERS = 50;
const MAX_MESSAGES = 30;

function getClientIp(req: VercelRequest): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
}

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
      "skills": ["2-4 hard or soft skills inferred from this activity"],
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
  - "skills": 2-4 hard or soft skills inferred from the activity (e.g. "Public Speaking", "Python", "Teamwork", "Project Management")
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
      "skills": ["2-4 hard or soft skills inferred from the activity"],
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
  - "skills": 2-4 hard or soft skills inferred from the activity
- Set followUpQuestions to an empty array — no more questions
- Return ALL activities (even ones that weren't asked about), not just updated ones`;
}

function buildExpandPrompt(activity: { name: string; description: string; details: string[]; role?: string }): string {
  return `A student has an activity called "${activity.name}" in their profile with this info:
Description: ${activity.description}
Details: ${activity.details.join(", ") || "none yet"}
Role: ${activity.role || "not specified"}

Generate exactly 2 deeper follow-up questions to make this activity richer. Prioritize questions about achievements, impact, and personal growth over logistics like hours or scheduling.

Respond with JSON: { "questions": ["question 1", "question 2"] }`;
}

interface AdvisorProfile {
  activities: {
    name: string;
    category: string;
    role?: string;
    description: string;
    achievements?: string[];
    skills?: string[];
    yearsActive?: string;
    hoursPerWeek?: number | null;
  }[];
  goals?: {
    grade: number;
    targetUniversities: string;
    location: string;
  };
}

interface AdvisorMsg {
  role: "user" | "assistant";
  content: string;
}

interface PendingAction {
  id: string;
  action: string;
  gap: string;
  createdAt: string;
}

function buildAdvisorSystemPrompt(profile: AdvisorProfile, pendingActions?: PendingAction[]): string {
  const activitiesSummary = profile.activities
    .map((a) => {
      const parts = [`• ${a.name} (${a.category})`];
      if (a.role) parts.push(`  Role: ${a.role}`);
      parts.push(`  ${a.description}`);
      if (a.achievements?.length) parts.push(`  Achievements: ${a.achievements.join(", ")}`);
      if (a.skills?.length) parts.push(`  Skills: ${a.skills.join(", ")}`);
      if (a.yearsActive) parts.push(`  Duration: ${a.yearsActive}`);
      if (a.hoursPerWeek) parts.push(`  Hours/week: ${a.hoursPerWeek}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const goalsSection = profile.goals
    ? `Grade: ${profile.goals.grade}\nTarget Universities: ${profile.goals.targetUniversities || "Not specified"}\nLocation: ${profile.goals.location || "Not specified"}`
    : "No specific goals set yet.";

  return `You are the Kairo Advisor — a smart older friend who's been through the university application grind and knows what actually matters. You talk like a real person, not a guidance counsellor reading from a pamphlet. You're encouraging but honest, casual but knowledgeable. Think: the cool older sibling's friend who got into a great program and is giving you the real talk.

STUDENT PROFILE:
${activitiesSummary}

GOALS:
${goalsSection}

RECOMMENDATION RULES (CRITICAL — NEVER VIOLATE THESE):
- NEVER mention a specific named program, competition, or organization by name. This means NO "DECA", NO "Junior Achievement", NO "FBLA", NO "HOSA", NO "Model UN", NO "Enactus" — none of them. You do not know what exists at the student's school or in their city. Instead, describe the TYPE of activity and tell them who to ask.
- Good: "ask your school's business teacher if there are any inter-school business competitions you could enter"
- Good: "email your school counselor and ask what entrepreneurship clubs or competitions other students have done"
- Bad: "join DECA" / "look into Junior Achievement" / "sign up for FBLA" — NEVER DO THIS
- Every action step should be something the student can do THIS WEEK by talking to a specific person or going to a specific place they already have access to — their teacher, their counselor, their school notice board, a classmate.
- Never tell the student to "research" or "look into" something — that is not an action step. An action step names WHO to talk to or WHERE to go.

TONE:
- Talk like a friend, not a report. Use "you" and "your" a lot. Short sentences. It's okay to be a little blunt.
- Say "honestly" and "real talk" sometimes. Don't say "I recommend" or "you should consider" — say "you should totally" or "look into" or "this would be sick for you"
- Don't hedge everything. If something is a good idea, just say it's a good idea.
- No corporate-speak. "Leverage your leadership experience" = bad. "You're already leading the robotics team, so use that" = good.

FORMATTING:
- Use markdown formatting. Use **bold** for key terms and emphasis.
- When listing multiple points, use numbered lists (1. 2. 3.) with each item on its own line.
- Add blank lines between paragraphs and before/after lists so the response is easy to scan.
- Never write one giant wall of text — break things up into short, readable chunks.

Rules:
- Always reference the student's actual activities by name — never give generic advice
- Maximum 3 action items per response
- Keep responses concise and conversational — no bullet-point walls, no numbered lists unless asked
- For follow-up messages, respond in plain conversational text
- For the first analysis, respond in JSON as instructed
- If the student asks something outside your scope, gently redirect to extracurricular/university planning
${pendingActions?.length ? `
PENDING ACTION ITEMS (the student currently has these outstanding):
${pendingActions.map((a, i) => `${i + 1}. "${a.action}" (addresses: ${a.gap}, assigned: ${a.createdAt})`).join("\n")}

When the student says they completed an action: celebrate genuinely (be specific about what they did), then give them their next action step if they have fewer than 2 pending items.
When the student says they haven't done an action yet: be empathetic, ask what got in the way, and offer to either simplify the action or draft something for them (like an email or talking points).
` : ""}`;
}

function buildAdvisorUserPrompt(
  messages: AdvisorMsg[],
  isFirstMessage: boolean,
  pendingActions?: PendingAction[]
): string {
  if (isFirstMessage) {
    return `This is your first analysis of the student's profile. Respond with a JSON object in this exact format:

{
  "strengths": [
    "A specific strength citing an activity by name — 1 sentence each",
    "Another strength — max 3 items"
  ],
  "gaps": [
    "A specific gap or area to strengthen relative to their targets — 1 sentence each",
    "Another gap — max 3 items"
  ],
  "actionStep": "One concrete, specific action they can take this week. Must name WHO to talk to or WHERE to go — e.g. 'ask your math teacher about...' or 'go to your school counselor and ask...' Never say 'research' or 'look into'.",
  "actionGap": "Which gap this action addresses — match one of the gaps above",
  "suggestions": [
    "A contextual follow-up question the student might want to ask — 2-3 items",
    "Another question based on the analysis"
  ]
}

Rules:
- Each strength must reference a specific activity from their profile by name
- Each gap should be specific to their target universities/programs if set
- The action step must be immediately actionable (this week) — name a specific person to talk to or place to go, never tell them to "research" or "look into" something
- NEVER name a specific program, competition, or organization (no DECA, no FBLA, no Junior Achievement, etc). Instead say "ask your teacher if there's a business club" or "ask your counselor about inter-school competitions"
- actionGap should be a short label for which gap the action step addresses
- suggestions should be 2-3 natural follow-up questions the student might ask next, based on the analysis (e.g. "What competitions should I enter for robotics?" or "How do I strengthen my volunteering?")
- Keep each item to 1 concise sentence
- Return ONLY valid JSON, no extra text`;
  }

  const recent = messages.slice(-20);
  const history = recent
    .map((m) => `${m.role === "user" ? "Student" : "Advisor"}: ${m.content}`)
    .join("\n\n");

  const actionContext = pendingActions?.length
    ? `\n\nThe student currently has these pending action items:\n${pendingActions.map((a) => `- "${a.action}" (gap: ${a.gap})`).join("\n")}\n\nIf the student's message relates to completing or not completing an action item, handle it appropriately (celebrate completions, be empathetic about incomplete items and offer to simplify or draft something).`
    : "";

  return `Conversation so far:\n\n${history}${actionContext}\n\nRespond to the student's latest message. Be specific and reference their profile.

Respond with a JSON object in this exact format:
{
  "message": "Your response with markdown formatting. Use \\n\\n between paragraphs. Use **bold** for emphasis. Use numbered lists (1. 2. 3.) on separate lines when listing multiple points.",
  "suggestions": ["A follow-up question the student might ask next", "Another contextual suggestion"],
  "actionItems": [{"action": "A specific action step if your response includes one", "gap": "Which gap or area this addresses"}]
}

Rules:
- "message" is your conversational response — keep it concise and natural
- CRITICAL FORMATTING: The "message" field MUST use \\n\\n to separate paragraphs and ideas. Never write a wall of text. Break your response into 2-4 short paragraphs. Use **bold** for key terms. If listing multiple points, use a numbered list with each item on its own line (1. First\\n2. Second\\n3. Third).
- "suggestions" should be 2-3 contextual follow-up questions the student might want to ask, based on what you just discussed
- "actionItems" should only be included if your response gives a specific, actionable recommendation. Omit or use an empty array if you're just answering a question without recommending an action. Each item needs an "action" (what to do) and "gap" (which area it strengthens).
- Return ONLY valid JSON, no extra text`;
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
    "skills": ["2-4 hard or soft skills — update/refine based on the deeper answers"],
    "hoursPerWeek": null,
    "isDetailedEnough": true
  }
}

Rules:
- Weave the answers into a richer description and details
- Do NOT duplicate info across fields
- Keep all existing info, just make it deeper
- Update or refine the skills list based on what the deeper answers reveal`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — please wait a minute" });
  }

  try {
    const body = req.body;
    if (!body || typeof body.type !== "string") {
      return res.status(400).json({ error: "Invalid request" });
    }

    // Input validation per type
    if (body.type === "parse") {
      if (typeof body.text !== "string" || body.text.trim().length < 20 || body.text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: "Text must be 20-10,000 characters" });
      }
    } else if (body.type === "followup") {
      if (!Array.isArray(body.activities) || body.activities.length > MAX_ACTIVITIES) {
        return res.status(400).json({ error: "Invalid activities" });
      }
      if (!Array.isArray(body.answers) || body.answers.length > MAX_ANSWERS) {
        return res.status(400).json({ error: "Invalid answers" });
      }
    } else if (body.type === "expand") {
      if (!body.activity || typeof body.activity.name !== "string") {
        return res.status(400).json({ error: "Invalid activity" });
      }
    } else if (body.type === "expand-answer") {
      if (!body.activity || !Array.isArray(body.answers) || body.answers.length > MAX_ANSWERS) {
        return res.status(400).json({ error: "Invalid request data" });
      }
    } else if (body.type === "advisor") {
      if (!body.profile || !Array.isArray(body.profile.activities)) {
        return res.status(400).json({ error: "Invalid profile" });
      }
      if (body.profile.activities.length > MAX_ACTIVITIES) {
        return res.status(400).json({ error: "Too many activities" });
      }
      if (body.messages && (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES)) {
        return res.status(400).json({ error: "Too many messages" });
      }
      if (body.pendingActions && !Array.isArray(body.pendingActions)) {
        return res.status(400).json({ error: "Invalid pending actions" });
      }
    } else {
      return res.status(400).json({ error: "Invalid request type" });
    }

    if (body.type === "advisor") {
      const advisorSystem = buildAdvisorSystemPrompt(body.profile, body.pendingActions);
      const advisorUser = buildAdvisorUserPrompt(body.messages || [], body.isFirstMessage, body.pendingActions);

      const advisorMessage = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: advisorSystem,
        messages: [{ role: "user", content: advisorUser }],
      });

      const advisorTextBlock = advisorMessage.content.find((block) => block.type === "text");
      if (!advisorTextBlock || advisorTextBlock.type !== "text") {
        return res.status(500).send("No text response from AI");
      }

      const cleaned = advisorTextBlock.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      if (body.isFirstMessage) {
        try {
          const parsed = JSON.parse(cleaned);
          const analysis = {
            strengths: parsed.strengths || [],
            gaps: parsed.gaps || [],
            actionStep: parsed.actionStep || "",
          };
          // Build a plain-text fallback for the content field
          const message = [
            ...analysis.strengths.map((s: string) => `Strength: ${s}`),
            ...analysis.gaps.map((g: string) => `Gap: ${g}`),
            `Action: ${analysis.actionStep}`,
          ].join("\n");
          const suggestions = parsed.suggestions || [];
          const actionItems = parsed.actionStep
            ? [{ action: parsed.actionStep, gap: parsed.actionGap || parsed.gaps?.[0] || "" }]
            : [];
          return res.status(200).json({ message, analysis, suggestions, actionItems });
        } catch {
          return res.status(200).json({ message: advisorTextBlock.text });
        }
      }

      // Follow-up messages: try JSON, fall back to plain text
      try {
        const parsed = JSON.parse(cleaned);
        return res.status(200).json({
          message: parsed.message || advisorTextBlock.text,
          suggestions: parsed.suggestions || [],
          actionItems: parsed.actionItems || [],
        });
      } catch {
        return res.status(200).json({ message: advisorTextBlock.text });
      }
    }

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
