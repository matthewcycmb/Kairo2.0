import { useState } from "react";
import type { ParsedActivity } from "../types/activity";
import { callApi } from "../lib/apiClient";
import EditableField from "./EditableField";
import LoadingSpinner from "./LoadingSpinner";

interface ActivityCardProps {
  activity: ParsedActivity;
  onEdit: (id: string, updates: Partial<ParsedActivity>) => void;
}

function getDepthScore(a: ParsedActivity): number {
  let score = 0;
  if (a.description && a.description.length > 30) score++;
  if (a.details.length > 0) score += Math.min(a.details.length, 3);
  if (a.role) score++;
  if (a.yearsActive) score++;
  if (a.hoursPerWeek) score++;
  if (a.achievements && a.achievements.length > 0) score += a.achievements.length;
  return score;
}

export default function ActivityCard({ activity, onEdit }: ActivityCardProps) {
  const [expanding, setExpanding] = useState(false);
  const [expandQuestions, setExpandQuestions] = useState<string[]>([]);
  const [expandAnswers, setExpandAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);

  const depth = getDepthScore(activity);
  const isShallow = depth < 3;
  const isRich = depth >= 5;

  const handleExpand = async () => {
    setLoading(true);
    try {
      const response = await callApi({ type: "expand", activity });
      setExpandQuestions(response.questions);
      setExpanding(true);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitExpand = async () => {
    const answered = Object.entries(expandAnswers)
      .filter(([, v]) => v.trim())
      .map(([i, v]) => ({ question: expandQuestions[Number(i)], answer: v.trim() }));

    if (answered.length === 0) {
      setExpanding(false);
      return;
    }

    setLoading(true);
    try {
      const response = await callApi({
        type: "expand-answer",
        activity,
        answers: answered,
      });
      onEdit(activity.id, response.updatedActivity);
      setExpanding(false);
      setExpandQuestions([]);
      setExpandAnswers({});
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const allExpandAnswered = expandQuestions.length > 0 &&
    expandQuestions.every((_, i) => expandAnswers[i] !== undefined && expandAnswers[i] !== "");

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isRich
          ? "border-blue-200 bg-white shadow-md"
          : isShallow
            ? "border-dashed border-gray-300 bg-gray-50/50"
            : "border-gray-200 bg-white shadow-sm"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <EditableField
          value={activity.name}
          onSave={(name) => onEdit(activity.id, { name })}
          className={`font-semibold ${isRich ? "text-lg text-gray-900" : "text-base text-gray-700"}`}
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

      {/* Expand flow */}
      {loading && <LoadingSpinner message="Thinking..." />}

      {expanding && !loading && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
          {expandQuestions.map((q, i) => (
            <div key={i}>
              <p className="mb-1 text-sm text-gray-700">{q}</p>
              <input
                type="text"
                value={expandAnswers[i] || ""}
                onChange={(e) => setExpandAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                placeholder="Your answer..."
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              onClick={handleSubmitExpand}
              disabled={!allExpandAnswered}
              className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => { setExpanding(false); setExpandAnswers({}); }}
              className="rounded-lg px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!expanding && !loading && (
        <button
          onClick={handleExpand}
          className={`mt-3 text-sm font-medium ${
            isShallow
              ? "text-blue-500 hover:text-blue-600"
              : "text-gray-400 hover:text-gray-500"
          }`}
        >
          {isShallow ? "Tell me more about this →" : "Expand this →"}
        </button>
      )}
    </div>
  );
}
