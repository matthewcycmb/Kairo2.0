import type { ParsedActivity } from "../types/activity";
import EditableField from "./EditableField";

interface ActivityCardProps {
  activity: ParsedActivity;
  onEdit: (id: string, updates: Partial<ParsedActivity>) => void;
}

export default function ActivityCard({ activity, onEdit }: ActivityCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <EditableField
          value={activity.name}
          onSave={(name) => onEdit(activity.id, { name })}
          className="text-lg font-semibold text-gray-900"
          as="h3"
        />
        {activity.role && (
          <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {activity.role}
          </span>
        )}
      </div>

      <EditableField
        value={activity.description}
        onSave={(description) => onEdit(activity.id, { description })}
        className="text-sm text-gray-600"
        as="p"
      />

      {activity.details.length > 0 && (
        <ul className="mt-2 space-y-1">
          {activity.details.map((detail, i) => (
            <li key={i} className="text-sm text-gray-500 before:mr-1.5 before:content-['•']">
              {detail}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        {activity.yearsActive && <span>{activity.yearsActive}</span>}
        {activity.hoursPerWeek && <span>{activity.hoursPerWeek} hrs/week</span>}
      </div>

      {activity.achievements && activity.achievements.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activity.achievements.map((achievement, i) => (
            <span
              key={i}
              className="rounded-full bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700"
            >
              {achievement}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
