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
      <h2 className="mb-4 border-b border-white/[0.08] pb-2 text-xl font-bold text-white">
        {getCategoryDisplayName(category)}
      </h2>
      <div className="space-y-4">
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
