import { useState, useMemo } from "react";
import type { ParsedActivity } from "../types/activity";
import type { StudentProfile, FollowUpQuestion, AdvisorMessage, ActionItem } from "../types/profile";
import { groupByCategory, copyProfileToClipboard } from "../lib/profileUtils";
import { callApi } from "../lib/apiClient";
import { saveIdentifier } from "../lib/profileApi";
import CategorySection from "../components/CategorySection";
import LoadingSpinner from "../components/LoadingSpinner";
import AdvisorChat from "../components/AdvisorChat";
import AppHelper from "../components/AppHelper";
import ResumeModal from "../components/ResumeModal";

interface ProfilePageProps {
  profile: StudentProfile;
  onEditActivity: (id: string, updates: Partial<ParsedActivity>) => void;
  onAddActivities: (activities: ParsedActivity[]) => void;
  onStartOver: () => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  isLoading: boolean;
  error: string | null;
  advisorMessages: AdvisorMessage[];
  onAdvisorMessage: (text: string) => void;
  advisorLoading: boolean;
  refreshingAnalysis: boolean;
  onAdvisorTabOpened: () => void;
  onRefreshAnalysis: () => void;
  actionItems: ActionItem[];
  onToggleActionItem: (id: string) => void;
  profileId: string | null;
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
  advisorMessages,
  onAdvisorMessage,
  advisorLoading,
  refreshingAnalysis,
  onAdvisorTabOpened,
  onRefreshAnalysis,
  actionItems,
  onToggleActionItem,
  profileId,
}: ProfilePageProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "advisor" | "apphelper">("profile");
  const [forgotStep, setForgotStep] = useState<"idle" | "input" | "followup">("idle");
  const [forgotText, setForgotText] = useState("");
  const [newActivities, setNewActivities] = useState<ParsedActivity[]>([]);
  const [forgotQuestions, setForgotQuestions] = useState<FollowUpQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentActivityIdx, setCurrentActivityIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showSaveCard, setShowSaveCard] = useState(true);
  const [identifierInput, setIdentifierInput] = useState("");
  const [identifierSaved, setIdentifierSaved] = useState(false);
  const [identifierSaving, setIdentifierSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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

  const handleCopyLink = async () => {
    if (!profileId) return;
    try {
      await navigator.clipboard.writeText(window.location.origin + "?p=" + profileId);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError("Failed to copy link");
    }
  };

  const handleSaveIdentifier = async () => {
    if (!profileId || !identifierInput.trim()) return;
    setIdentifierSaving(true);
    try {
      await saveIdentifier(profileId, identifierInput.trim());
      setIdentifierSaved(true);
      setTimeout(() => setIdentifierSaved(false), 3000);
    } catch {
      setError("Failed to save identifier");
    } finally {
      setIdentifierSaving(false);
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

  const handleTabClick = (tab: "profile" | "advisor" | "apphelper") => {
    setActiveTab(tab);
    if (tab === "advisor") onAdvisorTabOpened();
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-8">
      {/* Header */}
      <div className="relative mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Profile</h1>
          <p className="text-sm text-white/40">
            {activeTab === "profile"
              ? "Click text to edit, or expand activities for more depth"
              : activeTab === "advisor"
                ? "Get personalized advice based on your profile"
                : "Write tailored application answers from your profile"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResume(true)}
            className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
          >
            Generate resume
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.10] hover:text-white/80"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-white/[0.15] bg-white/[0.08] py-1 shadow-xl backdrop-blur-[40px]">
                  <button
                    onClick={() => { handleCopy(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white/80 transition-colors hover:bg-white/[0.08]"
                  >
                    {copied ? "Copied!" : "Copy Profile"}
                  </button>
                  <button
                    onClick={() => { onStartOver(); setShowMenu(false); }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/80"
                  >
                    Start Over
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-xl border border-white/[0.15] bg-white/[0.08] p-1 backdrop-blur-[40px]">
        <button
          onClick={() => handleTabClick("profile")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "profile"
              ? "bg-white/[0.15] text-white"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => handleTabClick("advisor")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "advisor"
              ? "bg-white/[0.15] text-white"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          Advisor
        </button>
        <button
          onClick={() => handleTabClick("apphelper")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            activeTab === "apphelper"
              ? "bg-white/[0.15] text-white"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          Application Writer
        </button>
      </div>

      {/* Profile tab content */}
      {activeTab === "profile" && (
        <>
          {error && (
            <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-300">
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
            <div className="py-12 text-center text-white/40">
              No activities yet. Something went wrong — try starting over.
            </div>
          )}

          {isLoading && (
            <LoadingSpinner
              message={forgotStep === "followup" ? "Enriching new activities..." : "Parsing new activities..."}
            />
          )}

          <div className="mt-6">
            {forgotStep === "idle" && (
              <button
                onClick={() => setForgotStep("input")}
                className="w-full rounded-xl border border-white/[0.10] bg-white/[0.04] py-3 text-sm font-medium text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/70"
              >
                + Add new activity
              </button>
            )}

            {forgotStep === "input" && (
              <div className="space-y-2">
                <textarea
                  value={forgotText}
                  onChange={(e) => setForgotText(e.target.value)}
                  placeholder="e.g. just won 2nd at a case competition, started volunteering at the hospital..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/[0.15] bg-white/[0.05] p-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleForgotSubmit}
                    disabled={forgotText.trim().length < 10 || isLoading}
                    className="rounded-lg border border-white/[0.12] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/[0.16] disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={resetForgotState}
                    className="px-4 py-2 text-sm text-white/40 hover:text-white/60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {forgotStep === "followup" && !isLoading && currentForgotActivity && (
              <div className="space-y-3 rounded-xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-blue-400">
                    {currentForgotActivity.activityName}
                  </p>
                  <span className="shrink-0 text-xs text-white/40">
                    {currentActivityIdx + 1}/{totalForgotActivities}
                  </span>
                </div>

                {currentForgotActivity.questions.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-lg border border-white/[0.10] bg-white/[0.05] p-3"
                  >
                    <p className="mb-2 text-sm text-white/80">{q.question}</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={answers[q.id] === "__SKIPPED__" ? "" : answers[q.id] || ""}
                        onChange={(e) => handleForgotAnswerChange(q.id, e.target.value)}
                        placeholder="Your answer..."
                        disabled={answers[q.id] === "__SKIPPED__"}
                        className="flex-1 rounded-lg border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none disabled:bg-white/[0.03] disabled:text-white/30"
                      />
                      <button
                        onClick={() => handleForgotSkip(q.id)}
                        className={`shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                          answers[q.id] === "__SKIPPED__"
                            ? "text-white/50"
                            : "text-white/40 hover:text-white/60"
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
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.10] py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isLastForgotActivity ? "Add to Profile" : "Next Activity →"}
                </button>

                <button
                  onClick={resetForgotState}
                  className="w-full py-1 text-xs text-white/40 hover:text-white/60"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {profileId && showSaveCard && (
            <div className="relative mt-12 rounded-xl border border-white/[0.10] bg-white/[0.04] p-4">
              <button
                onClick={() => setShowSaveCard(false)}
                className="absolute right-3 top-3 text-white/30 hover:text-white/60"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
              <h3 className="mb-3 text-sm font-semibold text-white">Save your profile</h3>
              <button
                onClick={handleCopyLink}
                className="mb-3 w-full rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
              >
                {linkCopied ? "Copied!" : "Copy my profile link"}
              </button>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={identifierInput}
                  onChange={(e) => setIdentifierInput(e.target.value)}
                  placeholder="Your Instagram or email"
                  className="flex-1 rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveIdentifier()}
                />
                <button
                  onClick={handleSaveIdentifier}
                  disabled={!identifierInput.trim() || identifierSaving}
                  className="shrink-0 rounded-lg border border-white/[0.10] bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                >
                  {identifierSaved ? "Saved!" : identifierSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Advisor tab content — kept mounted to preserve scroll & state */}
      <div className={activeTab === "advisor" ? "flex-1" : "hidden"}>
        <AdvisorChat
          advisorMessages={advisorMessages}
          onNewMessage={onAdvisorMessage}
          isLoading={advisorLoading}
          isRefreshing={refreshingAnalysis}
          onRefreshAnalysis={onRefreshAnalysis}
          actionItems={actionItems}
          onToggleActionItem={onToggleActionItem}
        />
      </div>

      {/* App Helper tab content — kept mounted to preserve state */}
      <div className={activeTab === "apphelper" ? "flex-1" : "hidden"}>
        <AppHelper profile={profile} />
      </div>

      {showResume && (
        <ResumeModal profile={profile} onClose={() => setShowResume(false)} />
      )}
    </div>
  );
}
