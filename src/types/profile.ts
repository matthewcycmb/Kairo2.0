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

export interface StudentGoals {
  grade: 9 | 10 | 11 | 12;
  targetUniversities: string;
  location: string;
}

export interface AdvisorAnalysis {
  strengths: string[];
  gaps: string[];
  actionStep: string;
}

export interface AdvisorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  analysis?: AdvisorAnalysis;
}

export interface StudentProfile {
  activities: ParsedActivity[];
  lastUpdated: Date;
  goals?: StudentGoals;
  advisorMessages?: AdvisorMessage[];
}

export interface FollowUpRound {
  roundNumber: number;
  questions: FollowUpQuestion[];
  completed: boolean;
}

export type AppView = "input" | "chat" | "profile" | "goals" | "loading";

export interface ParseRequest {
  type: "parse";
  text: string;
}

export interface FollowUpRequest {
  type: "followup";
  activities: ParsedActivity[];
  answers: { questionId: string; activityId: string; question: string; answer: string }[];
}

export interface ExpandRequest {
  type: "expand";
  activity: ParsedActivity;
}

export interface ExpandAnswerRequest {
  type: "expand-answer";
  activity: ParsedActivity;
  answers: { question: string; answer: string }[];
}

export interface ParseResponse {
  activities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}

export interface FollowUpResponse {
  updatedActivities: ParsedActivity[];
  followUpQuestions: FollowUpQuestion[];
}

export interface ExpandResponse {
  questions: string[];
}

export interface ExpandAnswerResponse {
  updatedActivity: ParsedActivity;
}

export interface AdvisorRequest {
  type: "advisor";
  profile: StudentProfile;
  messages: AdvisorMessage[];
  isFirstMessage: boolean;
}

export interface AdvisorResponse {
  message: string;
  analysis?: AdvisorAnalysis;
}
