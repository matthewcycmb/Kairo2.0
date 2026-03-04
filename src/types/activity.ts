export type ActivityCategory =
  | "Academics"
  | "Sports"
  | "Arts & Music"
  | "Volunteering"
  | "Clubs"
  | "Work & Leadership"
  | "Certifications";

export interface ParsedActivity {
  id: string;
  name: string;
  category: ActivityCategory;
  description: string;
  details: string[];
  yearsActive?: string;
  role?: string;
  achievements?: string[];
  hoursPerWeek?: number;
  isDetailedEnough: boolean;
}
