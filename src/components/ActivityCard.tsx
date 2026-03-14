import { useState } from "react";
import type { ParsedActivity } from "../types/activity";
import { callApi } from "../lib/apiClient";
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParsedActivity>(activity);
  const [collapsed, setCollapsed] = useState(true);

  const depth = getDepthScore(activity);
  const isShallow = depth < 3;
  const isRich = depth >= 5;

  const startEditing = () => {
    setDraft({ ...activity });
    setEditing(true);
  };

  const saveEdits = () => {
    setEditing(false);
    onEdit(activity.id, draft);
  };

  const cancelEdits = () => {
    setEditing(false);
    setDraft(activity);
  };

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

  const hasCollapsibleContent = activity.details.length > 0 ||
    (activity.achievements && activity.achievements.length > 0) ||
    (activity.skills && activity.skills.length > 0);

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 transition-all sm:p-6 cursor-pointer sm:cursor-default`}
      onClick={(e) => {
        // Only toggle on mobile, skip if clicking a button/input/textarea
        if (editing) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea, a")) return;
        setCollapsed((c) => !c);
      }}
    >
      {/* Title + Badge: stacked on mobile, side-by-side on sm+ */}
      <div
        className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2"
      >
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="w-full border-b-2 border-blue-400 bg-transparent text-lg font-bold text-white outline-none"
            />
          ) : (
            <h3 className="text-lg font-bold text-white">{activity.name}</h3>
          )}
        </div>
        {editing ? (
          <input
            type="text"
            value={draft.role || ""}
            onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value || undefined }))}
            placeholder="Role"
            className="shrink-0 rounded-full border-b-2 border-blue-400 bg-transparent px-3 py-1 text-sm font-medium text-blue-300 outline-none placeholder:text-blue-300/40"
          />
        ) : activity.role ? (
          <span className="self-start rounded-full border border-white/[0.10] bg-white/[0.08] px-3 py-1 text-sm font-medium text-white/60 sm:shrink-0">
            {activity.role}
          </span>
        ) : null}
      </div>

      {editing ? (
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          rows={2}
          className="w-full resize-none border-b-2 border-blue-400 bg-transparent text-sm leading-relaxed text-white/70 outline-none sm:text-base"
        />
      ) : (
        <p className={`text-sm leading-relaxed text-white/70 sm:text-base ${collapsed ? "line-clamp-3" : ""}`}>{activity.description}</p>
      )}

      {/* Collapsible content */}
      <div className={`${collapsed ? "hidden" : "block"}`}>
        {editing ? (
          <div className="mt-2 space-y-1.5">
            {draft.details.map((detail, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-white/40">•</span>
                <input
                  type="text"
                  value={detail}
                  onChange={(e) => {
                    const newDetails = [...draft.details];
                    newDetails[i] = e.target.value;
                    setDraft((d) => ({ ...d, details: newDetails }));
                  }}
                  className="flex-1 border-b-2 border-blue-400 bg-transparent text-sm leading-relaxed text-white/60 outline-none sm:text-base"
                />
                <button
                  onClick={() => {
                    const newDetails = draft.details.filter((_, j) => j !== i);
                    setDraft((d) => ({ ...d, details: newDetails }));
                  }}
                  className="shrink-0 text-sm text-white/30 hover:text-red-400"
                >
                  x
                </button>
              </div>
            ))}
            <button
              onClick={() => setDraft((d) => ({ ...d, details: [...d.details, ""] }))}
              className="text-sm text-white/40 hover:text-white/60"
            >
              + Add detail
            </button>
          </div>
        ) : activity.details.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {activity.details.map((detail, i) => (
              <li key={i} className="text-sm leading-relaxed text-white/60 before:mr-1.5 before:content-['•'] sm:text-base">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}

        {editing ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <input
              type="text"
              value={draft.yearsActive || ""}
              onChange={(e) => setDraft((d) => ({ ...d, yearsActive: e.target.value || undefined }))}
              placeholder="Years active (e.g. Grade 9-11)"
              className="border-b-2 border-blue-400 bg-transparent text-sm text-white/40 outline-none placeholder:text-white/25"
            />
            <input
              type="number"
              value={draft.hoursPerWeek ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, hoursPerWeek: e.target.value ? Number(e.target.value) : undefined }))}
              placeholder="Hrs/week"
              className="w-24 border-b-2 border-blue-400 bg-transparent text-sm text-white/40 outline-none placeholder:text-white/25"
            />
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/40">
            {activity.yearsActive && <span>{activity.yearsActive}</span>}
            {activity.hoursPerWeek && <span>{activity.hoursPerWeek} hrs/week</span>}
          </div>
        )}

        {editing ? (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-yellow-300/60">Achievements</p>
            {(draft.achievements ?? []).map((ach, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={ach}
                  onChange={(e) => {
                    const newAch = [...(draft.achievements ?? [])];
                    newAch[i] = e.target.value;
                    setDraft((d) => ({ ...d, achievements: newAch }));
                  }}
                  className="flex-1 border-b-2 border-blue-400 bg-transparent text-sm font-medium text-yellow-300 outline-none"
                />
                <button
                  onClick={() => {
                    const newAch = (draft.achievements ?? []).filter((_, j) => j !== i);
                    setDraft((d) => ({ ...d, achievements: newAch }));
                  }}
                  className="shrink-0 text-sm text-white/30 hover:text-red-400"
                >
                  x
                </button>
              </div>
            ))}
            <button
              onClick={() => setDraft((d) => ({ ...d, achievements: [...(d.achievements ?? []), ""] }))}
              className="text-sm text-white/40 hover:text-white/60"
            >
              + Add achievement
            </button>
          </div>
        ) : activity.achievements && activity.achievements.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {activity.achievements.map((achievement, i) => (
              <span
                key={i}
                className="rounded-full bg-yellow-500/15 px-3 py-1 text-sm font-medium text-yellow-300"
              >
                {achievement}
              </span>
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-white/40">Skills</p>
            {(draft.skills ?? []).map((skill, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={skill}
                  onChange={(e) => {
                    const newSkills = [...(draft.skills ?? [])];
                    newSkills[i] = e.target.value;
                    setDraft((d) => ({ ...d, skills: newSkills }));
                  }}
                  className="flex-1 border-b-2 border-blue-400 bg-transparent text-sm text-white/70 outline-none"
                />
                <button
                  onClick={() => {
                    const newSkills = (draft.skills ?? []).filter((_, j) => j !== i);
                    setDraft((d) => ({ ...d, skills: newSkills }));
                  }}
                  className="shrink-0 text-sm text-white/30 hover:text-red-400"
                >
                  x
                </button>
              </div>
            ))}
            <button
              onClick={() => setDraft((d) => ({ ...d, skills: [...(d.skills ?? []), ""] }))}
              className="text-sm text-white/40 hover:text-white/60"
            >
              + Add skill
            </button>
          </div>
        ) : activity.skills && activity.skills.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {activity.skills.map((skill, i) => (
              <span
                key={i}
                className="rounded-full border border-white/[0.10] bg-white/[0.08] px-3 py-1 text-sm capitalize text-white/70"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : null}

        {isShallow && !expanding && !loading && !editing && (
          <p className="mt-3 text-sm text-white/40 italic">
            This could be stronger — add more detail
          </p>
        )}

        {/* Expand flow */}
        {loading && <LoadingSpinner message="Thinking..." />}

        {expanding && !loading && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
            {expandQuestions.map((q, i) => (
              <div key={i}>
                <p className="mb-1 text-sm text-white/80 sm:text-base">{q}</p>
                <input
                  type="text"
                  value={expandAnswers[i] || ""}
                  onChange={(e) => setExpandAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                  placeholder="Your answer..."
                  className="w-full rounded-lg border border-white/[0.15] bg-white/[0.05] px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none sm:text-base"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={handleSubmitExpand}
                disabled={!allExpandAnswered}
                className="rounded-lg border border-white/[0.12] bg-white/[0.10] px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/[0.16] disabled:opacity-40 sm:text-base"
              >
                Save
              </button>
              <button
                onClick={() => { setExpanding(false); setExpandAnswers({}); }}
                className="px-4 py-2.5 text-sm text-white/50 hover:text-white/70 sm:text-base"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!expanding && !loading && (
          <div className="mt-3 flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={saveEdits}
                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.10] px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.16]"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdits}
                  className="px-3 py-1.5 text-sm text-white/50 hover:text-white/70"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleExpand}
                  className={
                    isShallow
                      ? "flex-1 rounded-lg border border-white/[0.12] bg-white/[0.06] py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.12] sm:text-base"
                      : "inline-flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.06] px-4 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white/80"
                  }
                >
                  {isShallow ? "Add more detail +" : isRich ? <>Expand this <span aria-hidden>→</span></> : <>Add more detail <span aria-hidden>→</span></>}
                </button>
                <button
                  onClick={startEditing}
                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.06] px-4 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white/80"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Collapsed: show expand hint */}
      {collapsed && hasCollapsibleContent && !editing && (
        <button
          onClick={() => setCollapsed(false)}
          className="mt-3 flex items-center gap-1 text-xs text-white/35 hover:text-white/50"
        >
          <span>Show details</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3"><path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
        </button>
      )}
    </div>
  );
}
