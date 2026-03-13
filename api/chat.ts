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

// --- Daily request cap per IP ---
const DAILY_LIMIT = 100; // max requests per day per IP
const dailyLimitMap = new Map<string, { count: number; resetAt: number }>();

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

function isDailyLimited(ip: string): boolean {
  const now = Date.now();
  const entry = dailyLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    // Reset at midnight — use 24h window from first request
    dailyLimitMap.set(ip, { count: 1, resetAt: now + 86_400_000 });
    return false;
  }
  entry.count++;
  return entry.count > DAILY_LIMIT;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
  for (const [ip, entry] of dailyLimitMap) {
    if (now > entry.resetAt) dailyLimitMap.delete(ip);
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
      "description": "A 2-3 sentence ENRICHED summary that makes the activity sound impressive and detailed — way better than what the student typed. See ENRICHMENT RULE below.",
      "details": ["Specific facts not in the description — responsibilities, projects, events. Infer reasonable context even from minimal input."],
      "yearsActive": "e.g. Grade 9-11 or 2 years (if mentioned)",
      "role": "their role if mentioned",
      "achievements": ["Only standout accomplishments: awards, certifications, competitions, leadership titles"],
      "skills": ["2-4 concrete, resume-worthy skills inferred from this activity"],
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
- ENRICHMENT RULE (CRITICAL): Do NOT just reorganize the student's words. TRANSFORM them. Every description must sound noticeably better than what the student typed — add context, implications, and depth they didn't think to include. If the student wrote 5 words, the profile entry should be 2-3 rich sentences.
  - Student writes: "I play badminton for my school" → BAD: "Plays badminton for school team." → GOOD: "Member of the school's competitive badminton team, competing in singles and doubles matches at the regional level. Develops strategic game sense and individual performance under pressure during tournament play."
  - Student writes: "I volunteer at my church" → BAD: "Volunteers at church." → GOOD: "Active volunteer within the church community, contributing to weekly service coordination and community outreach events. Supports the congregation's mission through hands-on involvement in organizing programs that serve local families."
  - The key: infer reasonable context from minimal input. A school badminton player likely competes regionally. A church volunteer likely helps with events and community programs. Add these plausible details to make the profile compelling.
- Generate a unique id for each activity (act_1, act_2, etc.) and question (q_1, q_2, etc.)
- CRITICAL: Do not duplicate information across fields. Each fact goes in exactly ONE place:
  - "description": 2-3 sentence enriched summary
  - "details": specific facts NOT already in the description
  - "yearsActive": duration ONLY goes here
  - "hoursPerWeek": time commitment ONLY goes here (as a number)
  - "role": position/title ONLY goes here
  - "achievements": ONLY impressive accomplishments (awards, certs, competitions, ranks)
  - "skills": 2-4 concrete, resume-worthy skills someone could actually DO — things you'd tell an employer. Good: "public speaking", "video editing", "first aid certified", "Python", "event planning", "team leadership", "piano RCM Grade 7". Bad: "Competitive Mindset", "Individual Performance", "Time Management", "Dedication", "Hand-Eye Coordination", "Athletic Discipline". If it sounds like a motivational poster, it's not a skill. If it sounds like something you can demonstrate or prove, it is.
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
      "description": "A 2-3 sentence ENRICHED summary that makes the activity sound impressive and detailed — transform the student's words, don't just reorganize them. Add context, implications, and depth.",
      "details": ["Specific facts NOT already in the description — e.g. specific responsibilities, projects, events. Infer reasonable context from answers."],
      "yearsActive": "updated if answered",
      "role": "updated if answered",
      "achievements": ["Only standout accomplishments: awards, certifications, competitions, leadership titles. NOT hours or duration."],
      "skills": ["2-4 concrete, resume-worthy skills inferred from the activity"],
      "hoursPerWeek": 5,
      "isDetailedEnough": true
    }
  ],
  "followUpQuestions": []
}

