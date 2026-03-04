import type { ParsedActivity } from "./activity";

export interface RawBrainDump {
  text: string;
  submittedAt: Date;
}

export interface FollowUpQuestion {
  id: string;
  activityId: string;
  activityName: string;
  question: string;
  answer?: string;
  skipped: boolean;
}

export interface StudentProfile {
  activities: ParsedActivity[];
  lastUpdated: Date;
}

export interface FollowUpRound {
  roundNumber: number;
  questions: FollowUpQuestion[];
  completed: boolean;
}

export type AppView = "input" | "chat" | "profile";

export interface ParseRequest {
  type: "parse";
  text: string;
}

export interface FollowUpRequest {
  type: "followup";
  activities: ParsedActivity[];
  answers: { questionId: string; activityId: string; question: string; answer: string }[];
}

export interface ParseResponse {
  activities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}

export interface FollowUpResponse {
  updatedActivities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}
