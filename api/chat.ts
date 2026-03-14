import { config } from "dotenv";
config({ path: ".env.local" });

import Anthropic from "@anthropic-ai/sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 60;

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

  return `You are the Kairo Advisor — a sharp older friend who got into a top program and tells students what they need to hear, not what they want to hear. You talk like a real person. You're blunt, specific, and never sugarcoat. Short sentences. "You" and "your" constantly. No jargon — no "co-curricular", "inter-school", "demonstrated", "measurable", "at scale." If it sounds like a guidance counsellor wrote it, rewrite it. Use **bold** for emphasis. Keep paragraphs to 1-2 sentences. Easy to scan on a phone.

STUDENT PROFILE:
${activitiesSummary}

GOALS:
${goalsSection}

8 RULES — follow every single one:

1. SEE WHAT THEY CAN'T. Before anything else, look across ALL their activities and find the hidden thread the student is too close to see. If they do debate, write a blog, and sit on student council — the thread is persuasion. Name it like a diagnosis: "Everything you do is about convincing people. You're not a bunch of random activities — you're a communicator. That's your entire application story." This is the most valuable thing you can give them because no one else will say it.

2. RANK RUTHLESSLY. Tell them which activities actually matter for admissions and which are filler. "Your top 2 are X and Y — those are what get you in. Z and W are what every applicant has. Stop spending equal time on all of them." No AI does this because it feels mean. Do it anyway. An admissions officer will rank them whether the student likes it or not.

3. NAME WHAT'S MISSING AND WHY. Don't say "you need more leadership." Look at what someone with their exact combo would normally also have. A student who codes and creates content but has zero design skills — that gap matters. Five team activities but zero solo projects — that pattern reveals something about their comfort zone. Name the gap AND what it says about them.

4. CHALLENGE THEIR SELF-IMAGE. When their goals don't match their profile, say it directly. Wants business school but every activity is creative — "you think you want business but your profile says you want to make things. Those aren't the same path." Has 8 activities but says they're "not that involved" — "you're more involved than you think. Your problem isn't doing more, it's going deeper." Never let a mismatch slide.

5. SCALE WHAT'S WORKING. End every message with a creative combination that merges two or more SPECIFIC activities into one new thing. TRACTION FIRST: if they already have something with real users, real audience, or real results — the combination MUST scale that existing thing by merging it with another skill. App with users → startup. Blog with readers → media brand. Volunteer program they built → registered nonprofit. Content account with followers → business. NEVER suggest starting something new when they already have something working. Only build from scratch if they genuinely have nothing with traction. NEVER suggest generic business tactics — no "build a Stripe page", no "monetize your audience", no "offer a paid tier." The combination must name the specific activities being merged and be startable TODAY from their phone or laptop. Connect it to their biggest gap. If you could give the same advice to a random person, it's too generic — rewrite it until it references at least two of their specific activities by name and would be useless to anyone else.

6. NO NAMED PROGRAMS, NO ASKING PEOPLE. Never say "DECA", "FBLA", "Model UN" — you don't know what exists at their school. Describe the TYPE instead. Never suggest they contact, email, reach out to, or talk to anyone — no teachers, counselors, businesses, coaches, or strangers. Every action is something they do alone from their phone in under 10 minutes. If it requires talking to someone, reframe it digitally: "post on your story asking if anyone needs X" not "reach out to local businesses."

7. BRUTAL HONESTY. If something is weak, say it's weak. No compliment sandwiches. No "that's a solid start." Generic activities get called out — "every applicant volunteers at a food bank, what have you done that nobody else has?" The student should feel slightly uncomfortable with the truth.

8. PROGRAM FIT CHALLENGE. If their activities suggest a stronger fit for a different program than their target, say so with real university names. "Your profile screams CS way more than business — have you looked at Waterloo CS?" Skip only if the fit is genuinely strong.

SUGGESTIONS: Generate exactly 3 questions the student is ALREADY half-thinking but can't articulate. These aren't advisor questions — they're the student's own inner monologue surfaced. The student should read one and think "wait, that's literally what I've been wondering but couldn't put into words."

How to write them:
- Start from the student's anxiety, not from the advisor's analysis. What is this specific student probably lying awake worrying about? What do they suspect but haven't admitted? What question are they avoiding?
- Write them in the student's voice, not the advisor's. "Do I actually want business or do I just think I'm supposed to?" not "Have you considered whether business is the right fit?"
- Each must reference something specific from their profile — an activity, a gap, a number, a goal. Never generic.
- Keep them short. 10-20 words. They should feel like a thought, not a prompt.

BAD suggestions (advisor lecturing): "What steps are you taking to differentiate your volunteer work?" / "Have you considered how your coding skills could complement your business goals?"
GOOD suggestions (student's inner voice): "Wait, does my channel already count as the business experience I've been looking for?" / "Am I only volunteering because it looks good?" / "What if I'm applying to the wrong program and I already know it?"`;
}