Rules:
- Merge the answers into the existing activity data
- ENRICHMENT RULE: When merging answers, don't just append facts — rewrite the description to sound richer and more impressive. Transform the student's casual answers into polished, compelling profile language. Add context and implications they didn't think to include.
- CRITICAL: Do not duplicate information across fields. Each fact should appear in exactly ONE place:
  - "description": 2-3 sentence enriched summary of the activity
  - "details": specific facts, responsibilities, projects — things not in the description
  - "yearsActive": duration info ONLY goes here
  - "hoursPerWeek": time commitment ONLY goes here (as a number)
  - "role": position/title ONLY goes here
  - "achievements": ONLY impressive accomplishments (awards, certs, competitions, ranks)
  - "skills": 2-4 concrete, resume-worthy skills someone could actually DO — things you'd tell an employer. Good: "public speaking", "video editing", "first aid certified", "Python", "event planning", "team leadership". Bad: "Competitive Mindset", "Individual Performance", "Time Management", "Dedication", "Athletic Discipline". If it sounds like a motivational poster, it's not a skill.
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
    details?: string[];
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

function buildAdvisorSystemPrompt(profile: AdvisorProfile): string {
  const activitiesSummary = profile.activities
    .map((a) => {
      const parts = [`• ${a.name} (${a.category})`];
      if (a.role) parts.push(`  Role: ${a.role}`);
      parts.push(`  ${a.description}`);
      if (a.details?.length) parts.push(`  Details: ${a.details.join("; ")}`);
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

  return `You are the Kairo Advisor — a sharp older friend who got into a top program and tells students what they need to hear, not what they want to hear. You talk like a real person. You're blunt, specific, and never sugarcoat.

STUDENT PROFILE:
${activitiesSummary}

GOALS:
${goalsSection}

6 RULES — follow these and nothing else:

1. BUILD ON, NEVER REPEAT. Before suggesting anything, check every activity above. If they already do it, suggest the next level — "you're already doing case comps, the next step is placing at one or leading the organizing." Never recommend what they already have.

2. NO NAMED PROGRAMS. Never say "DECA", "FBLA", "Junior Achievement", "Model UN", etc. You don't know what exists at their school. Describe the TYPE of activity instead — "ask your business teacher about competitions against other schools."

3. CREATIVE COMBINATION CLOSE. End every message by merging two or more of their existing activities into one new thing they haven't thought of. The combination must be something the student can start TODAY from their phone or laptop in under 10 minutes. If they can't begin it right now sitting in their chair, it's too ambitious — shrink it. "Post a 60-second debate breakdown on your Instagram tonight" beats "run a free workshop at your school" every time. Connect it back to their biggest gap. Never end with "ask me for more" — end with a confident, complete thought.

4. PROGRAM FIT CHALLENGE. If their activities suggest a stronger fit for a different program than their target, say so directly using real university and program names. "Your profile screams CS way more than business — have you looked at UBC CS or Waterloo?" Skip only if the fit is genuinely strong.

5. BRUTAL HONESTY. If something is weak, say it's weak. No compliment sandwiches. No "that's a solid start." Generic activities get called out — "every applicant volunteers at a food bank, what have you done that nobody else has?" The student should feel slightly uncomfortable with the truth.

6. TALK LIKE A FRIEND. Short sentences. "You" and "your" constantly. No jargon — no "co-curricular", "inter-school", "demonstrated", "measurable", "at scale." If it sounds like a guidance counsellor wrote it, rewrite it. Use **bold** for emphasis. Keep paragraphs to 1-2 sentences. Easy to scan on a phone.

SUGGESTIONS: Generate exactly 3 questions that make the student feel a jolt — slight anxiety, genuine curiosity, or both. The test: would the student screenshot this and send it to a friend saying "bro look at this question"? If not, it's too tame. Go visceral, not analytical. Good: "If a Sauder admissions officer read your profile right now, which activity would make them roll their eyes?" Bad: "Is your food bank volunteering hurting your application or just not helping?" Each must reference a specific activity, gap, or university from your analysis.`;
}

function buildAdvisorUserPrompt(
  messages: AdvisorMsg[],
  isFirstMessage: boolean,
): string {
  if (isFirstMessage) {
    return `First message to the student. Conversational paragraphs only — no bullets, no headers.

Structure (250 words max):
1. Strongest activity — reference a specific metric or detail, explain why it matters for admissions.
2. Second strength from a different category — one specific detail, keep it short.
3. Biggest gap — be direct, contrast what they have vs what their target programs want.
4. Program fit challenge (skip ONLY if fit is genuinely perfect) — name specific universities/programs their profile actually matches better.
5. Creative combination close — merge two existing activities into one new thing, connect it back to their biggest gap.

Respond with JSON:
{
  "message": "Your opening. Use \\n\\n between paragraphs. Use **bold** for emphasis. No bullets.",
  "suggestions": ["Curiosity hook referencing a specific gap/activity/university from your analysis", "Another specific hook", "Third specific hook"]
}

Return ONLY valid JSON, no extra text`;
  }

  const recent = messages.slice(-20);
  const history = recent
    .map((m) => `${m.role === "user" ? "Student" : "Advisor"}: ${m.content}`)
    .join("\n\n");

  return `Conversation so far:\n\n${history}\n\nRespond to the student's latest message.

80 words max. One key insight with a specific profile reference. End with either a creative combination or an uncomfortable truth. Offer to go deeper only if there's more to unpack — don't force it. Give a detailed breakdown (over 80 words) only if the student explicitly asks.

Respond with JSON:
{
  "message": "Your response. Use **bold** for emphasis. Use \\n\\n between paragraphs.",
  "suggestions": ["Personalized curiosity hook referencing their profile", "Another specific hook", "Third hook"]
}

Return ONLY valid JSON, no extra text`;
}

function buildAppHelperActivitiesSummary(profile: AdvisorProfile): string {
  return profile.activities
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
}

function buildAppHelperClarifyPrompt(profile: AdvisorProfile, question: string): string {
  const activitiesSummary = buildAppHelperActivitiesSummary(profile);

  return `A student wants to answer a university application question. Before writing, you need to ask them 2-3 short clarifying questions so you can write an authentic, specific answer without fabricating any details.

STUDENT'S PROFILE:
${activitiesSummary}

APPLICATION QUESTION:
"${question}"

Generate 2-3 short, casual clarifying questions. These should help you understand:
- Which specific activity/experience they want to focus on (if the question is open-ended)
- A specific moment, story, or experience they remember
- What they personally felt or took away from it

Keep the questions short and conversational — like a friend helping them brainstorm, not a formal interview.

Respond with JSON: { "questions": ["question 1", "question 2", "question 3"] }`;
}

function buildAppHelperGeneratePrompt(
  profile: AdvisorProfile,
  question: string,
  clarifyAnswers: { question: string; answer: string }[]
): string {
  const activitiesSummary = buildAppHelperActivitiesSummary(profile);
  const answersText = clarifyAnswers
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");

  return `You are a university application ghostwriter. A student needs you to answer an application question. You have their profile data AND their own words from clarifying questions. Write ONLY from what you know — never invent details.

STUDENT'S FULL PROFILE:
${activitiesSummary}

APPLICATION QUESTION:
"${question}"

STUDENT'S OWN WORDS (from clarifying questions):
${answersText}

Write a compelling, personal answer to this question.

RULES:
- Write in first person as the student. Use "I", "my", "me".
- Use ONLY facts from their profile and their own words above. NEVER invent specific scores, dates, scenarios, quotes, dialogue, or details the student didn't provide.
- Reference their real activities, roles, and achievements by name.
- Weave in the personal details and feelings they shared in their answers — this is what makes it authentic.
- Write naturally — like a thoughtful student, not an AI. Avoid clichés like "I learned the importance of" or "this experience taught me that".
- Show, don't tell. Use the specific moments they described rather than inventing new ones.
- Keep it 150-250 words — concise and impactful.
- End with forward momentum — not a tidy moral.
- Do NOT wrap in quotes. Just write the answer directly.

Respond with a JSON object: { "answer": "the full answer text" }`;
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
    "description": "A richer 2-3 sentence summary weaving in the new depth. Transform the student's words into impressive, compelling language — don't just reorganize what they said.",
    "details": ["Expanded details including new specifics from answers. Each detail should be unique."],
    "yearsActive": "...",
    "role": "...",
    "achievements": ["Only standout accomplishments"],
    "skills": ["2-4 concrete, resume-worthy skills — update/refine based on the deeper answers"],
    "hoursPerWeek": null,
    "isDetailedEnough": true
  }
}

Rules:
- Weave the answers into a richer description and details
- Do NOT duplicate info across fields
- Keep all existing info, just make it deeper
- Update or refine the skills list based on what the deeper answers reveal. Only include concrete, demonstrable skills — things you could tell an employer you can DO (e.g. "public speaking", "video editing", "Python", "event planning"). Never include vague traits like "Competitive Mindset", "Dedication", or "Time Management".`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — please wait a minute" });
  }
  if (isDailyLimited(ip)) {
    return res.status(429).json({ error: "Daily limit reached — come back tomorrow!" });
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
    } else if (body.type === "app-helper") {
      if (!body.profile || !Array.isArray(body.profile.activities)) {
        return res.status(400).json({ error: "Invalid profile" });
      }
      if (typeof body.question !== "string" || body.question.trim().length < 5 || body.question.length > 2000) {
        return res.status(400).json({ error: "Question must be 5-2,000 characters" });
      }
    } else {
      return res.status(400).json({ error: "Invalid request type" });
    }

    if (body.type === "app-helper") {
      const hasClarifyAnswers = Array.isArray(body.clarifyAnswers) && body.clarifyAnswers.length > 0;
      const prompt = hasClarifyAnswers
        ? buildAppHelperGeneratePrompt(body.profile, body.question.trim(), body.clarifyAnswers)
        : buildAppHelperClarifyPrompt(body.profile, body.question.trim());

      const appHelperMessage = await anthropic.messages.create({
        model: hasClarifyAnswers ? "claude-sonnet-4-5-20250929" : "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = appHelperMessage.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).send("No text response from AI");
      }

      const cleaned = textBlock.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        if (hasClarifyAnswers) {
          return res.status(200).json({ answer: parsed.answer || cleaned });
        } else {
          return res.status(200).json({ questions: parsed.questions || [] });
        }
      } catch {
        if (hasClarifyAnswers) {
          return res.status(200).json({ answer: cleaned });
        } else {
          return res.status(200).json({ questions: [] });
        }
      }
    }

    if (body.type === "advisor") {
      const advisorSystem = buildAdvisorSystemPrompt(body.profile);
      const advisorUser = buildAdvisorUserPrompt(body.messages || [], body.isFirstMessage);

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

      // Parse JSON with fallback for common LLM issues (actual newlines inside strings)
      let parsed: Record<string, unknown> | null = null;

      try { parsed = JSON.parse(cleaned); } catch {}

      // Fix: LLMs sometimes put actual newline chars inside JSON strings (invalid JSON)
      if (!parsed) {
        try {
          const fixed = cleaned.replace(/"((?:[^"\\]|\\.)*)"/gs, (match) =>
            match.replace(/\r?\n/g, "\\n")
          );
          parsed = JSON.parse(fixed);
        } catch {}
      }

      if (parsed && typeof parsed.message === "string") {
        // Convert any double-escaped \\n to real newlines
        const message = (parsed.message as string).replace(/\\n/g, "\n");
        return res.status(200).json({
          message,
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        });
      }

      // Last resort: return cleaned text
      return res.status(200).json({ message: cleaned });
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

    // Use Haiku for structured extraction/generation tasks to save costs
    // Only app-helper generate and advisor need Sonnet for writing quality
    const isSonnetTask = false; // parse, followup, expand, expand-answer all use Haiku
    const isLightTask = body.type === "expand" || body.type === "expand-answer";
    const model = isSonnetTask ? "claude-sonnet-4-5-20250929" : "claude-haiku-4-5-20251001";
    const maxTokens = isLightTask ? 1024 : 4096;

    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
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
