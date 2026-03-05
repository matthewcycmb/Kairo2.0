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
  if (a.skills && a.skills.length > 0) score += 1;
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
      setExpandQuestions(response.questions.slice(0, 2));
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
      className={`rounded-xl border p-4 transition-all backdrop-blur-[40px] hover:bg-white/[0.10] ${
        isRich
          ? "border-white/[0.15] bg-white/[0.08]"
          : isShallow
            ? "border-white/[0.10] bg-white/[0.04]"
            : "border-white/[0.12] bg-white/[0.06]"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <EditableField
            value={activity.name}
            onSave={(name) => onEdit(activity.id, { name })}
            className={`font-semibold ${isRich ? "text-lg text-white" : "text-base text-white/90"}`}
            as="h3"
          />
        </div>
        {activity.role && (
          <span className="shrink-0 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-300">
            {activity.role}
          </span>
        )}
      </div>

      <EditableField
        value={activity.description}
        onSave={(description) => onEdit(activity.id, { description })}
        className="text-sm text-white/70"
        as="p"
      />

      {activity.details.length > 0 && (
        <ul className="mt-2 space-y-1">
          {activity.details.map((detail, i) => (
            <li key={i} className="text-sm text-white/60 before:mr-1.5 before:content-['•']">
              {detail}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
        {activity.yearsActive && <span>{activity.yearsActive}</span>}
        {activity.hoursPerWeek && <span>{activity.hoursPerWeek} hrs/week</span>}
      </div>

      {activity.achievements && activity.achievements.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activity.achievements.map((achievement, i) => (
            <span
              key={i}
              className="rounded-full bg-yellow-500/15 px-2.5 py-0.5 text-xs font-medium text-yellow-300"
            >
              {achievement}
            </span>
          ))}
        </div>
      )}

      {activity.skills && activity.skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {activity.skills.map((skill, i) => (
            <span
              key={i}
              className="rounded-full border border-white/[0.10] bg-white/[0.08] px-2.5 py-0.5 text-xs text-white/70"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {isShallow && !expanding && !loading && (
        <p className="mt-3 text-xs text-white/40 italic">
          This could be stronger — add more detail
        </p>
      )}

      {/* Expand flow */}
      {loading && <LoadingSpinner message="Thinking..." />}

      {expanding && !loading && (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
          {expandQuestions.map((q, i) => (
            <div key={i}>
              <p className="mb-1 text-sm text-white/80">{q}</p>
              <input
                type="text"
                value={expandAnswers[i] || ""}
                onChange={(e) => setExpandAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                placeholder="Your answer..."
                className="w-full rounded-lg border border-white/[0.15] bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              onClick={handleSubmitExpand}
              disabled={!allExpandAnswered}
              className="rounded-lg border border-white/[0.12] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/[0.16] disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => { setExpanding(false); setExpandAnswers({}); }}
              className="px-4 py-2 text-sm text-white/50 hover:text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!expanding && !loading && (
        <button
          onClick={handleExpand}
          className={
            isShallow
              ? "mt-3 w-full rounded-lg border border-white/[0.12] bg-white/[0.06] py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12]"
              : "mt-3 inline-flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1 text-xs text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white/80"
          }
        >
          {isShallow ? "Add more detail +" : isRich ? <>Expand this <span aria-hidden>→</span></> : <>Add more detail <span aria-hidden>→</span></>}
        </button>
      )}
    </div>
  );
}