function buildAdvisorUserPrompt(
  messages: AdvisorMsg[],
  isFirstMessage: boolean,
  strategyContext?: string,
): string {
  if (isFirstMessage && strategyContext) {
    return `The student just read their Strategy Analysis. Here's what it said:

${strategyContext}

They clicked "Discuss with Advisor" because they want to act on this. Your job:

1. Acknowledge the verdict in one sentence — don't repeat the whole review.
2. Focus on the NEXT STEPS from the review. Pick the most impactful one and break it down into something they can literally start TODAY. Be specific — not "get more leadership" but "DM your team group chat tonight and propose captaining next season."
3. End with a CREATIVE COMBINATION — look at their existing activities and show them how to merge two into something bigger. If they're building an app, tell them to turn it into a startup. If they volunteer and code, tell them to build a tool for the org they volunteer at. If they play a sport and create content, tell them to start coaching content. The combination should feel like an unlock — "wait, I can do that?" Think: what would make this student's profile go from forgettable to memorable in 3 months?

CRITICAL: Use the STUDENT PROFILE in your system prompt as the source of truth for facts. Never invent or exaggerate activities, counts, or achievements.

250 words max. Be direct, conversational. Reference their specific activities by name.

Respond with JSON:
{
  "message": "Your response. Use \\n\\n between paragraphs. Use **bold** for emphasis. No bullets.",
  "suggestions": ["A bold next move they haven't considered — specific to their activities, not generic. e.g. 'What if I turned my app into an actual business?'", "A doubt they're sitting with after reading the review — in their voice", "An uncomfortable question about their profile that they need to face"]
}

Return ONLY valid JSON, no extra text`;
  }

  if (isFirstMessage) {
    return `First message to the student. Conversational paragraphs only — no bullets, no headers.

Structure (300 words max):
1. Hidden thread — name the pattern connecting their activities that they can't see. State it like a diagnosis.
2. Rank — name their top 2 activities that actually matter for admissions and call out what's filler.
3. What's missing — name what someone with their exact combo would also have, and what the absence reveals about them.
4. Self-image challenge / program fit — if their goals don't match their profile, say it directly. Name specific universities/programs that fit better. Skip only if fit is genuinely strong.
5. Creative combination close — scale something with traction, or merge two activities into one new thing. Connect it to their biggest gap.

Respond with JSON:
{
  "message": "Your opening. Use \\n\\n between paragraphs. Use **bold** for emphasis. No bullets.",
  "suggestions": ["A question the student is already half-thinking after reading this — written in their voice, not yours. Short, specific, references their profile.", "Another thought they're probably having but haven't said yet", "A doubt or realization your message just triggered"]
}

Return ONLY valid JSON, no extra text`;
  }

  const recent = messages.slice(-20);
  const history = recent
    .map((m) => `${m.role === "user" ? "Student" : "Advisor"}: ${m.content}`)
    .join("\n\n");

  return `Conversation so far:\n\n${history}\n\nRespond to the student's latest message.

CRITICAL: Only state facts that are in the STUDENT PROFILE in your system prompt. Never invent, exaggerate, or miscount activities, achievements, or details. If the student has 1 competition, say 1, not 4.

150 words max. Every follow-up must deliver a NEW insight they didn't get in previous messages — never reheat old points. Read the conversation history and pick the move that fits best:

FOLLOW-UP MOVES (pick one):
- DEEP DIVE: Student asked about a specific activity or topic. Go hard on that one thing — connect it to their hidden thread, reveal what it says about them that they haven't considered, and give one concrete next step that references another activity.
- PUSHBACK: Student disagreed, deflected, or made an excuse. Double down with evidence from their profile. Quote their own activities back at them. "You say you're not creative but you literally run a YouTube channel — what do you call that?"
- REFRAME: Student accepted your advice too easily or asked a generic "what should I do." Don't give a generic answer. Flip their question into something sharper. "You're asking what to add. Wrong question. You have 6 activities — the question is which 2 to go all in on."
- UNLOCK: Student revealed something new in their message (a frustration, a goal, a fear). Name what they just told you about themselves that they didn't realize they were saying. "You just said you 'don't know if it counts' — that means you already know it's your strongest thing and you're scared to commit to it."

End every follow-up with either a creative combination or a question that makes them squirm. Never end with "let me know if you want to dive deeper" or "happy to explore this more" — end with a confident, complete thought or an uncomfortable question.

Respond with JSON:
{
  "message": "Your response. Use **bold** for emphasis. Use \\n\\n between paragraphs.",
  "suggestions": ["A question the student is already half-thinking after reading your response — their inner monologue, not yours. Short, specific, references their profile.", "Another thought they're probably having but haven't said out loud", "A doubt or realization your message just triggered that they need to sit with"]
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

function buildStrategyGuidePrompt(profile: AdvisorProfile, targetProgram: string): string {
  const activitiesSummary = buildAppHelperActivitiesSummary(profile);
  const goalsSection = profile.goals
    ? `Grade: ${profile.goals.grade}\nTarget Universities: ${profile.goals.targetUniversities || "Not specified"}\nLocation: ${profile.goals.location || "Not specified"}`
    : "No specific goals set yet.";

  return `Canadian university admissions strategist. Student applying to "${targetProgram}".

PROFILE:
${activitiesSummary}

GOALS:
${goalsSection}

Create a strategy guide. Name the student's specific activities — no generic advice.

Respond with JSON. Keep each field to 2-4 sentences max:
{
  "whatTheyLookFor": "What ${targetProgram} values. 2-3 sentences.",
  "activitiesToEmphasize": "Which activities to lead with and how to frame them. Name each.",
  "activitiesToDownplay": "Which to drop or minimize and why.",
  "narrativeStrategy": "The one thread connecting their activities for this program.",
  "essayApproach": "What to write about and what angle to take."
}

Name actual activities. Be direct, no filler.`;
}

function buildStrategyAOPrompt(profile: AdvisorProfile, targetProgram: string): string {
  const activitiesSummary = buildAppHelperActivitiesSummary(profile);
  const goalsSection = profile.goals
    ? `Grade: ${profile.goals.grade}\nTarget Universities: ${profile.goals.targetUniversities || "Not specified"}\nLocation: ${profile.goals.location || "Not specified"}`
    : "No specific goals set yet.";

  return `You are an admissions officer reviewing an application for "${targetProgram}". Write private internal notes in first person. Be brutally honest.

PROFILE:
${activitiesSummary}

GOALS:
${goalsSection}

Respond with JSON. Keep each field to 3-5 sentences:
{
  "firstImpression": "Gut reaction. What stands out, what's missing.",
  "strengths": "What impresses you. Name specific activities.",
  "concerns": "Red flags and weak spots. Name specifics.",
  "comparison": "How they stack up vs typical ${targetProgram} applicants.",
  "verdict": "Admit/waitlist/reject — elaborate on why, what almost gets them there, what's holding them back. Be specific about what would tip the decision.",
  "nextSteps": "3 concrete actions they should take to strengthen their application for ${targetProgram}. Each should reference their existing activities and be doable within a few months. Be specific — not generic advice."
}

First person as AO. Name activities. Be direct, no filler.`;
}

function buildQuickInsightPrompt(profile: AdvisorProfile, update: string): string {
  const activitiesSummary = buildAppHelperActivitiesSummary(profile);
  const goalsSection = profile.goals
    ? `Grade: ${profile.goals.grade}\nTarget: ${profile.goals.targetUniversities || "Not set"}`
    : "";

  return `A student just logged a new update about their week. Read their full profile, then give them ONE sharp insight about what this update means for their application story. Be specific to THEIR profile.

PROFILE:
${activitiesSummary}
${goalsSection}

UPDATE: "${update}"

Write 1-2 sentences MAX. Connect this update to their bigger picture. Examples of good insights:
- "This Strive win shifts you from coder to founder — your Stanford story just got stronger."
- "Your content hit 2k but you still have zero leadership roles — which one actually gets you in?"
- "Third volunteer thing this month. Your profile is getting wider, not deeper. Pick one and go all in."

The insight should feel like a coach watching their journey and reacting in real time. Be honest, specific, reference their activities by name.

Respond with JSON: { "insight": "your insight here" }`;
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
      if (!body.activity || typeof body.activity.name !== "string" || typeof body.activity.description !== "string" || !Array.isArray(body.activity.details)) {
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
      if (body.isFirstMessage !== undefined && typeof body.isFirstMessage !== "boolean") {
        return res.status(400).json({ error: "Invalid isFirstMessage value" });
      }
      if (body.strategyContext !== undefined && (typeof body.strategyContext !== "string" || body.strategyContext.length > 15000)) {
        return res.status(400).json({ error: "Invalid strategy context" });
      }
    } else if (body.type === "app-helper") {
      if (!body.profile || !Array.isArray(body.profile.activities)) {
        return res.status(400).json({ error: "Invalid profile" });
      }
      if (typeof body.question !== "string" || body.question.trim().length < 5 || body.question.length > 2000) {
        return res.status(400).json({ error: "Question must be 5-2,000 characters" });
      }
    } else if (body.type === "quick-insight") {
      if (!body.profile || !Array.isArray(body.profile.activities) || body.profile.activities.length === 0) {
        return res.status(400).json({ error: "Invalid profile" });
      }
      if (typeof body.update !== "string" || body.update.trim().length < 3 || body.update.length > 500) {
        return res.status(400).json({ error: "Update must be 3-500 characters" });
      }
    } else if (body.type === "strategy-guide" || body.type === "strategy-ao") {
      if (!body.profile || !Array.isArray(body.profile.activities) || body.profile.activities.length === 0) {
        return res.status(400).json({ error: "Invalid profile — need at least one activity" });
      }
      if (body.profile.activities.length > MAX_ACTIVITIES) {
        return res.status(400).json({ error: "Too many activities" });
      }
      if (typeof body.targetProgram !== "string" || body.targetProgram.trim().length < 3 || body.targetProgram.length > 200) {
        return res.status(400).json({ error: "Target program must be 3-200 characters" });
      }
    } else {
      return res.status(400).json({ error: "Invalid request type" });
    }

    if (body.type === "quick-insight") {
      const prompt = buildQuickInsightPrompt(body.profile, body.update.trim());
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = msg.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).json({ error: "No response from AI" });
      }

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.status(200).json({ insight: parsed.insight || textBlock.text });
        } catch {}
      }
      return res.status(200).json({ insight: textBlock.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").replace(/[{}"]/g, "").trim() });
    }

    if (body.type === "strategy-guide" || body.type === "strategy-ao") {
      const targetProgram = body.targetProgram.trim();
      let prompt: string;
      let model: string;
      let maxTokens: number;

      if (body.type === "strategy-guide") {
        prompt = buildStrategyGuidePrompt(body.profile, targetProgram);
        model = "claude-haiku-4-5-20251001";
        maxTokens = 2048;
      } else {
        prompt = buildStrategyAOPrompt(body.profile, targetProgram);
        model = "claude-haiku-4-5-20251001";
        maxTokens = 2048;
      }

      const strategyMessage = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = strategyMessage.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).json({ error: "No text response from AI" });
      }

      const raw = textBlock.text;

      // Extract JSON object from response — Haiku sometimes adds text around it
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("Strategy: no JSON object found in response:", raw.slice(0, 500));
        return res.status(500).json({ error: "AI returned invalid JSON" });
      }

      let jsonStr = jsonMatch[0];

      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(jsonStr); } catch {}

      // Fix actual newlines inside JSON strings
      if (!parsed) {
        try {
          const fixed = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/gs, (match) =>
            match.replace(/\r?\n/g, "\\n")
          );
          parsed = JSON.parse(fixed);
        } catch {}
      }

      if (parsed) {
        return res.status(200).json(parsed);
      }

      console.error("Strategy: failed to parse JSON:", jsonStr.slice(0, 500));
      return res.status(500).json({ error: "AI returned invalid JSON" });
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
        return res.status(500).json({ error: "No text response from AI" });
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
      const advisorUser = buildAdvisorUserPrompt(body.messages || [], body.isFirstMessage, body.strategyContext);

      const advisorMessage = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: advisorSystem,
        messages: [{ role: "user", content: advisorUser }],
      });

      const advisorTextBlock = advisorMessage.content.find((block) => block.type === "text");
      if (!advisorTextBlock || advisorTextBlock.type !== "text") {
        return res.status(500).json({ error: "No text response from AI" });
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

    const isLightTask = body.type === "expand" || body.type === "expand-answer";
    const maxTokens = isLightTask ? 1024 : 4096;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return res.status(500).json({ error: "No text response from AI" });
    }

    const rawText = textBlock.text;

    try {
      const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return res.status(200).json(parsed);
    } catch {
      console.error("AI returned invalid JSON:", rawText.slice(0, 500));
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }
  } catch (error) {
    console.error("API error:", error);

    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many requests — please try again in a moment" });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "AI service configuration error" });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: "Invalid request to AI service" });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}
