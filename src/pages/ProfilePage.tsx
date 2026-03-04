import { useState, useMemo } from "react";
import type { ParsedActivity } from "../types/activity";
import type { StudentProfile, FollowUpQuestion } from "../types/profile";
import { groupByCategory, copyProfileToClipboard } from "../lib/profileUtils";
import { callApi } from "../lib/apiClient";
import CategorySection from "../components/CategorySection";
import LoadingSpinner from "../components/LoadingSpinner";

interface ProfilePageProps {
  profile: StudentProfile;
  onEditActivity: (id: string, updates: Partial<ParsedActivity>) => void;
  onAddActivities: (activities: ParsedActivity[]) => void;
  onStartOver: () => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  isLoading: boolean;
  error: string | null;
}

export default function ProfilePage({
  profile,
  onEditActivity,
  onAddActivities,
  onStartOver,
  setIsLoading,
  setError,
  isLoading,
  error,
}: ProfilePageProps) {
  const [forgotStep, setForgotStep] = useState<"idle" | "input" | "followup">("idle");
  const [forgotText, setForgotText] = useState("");
  const [newActivities, setNewActivities] = useState<ParsedActivity[]>([]);
  const [forgotQuestions, setForgotQuestions] = useState<FollowUpQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentActivityIdx, setCurrentActivityIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const grouped = groupByCategory(profile.activities);

  // Group follow-up questions by activity (max 2 per activity)
  const activitiesWithQuestions = useMemo(() => {
    const result: { activityName: string; activityId: string; questions: FollowUpQuestion[] }[] = [];
    const seen = new Map<string, number>();

    for (const q of forgotQuestions) {
      const idx = seen.get(q.activityId);
      if (idx !== undefined) {
        if (result[idx].questions.length < 2) {
          result[idx].questions.push(q);
        }
      } else {
        seen.set(q.activityId, result.length);
        result.push({ activityName: q.activityName, activityId: q.activityId, questions: [q] });
      }
    }
    return result;
  }, [forgotQuestions]);

  const currentForgotActivity = activitiesWithQuestions[currentActivityIdx];
  const totalForgotActivities = activitiesWithQuestions.length;
  const isLastForgotActivity = currentActivityIdx === totalForgotActivities - 1;

  const currentActivityDone =
    currentForgotActivity?.questions.every(
      (q) => answers[q.id] !== undefined && answers[q.id] !== ""
    ) ?? false;

  const handleCopy = async () => {
    try {
      await copyProfileToClipboard(profile);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  const resetForgotState = () => {
    setForgotStep("idle");
    setForgotText("");
    setNewActivities([]);
    setForgotQuestions([]);
    setAnswers({});
    setCurrentActivityIdx(0);
  };

  const handleForgotSubmit = async () => {
    if (forgotText.trim().length < 10) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await callApi({ type: "parse", text: forgotText.trim() });

      if (response.activities.length === 0) {
        setError("Couldn't find any new activities. Try describing what you do in more detail.");
        return;
      }

      // Remap IDs to avoid conflicts with existing activities
      const existingIds = new Set(profile.activities.map((a) => a.id));
      let nextIdx = profile.activities.length + 1;
      const idMap = new Map<string, string>();

      const remappedActivities = response.activities.map((a) => {
        let newId = `act_${nextIdx++}`;
        while (existingIds.has(newId)) newId = `act_${nextIdx++}`;
        idMap.set(a.id, newId);
        return { ...a, id: newId };
      });

      const remappedQuestions = response.followUpQuestions.map((q, i) => ({
        ...q,
        id: `q_forgot_${i + 1}`,
        activityId: idMap.get(q.activityId) || q.activityId,
        answer: undefined,
        skipped: false,
      }));

      setNewActivities(remappedActivities);

      if (remappedQuestions.length > 0) {
        setForgotQuestions(remappedQuestions);
        setForgotStep("followup");
        setForgotText("");
      } else {
        // No follow-up questions needed — add directly
        onAddActivities(remappedActivities);
        resetForgotState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleForgotSkip = (questionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: "__SKIPPED__" }));
  };

  const handleForgotNext = () => {
    if (currentActivityIdx < totalForgotActivities - 1) {
      setCurrentActivityIdx((prev) => prev + 1);
    }
  };

  const handleForgotFinish = async () => {
    const answeredQuestions = forgotQuestions
      .filter((q) => answers[q.id] && answers[q.id] !== "__SKIPPED__")
      .map((q) => ({
        questionId: q.id,
        activityId: q.activityId,
        question: q.question,
        answer: answers[q.id],
      }));

    if (answeredQuestions.length === 0) {
      // All skipped — add activities as-is
      onAddActivities(newActivities);
      resetForgotState();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await callApi({
        type: "followup",
        activities: newActivities,
        answers: answeredQuestions,
      });
      onAddActivities(response.updatedActivities);
      resetForgotState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Profile</h1>
          <p className="text-sm text-gray-400">
            Click text to edit, or expand activities for more depth
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={onStartOver}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            Start Over
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {Array.from(grouped.entries()).map(([category, activities]) => (
        <CategorySection
          key={category}
          category={category}
          activities={activities}
          onEditActivity={onEditActivity}
        />
      ))}

      {profile.activities.length === 0 && (
        <div className="py-12 text-center text-gray-400">
          No activities yet. Something went wrong — try starting over.
        </div>
      )}

      {isLoading && (
        <LoadingSpinner
          message={forgotStep === "followup" ? "Enriching new activities..." : "Parsing new activities..."}
        />
      )}

      <div className="mt-12 border-t border-gray-100 pt-4">
        {forgotStep === "idle" && (
          <button
            onClick={() => setForgotStep("input")}
            className="text-xs text-gray-400 hover:text-gray-500"
          >
            + I forgot something
          </button>
        )}

        {forgotStep === "input" && (
          <div className="space-y-2">
            <textarea
              value={forgotText}
              onChange={(e) => setForgotText(e.target.value)}
              placeholder="I also do..."
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleForgotSubmit}
                disabled={forgotText.trim().length < 10 || isLoading}
                className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-300 disabled:opacity-40"
              >
                Add to Profile
              </button>
              <button
                onClick={resetForgotState}
                className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {forgotStep === "followup" && !isLoading && currentForgotActivity && (
          <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-blue-600">
                {currentForgotActivity.activityName}
              </p>
              <span className="text-xs text-gray-400">
                Activity {currentActivityIdx + 1} of {totalForgotActivities}
              </span>
            </div>

            {currentForgotActivity.questions.map((q) => (
              <div
                key={q.id}
                className="rounded-lg border border-gray-100 bg-white p-3"
              >
                <p className="mb-2 text-sm text-gray-700">{q.question}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={answers[q.id] === "__SKIPPED__" ? "" : answers[q.id] || ""}
                    onChange={(e) => handleForgotAnswerChange(q.id, e.target.value)}
                    placeholder="Your answer..."
                    disabled={answers[q.id] === "__SKIPPED__"}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  <button
                    onClick={() => handleForgotSkip(q.id)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      answers[q.id] === "__SKIPPED__"
                        ? "bg-gray-200 text-gray-500"
                        : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    }`}
                  >
                    {answers[q.id] === "__SKIPPED__" ? "Skipped" : "Skip"}
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={isLastForgotActivity ? handleForgotFinish : handleForgotNext}
              disabled={!currentActivityDone}
              className="w-full rounded-lg bg-blue-500 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLastForgotActivity ? "Add to Profile" : "Next Activity →"}
            </button>

            <button
              onClick={resetForgotState}
              className="w-full py-1 text-xs text-gray-400 hover:text-gray-500"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
