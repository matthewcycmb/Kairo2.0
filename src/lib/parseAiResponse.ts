import type { ParsedActivity } from "../types/activity";
import type { FollowUpQuestion } from "../types/profile";

interface ParsedAiOutput {
  activities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}

interface FollowUpAiOutput {
  updatedActivities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}

export function parseInitialResponse(raw: string): ParsedAiOutput {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.activities)) {
    throw new Error("Invalid response: missing activities array");
  }

  const activities: ParsedActivity[] = parsed.activities.map(
    (a: ParsedActivity, i: number) => ({
      id: a.id || `act_${i + 1}`,
      name: a.name || "Unnamed Activity",
      category: a.category || "Clubs",
      description: a.description || "",
      details: Array.isArray(a.details) ? a.details : [],
      yearsActive: a.yearsActive || undefined,
      role: a.role || undefined,
      achievements: Array.isArray(a.achievements) ? a.achievements : undefined,
      hoursPerWeek: typeof a.hoursPerWeek === "number" ? a.hoursPerWeek : undefined,
      isDetailedEnough: Boolean(a.isDetailedEnough),
    })
  );

  const followUpQuestions: FollowUpQuestion[] = (
    parsed.followUpQuestions || []
  ).map((q: FollowUpQuestion, i: number) => ({
    id: q.id || `q_${i + 1}`,
    activityId: q.activityId,
    activityName: q.activityName || "",
    question: q.question,
    answer: undefined,
    skipped: false,
  }));

  return { activities, followUpQuestions };
}

export function parseFollowUpResponse(raw: string): FollowUpAiOutput {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.updatedActivities)) {
    throw new Error("Invalid response: missing updatedActivities array");
  }

  const updatedActivities: ParsedActivity[] = parsed.updatedActivities.map(
    (a: ParsedActivity, i: number) => ({
      id: a.id || `act_${i + 1}`,
      name: a.name || "Unnamed Activity",
      category: a.category || "Clubs",
      description: a.description || "",
      details: Array.isArray(a.details) ? a.details : [],
      yearsActive: a.yearsActive || undefined,
      role: a.role || undefined,
      achievements: Array.isArray(a.achievements) ? a.achievements : undefined,
      hoursPerWeek: typeof a.hoursPerWeek === "number" ? a.hoursPerWeek : undefined,
      isDetailedEnough: Boolean(a.isDetailedEnough),
    })
  );

  const followUpQuestions: FollowUpQuestion[] = (
    parsed.followUpQuestions || []
  ).map((q: FollowUpQuestion, i: number) => ({
    id: q.id || `q_${i + 1}`,
    activityId: q.activityId,
    activityName: q.activityName || "",
    question: q.question,
    answer: undefined,
    skipped: false,
  }));

  return { updatedActivities, followUpQuestions };
}
