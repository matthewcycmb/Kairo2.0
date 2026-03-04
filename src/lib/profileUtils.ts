import type { ParsedActivity, ActivityCategory } from "../types/activity";
import type { StudentProfile } from "../types/profile";

const CATEGORY_ORDER: ActivityCategory[] = [
  "Sports",
  "Arts & Music",
  "Clubs",
  "Volunteering",
  "Work & Leadership",
  "Certifications",
  "Academics",
];

function activityDetailCount(a: ParsedActivity): number {
  let count = a.details.length;
  if (a.role) count++;
  if (a.yearsActive) count++;
  if (a.hoursPerWeek) count++;
  if (a.achievements && a.achievements.length > 0) count += a.achievements.length;
  return count;
}

export function groupByCategory(
  activities: ParsedActivity[]
): Map<ActivityCategory, ParsedActivity[]> {
  const grouped = new Map<ActivityCategory, ParsedActivity[]>();

  for (const category of CATEGORY_ORDER) {
    const matching = activities
      .filter((a) => a.category === category)
      .sort((a, b) => activityDetailCount(b) - activityDetailCount(a));
    if (matching.length > 0) {
      grouped.set(category, matching);
    }
  }

  return grouped;
}

const CATEGORY_DISPLAY: Record<ActivityCategory, string> = {
  Sports: "Sports & Athletics",
  "Arts & Music": "Arts & Music",
  Clubs: "Clubs & Organizations",
  Volunteering: "Volunteering & Community",
  "Work & Leadership": "Work & Leadership",
  Certifications: "Certifications & Awards",
  Academics: "Academics",
};

export function getCategoryDisplayName(category: ActivityCategory): string {
  return CATEGORY_DISPLAY[category];
}

export function formatProfileAsText(profile: StudentProfile): string {
  const grouped = groupByCategory(profile.activities);
  const lines: string[] = ["MY ACTIVITY PROFILE", "=".repeat(40), ""];

  for (const [category, activities] of grouped) {
    lines.push(getCategoryDisplayName(category).toUpperCase());
    lines.push("-".repeat(getCategoryDisplayName(category).length));

    for (const activity of activities) {
      lines.push(`  ${activity.name}`);
      if (activity.role) lines.push(`    Role: ${activity.role}`);
      if (activity.description) lines.push(`    ${activity.description}`);
      if (activity.yearsActive) lines.push(`    Duration: ${activity.yearsActive}`);
      if (activity.hoursPerWeek) lines.push(`    Hours/week: ${activity.hoursPerWeek}`);
      if (activity.achievements && activity.achievements.length > 0) {
        lines.push(`    Achievements: ${activity.achievements.join(", ")}`);
      }
      if (activity.skills && activity.skills.length > 0) {
        lines.push(`    Skills: ${activity.skills.join(", ")}`);
      }
      if (activity.details.length > 0) {
        for (const detail of activity.details) {
          lines.push(`    - ${detail}`);
        }
      }
      lines.push("");
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function copyProfileToClipboard(
  profile: StudentProfile
): Promise<void> {
  const text = formatProfileAsText(profile);
  await navigator.clipboard.writeText(text);
}
