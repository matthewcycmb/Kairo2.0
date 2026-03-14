import type { ParsedActivity, ActivityCategory } from "../types/activity";
import { getCategoryDisplayName } from "../lib/profileUtils";
import ActivityCard from "./ActivityCard";

interface CategorySectionProps {
  category: ActivityCategory;
  activities: ParsedActivity[];
  onEditActivity: (id: string, updates: Partial<ParsedActivity>) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  Academics: "📚",
  Sports: "⚡",
  "Arts & Music": "🎨",
  Volunteering: "💛",
  Clubs: "🏛",
  "Work & Leadership": "🚀",
  Certifications: "✦",
};

export default function CategorySection({
  category,
  activities,
  onEditActivity,
}: CategorySectionProps) {
  const icon = CATEGORY_ICONS[category] || "•";
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2.5 border-b border-white/[0.06] pb-2.5">
        <span className="text-base">{icon}</span>
        <h2 className="text-base font-semibold text-white/80">
          {getCategoryDisplayName(category)}
        </h2>
        <span className="text-xs text-white/25">{activities.length}</span>
      </div>
      <div className="space-y-3">
        {activities.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            onEdit={onEditActivity}
          />
        ))}
      </div>
    </section>
  );
}
