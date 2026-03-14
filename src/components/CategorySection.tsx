import type { ParsedActivity, ActivityCategory } from "../types/activity";
import { getCategoryDisplayName } from "../lib/profileUtils";
import ActivityCard from "./ActivityCard";

interface CategorySectionProps {
  category: ActivityCategory;
  activities: ParsedActivity[];
  onEditActivity: (id: string, updates: Partial<ParsedActivity>) => void;
}

export default function CategorySection({
  category,
  activities,
  onEditActivity,
}: CategorySectionProps) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-sm font-medium tracking-wide text-white/40">
          {getCategoryDisplayName(category)}
        </h2>
        <span className="text-xs text-white/15">{activities.length}</span>
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
