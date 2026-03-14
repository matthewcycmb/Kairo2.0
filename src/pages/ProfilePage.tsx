import { useState, useMemo, useCallback } from "react";
import type { ParsedActivity } from "../types/activity";
import type { StudentProfile, FollowUpQuestion, AdvisorMessage, ConversationSummary } from "../types/profile";
import { groupByCategory } from "../lib/profileUtils";
import { callApi } from "../lib/apiClient";
import { saveIdentifier } from "../lib/profileApi";
import CategorySection from "../components/CategorySection";
import LoadingSpinner from "../components/LoadingSpinner";
import AdvisorChat from "../components/AdvisorChat";
import AppHelper, { type AppHelperSession } from "../components/AppHelper";
import Strategy from "../components/Strategy";
import RecentUpdates from "../components/RecentUpdates";
import ResumeModal from "../components/ResumeModal";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

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
  onNewConversation: () => void;
  profileId: string | null;
  onLoadConversation: (convId: string) => void;
  onBackToCurrent: () => void;
  onDeleteConversation: (convId: string) => void;
  conversations: ConversationSummary[];
  onListConversations: () => void;
  isViewingPrevious: boolean;
  onDiscussStrategy?: (strategyContext: string) => Promise<void>;
  onAppHelperSessionsChanged?: (sessions: AppHelperSession[]) => void;
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
  onNewConversation,
  profileId,
  onLoadConversation,
  onBackToCurrent,
  onDeleteConversation,
  conversations,
  onListConversations,
  isViewingPrevious,
  onDiscussStrategy,
  onAppHelperSessionsChanged,
}: ProfilePageProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "advisor" | "apphelper" | "strategy">("profile");
  const [forgotStep, setForgotStep] = useState<"idle" | "input" | "followup">("idle");
  const [forgotText, setForgotText] = useState("");
  const [newActivities, setNewActivities] = useState<ParsedActivity[]>([]);
  const [forgotQuestions, setForgotQuestions] = useState<FollowUpQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentActivityIdx, setCurrentActivityIdx] = useState(0);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [identifierInput, setIdentifierInput] = useState("");
  const [identifierSaved, setIdentifierSaved] = useState(false);
  const [identifierSaving, setIdentifierSaving] = useState(false);
  const [showResume, setShowResume] = useState(false);

  // Welcome card — show once after onboarding
  const welcomeKey = profileId ? `kairo-welcomed-${profileId}` : null;
  const [showWelcome, setShowWelcome] = useState(() => {
    if (!welcomeKey || !profile.goals) return false;
    try { return !localStorage.getItem(welcomeKey); } catch { return false; }
  });

  const [autoSubmitStrategy, setAutoSubmitStrategy] = useState(false);

  const dismissWelcome = (tab?: "advisor" | "apphelper" | "strategy") => {
    setShowWelcome(false);
    if (welcomeKey) try { localStorage.setItem(welcomeKey, "1"); } catch {}
    if (tab) {
      if (tab === "strategy") setAutoSubmitStrategy(true);
      setActiveTab(tab);
      if (tab === "advisor") onAdvisorTabOpened();
    }
  };

  // Monthly check-in — show when profile is 30+ days stale
  const checkinKey = profileId ? `kairo-checkin-${profileId}` : null;
  const daysSinceUpdate = Math.floor((Date.now() - new Date(profile.lastUpdated).getTime()) / 86_400_000);
  const [showCheckin, setShowCheckin] = useState(() => {
    if (!checkinKey || daysSinceUpdate < 30) return false;
    try {
      const dismissed = localStorage.getItem(checkinKey);
      if (!dismissed) return true;
      // Show again if dismissed more than 30 days ago
      return Date.now() - Number(dismissed) > 30 * 86_400_000;
    } catch { return false; }
  });

  const dismissCheckin = () => {
    setShowCheckin(false);
    if (checkinKey) try { localStorage.setItem(checkinKey, String(Date.now())); } catch {}
  };
  const [showMenu, setShowMenu] = useState(false);
  const [showPrevChats, setShowPrevChats] = useState(false);
  const [showPrevSessions, setShowPrevSessions] = useState(false);
  const [appHelperSessions, setAppHelperSessions] = useState<AppHelperSession[]>([]);
  const [loadedSession, setLoadedSession] = useState<AppHelperSession | null>(null);

  const appHelperStorageKey = profileId ? `kairo-apphelper-sessions-${profileId}` : null;

  const refreshAppHelperSessions = useCallback(() => {
    if (!appHelperStorageKey) { setAppHelperSessions([]); return; }
    try {
      const saved = localStorage.getItem(appHelperStorageKey);
      setAppHelperSessions(saved ? JSON.parse(saved) : []);
    } catch {
      setAppHelperSessions([]);
    }
  }, [appHelperStorageKey]);

  const deleteAppHelperSession = useCallback((sessionId: string) => {
    if (!appHelperStorageKey) return;
    const updated = appHelperSessions.filter((s) => s.id !== sessionId);
    try { localStorage.setItem(appHelperStorageKey, JSON.stringify(updated)); } catch {}
    setAppHelperSessions(updated);
    onAppHelperSessionsChanged?.(updated);
    if (loadedSession?.id === sessionId) setLoadedSession(null);
  }, [appHelperStorageKey, appHelperSessions, loadedSession, onAppHelperSessionsChanged]);

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

  const handleSaveIdentifier = async () => {
    if (!profileId || !identifierInput.trim()) return;
    setIdentifierSaving(true);
    try {
      await saveIdentifier(profileId, identifierInput.trim());
      setIdentifierSaved(true);
      setShowSavePopover(false);
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

  const handleTabClick = (tab: "profile" | "advisor" | "apphelper" | "strategy") => {
    if (showWelcome && tab !== "profile") dismissWelcome();
    setActiveTab(tab);
    if (tab === "advisor") onAdvisorTabOpened();
  };

  const handleDiscussWithAdvisor = async (strategyContext: string) => {
    setActiveTab("advisor");
    if (onDiscussStrategy) {
      await onDiscussStrategy(strategyContext);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="relative mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold text-white sm:text-2xl">
              {activeTab === "profile" && "Profile"}
              {activeTab === "advisor" && "Advisor"}
              {activeTab === "apphelper" && "Writer"}
              {activeTab === "strategy" && "Strategy"}
            </h1>
            <span className="text-[10px] font-medium tracking-widest text-white/15 uppercase">Kairo</span>
          </div>
          {/* Desktop: buttons inline with title. Mobile: hidden here, shown below */}
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {activeTab === "profile" && (
              <button
                onClick={() => setForgotStep(forgotStep === "idle" ? "input" : "idle")}
                className="rounded-lg border border-white/[0.10] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white/80"
              >
                + New
              </button>
            )}
            {activeTab === "advisor" && (
              <button
                onClick={onNewConversation}
                disabled={refreshingAnalysis}
                className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white disabled:opacity-40"
              >
                {refreshingAnalysis ? "Loading new chat..." : "New conversation"}
              </button>
            )}
            {activeTab === "advisor" ? (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowPrevChats((v) => !v);
                    if (!showPrevChats) onListConversations();
                  }}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
                >
                  Previous chats
                </button>
                {showPrevChats && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPrevChats(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-white/[0.15] bg-white/[0.08] py-1 shadow-xl backdrop-blur-[40px]">
                      {isViewingPrevious && (
                        <button
                          onClick={() => {
                            onBackToCurrent();
                            setShowPrevChats(false);
                          }}
                          className="w-full border-b border-white/[0.10] px-4 py-2.5 text-left text-sm font-medium text-blue-400 transition-colors hover:bg-white/[0.08]"
                        >
                          Back to current chat
                        </button>
                      )}
                      {conversations.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-white/40">No previous conversations</p>
                      ) : (
                        conversations.map((conv) => (
                          <div
                            key={conv.id}
                            className="group flex items-center transition-colors hover:bg-white/[0.08]"
                          >
                            <button
                              onClick={() => {
                                onLoadConversation(conv.id);
                                setShowPrevChats(false);
                              }}
                              className="min-w-0 flex-1 px-4 py-2.5 text-left"
                            >
                              <p className="truncate text-sm text-white/80">{conv.preview}</p>
                              <p className="text-xs text-white/50">{formatRelativeTime(conv.timestamp)}</p>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteConversation(conv.id);
                              }}
                              className="shrink-0 px-3 py-2 text-white/20 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                              title="Delete conversation"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : activeTab === "apphelper" ? (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowPrevSessions((v) => !v);
                    if (!showPrevSessions) refreshAppHelperSessions();
                  }}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
                >
                  Previous sessions
                </button>
                {showPrevSessions && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPrevSessions(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-white/[0.15] bg-white/[0.08] py-1 shadow-xl backdrop-blur-[40px]">
                      {loadedSession && (
                        <button
                          onClick={() => {
                            setLoadedSession(null);
                            setShowPrevSessions(false);
                          }}
                          className="w-full border-b border-white/[0.10] px-4 py-2.5 text-left text-sm font-medium text-blue-400 transition-colors hover:bg-white/[0.08]"
                        >
                          Start new question
                        </button>
                      )}
                      {appHelperSessions.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-white/40">No previous sessions</p>
                      ) : (
                        appHelperSessions.map((session) => (
                          <div
                            key={session.id}
                            className="group flex items-center transition-colors hover:bg-white/[0.08]"
                          >
                            <button
                              onClick={() => {
                                setLoadedSession(session);
                                setShowPrevSessions(false);
                              }}
                              className="min-w-0 flex-1 px-4 py-2.5 text-left"
                            >
                              <p className="truncate text-sm text-white/80">{session.question}</p>
                              <p className="text-xs text-white/50">{formatRelativeTime(session.timestamp)}</p>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteAppHelperSession(session.id);
                              }}
                              className="shrink-0 px-3 py-2 text-white/20 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                              title="Delete session"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowResume(true)}
                className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
              >
                Generate resume
              </button>
            )}
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

          {/* Mobile-only: inline actions right of title */}
          <div className="flex items-center gap-3 sm:hidden">
            {activeTab === "profile" && (
              <>
                <button onClick={() => setForgotStep(forgotStep === "idle" ? "input" : "idle")} className="text-xs font-medium text-white/50 hover:text-white/70">+ New</button>
                <button onClick={() => setShowResume(true)} className="text-xs text-white/30 hover:text-white/50">Resume</button>
              </>
            )}
            {activeTab === "advisor" && (
              <>
                <button onClick={onNewConversation} disabled={refreshingAnalysis} className="text-xs text-white/30 hover:text-white/50 disabled:opacity-40">New</button>
                <div className="relative">
                  <button onClick={() => { setShowPrevChats((v) => !v); if (!showPrevChats) onListConversations(); }} className="text-xs text-white/30 hover:text-white/50">History</button>
                  {showPrevChats && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowPrevChats(false)} />
                      <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] py-1 shadow-xl backdrop-blur-[40px]">
                        {isViewingPrevious && (
                          <button onClick={() => { onBackToCurrent(); setShowPrevChats(false); }} className="w-full border-b border-white/[0.08] px-4 py-2.5 text-left text-sm font-medium text-blue-400">Back to current</button>
                        )}
                        {conversations.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-white/30">No previous chats</p>
                        ) : conversations.map((conv) => (
                          <div key={conv.id} className="group flex items-center hover:bg-white/[0.06]">
                            <button onClick={() => { onLoadConversation(conv.id); setShowPrevChats(false); }} className="min-w-0 flex-1 px-4 py-2.5 text-left">
                              <p className="truncate text-sm text-white/70">{conv.preview}</p>
                              <p className="text-xs text-white/30">{formatRelativeTime(conv.timestamp)}</p>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }} className="shrink-0 px-3 py-2 text-white/15 hover:text-red-400 opacity-0 group-hover:opacity-100">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" /></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            {activeTab === "apphelper" && (
              <div className="relative">
                <button onClick={() => { setShowPrevSessions((v) => !v); if (!showPrevSessions) refreshAppHelperSessions(); }} className="text-xs text-white/30 hover:text-white/50">History</button>
                {showPrevSessions && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPrevSessions(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] py-1 shadow-xl backdrop-blur-[40px]">
                      {loadedSession && (
                        <button onClick={() => { setLoadedSession(null); setShowPrevSessions(false); }} className="w-full border-b border-white/[0.08] px-4 py-2.5 text-left text-sm font-medium text-blue-400">New question</button>
                      )}
                      {appHelperSessions.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-white/30">No previous sessions</p>
                      ) : appHelperSessions.map((session) => (
                        <div key={session.id} className="group flex items-center hover:bg-white/[0.06]">
                          <button onClick={() => { setLoadedSession(session); setShowPrevSessions(false); }} className="min-w-0 flex-1 px-4 py-2.5 text-left">
                            <p className="truncate text-sm text-white/70">{session.question}</p>
                            <p className="text-xs text-white/30">{formatRelativeTime(session.timestamp)}</p>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); deleteAppHelperSession(session.id); }} className="shrink-0 px-3 py-2 text-white/15 hover:text-red-400 opacity-0 group-hover:opacity-100">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="relative">
              <button onClick={() => setShowMenu((v) => !v)} className="flex h-7 w-7 items-center justify-center text-white/35 hover:text-white/50">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4.5 w-4.5"><path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" /></svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] py-1 shadow-xl backdrop-blur-[40px]">
                    {activeTab === "profile" && profileId && (
                      <button onClick={() => { setShowSavePopover(true); setShowMenu(false); }} className="w-full px-4 py-2.5 text-left text-sm text-white/50 hover:text-white/70">Save my profile</button>
                    )}
                    {activeTab === "profile" && (
                      <button onClick={() => { setShowResume(true); setShowMenu(false); }} className="w-full px-4 py-2.5 text-left text-sm text-white/50 hover:text-white/70">Generate resume</button>
                    )}
                    <button onClick={() => { onStartOver(); setShowMenu(false); }} className="w-full px-4 py-2.5 text-left text-sm text-white/50 hover:text-white/70">Start Over</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-0.5 rounded-2xl border border-white/[0.10] bg-white/[0.05] p-1.5 sm:gap-1">
        {(profile.goals?.grade === 12
          ? (["profile", "apphelper", "advisor", "strategy"] as const)
          : (["profile", "advisor", "apphelper", "strategy"] as const)
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            className={`flex-1 whitespace-nowrap rounded-xl px-2 py-2.5 text-xs font-medium transition-all sm:px-4 sm:text-[13px] ${
              activeTab === tab
                ? "bg-white/[0.15] text-white shadow-sm"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            {tab === "profile" && "Profile"}
            {tab === "advisor" && "Advisor"}
            {tab === "apphelper" && (
              <>
                <span className="sm:hidden">Writer</span>
                <span className="hidden sm:inline">App Writer</span>
              </>
            )}
            {tab === "strategy" && "Strategy"}
          </button>
        ))}
      </div>

      {/* Welcome card — shown once after onboarding */}
      {showWelcome && activeTab === "profile" && profile.goals && (
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4">
          <span className="text-sm text-white/50">Everything look right?</span>
          <button
            onClick={() => dismissWelcome("strategy")}
            className="shrink-0 text-sm font-medium text-white/80 transition-colors hover:text-white"
          >
            Get admissions review →
          </button>
        </div>
      )}

      {/* Monthly check-in */}
      {showCheckin && activeTab === "profile" && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
          <p className="text-sm text-white/40">Last updated {daysSinceUpdate} days ago</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { dismissCheckin(); setForgotStep("input"); }}
              className="text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
            >
              Update
            </button>
            <button onClick={dismissCheckin} className="text-white/20 hover:text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Profile tab content */}
      {activeTab === "profile" && (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-300">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 font-medium underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Recent Updates — quick-add with AI insights */}
          <RecentUpdates profile={profile} profileId={profileId} />

          {/* Add activity — full brain dump (from + New button) */}
          {forgotStep === "input" && (
            <div className="mb-6 rounded-2xl border border-white/[0.10] bg-white/[0.05] px-5 py-4">
              <textarea
                value={forgotText}
                onChange={(e) => setForgotText(e.target.value)}
                placeholder="Describe new activities in detail to add to your profile..."
                rows={2}
                autoFocus
                className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-white/25 focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={resetForgotState}
                  className="text-xs text-white/25 hover:text-white/40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleForgotSubmit}
                  disabled={forgotText.trim().length < 10 || isLoading}
                  className="text-sm font-medium text-white/60 transition-colors hover:text-white disabled:opacity-30"
                >
                  Add to profile →
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <LoadingSpinner
              message={forgotStep === "followup" ? "Enriching new activities..." : "Parsing new activities..."}
            />
          )}

          {forgotStep === "followup" && !isLoading && currentForgotActivity && (
            <div className="mb-6 space-y-3 rounded-2xl border border-white/[0.10] bg-white/[0.05] p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-blue-400">
                  {currentForgotActivity.activityName}
                </p>
                <span className="shrink-0 text-xs text-white/30">
                  {currentActivityIdx + 1}/{totalForgotActivities}
                </span>
              </div>

              {currentForgotActivity.questions.map((q) => (
                <div key={q.id}>
                  <p className="mb-2 text-[15px] leading-snug text-white/60">{q.question}</p>
                  <div className="flex gap-2">
                    <textarea
                      value={answers[q.id] === "__SKIPPED__" ? "" : answers[q.id] || ""}
                      onChange={(e) => {
                        handleForgotAnswerChange(q.id, e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                      }}
                      placeholder="Your answer..."
                      disabled={answers[q.id] === "__SKIPPED__"}
                      rows={1}
                      className="flex-1 resize-none overflow-hidden border-b border-white/[0.10] bg-transparent px-0 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none disabled:text-white/30"
                    />
                    <button
                      onClick={() => handleForgotSkip(q.id)}
                      className={`shrink-0 px-2 py-2 text-xs ${
                        answers[q.id] === "__SKIPPED__" ? "text-white/30" : "text-white/25 hover:text-white/40"
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
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.06] py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.10] disabled:opacity-30"
              >
                {isLastForgotActivity ? "Add to Profile" : "Next Activity →"}
              </button>

              <button
                onClick={resetForgotState}
                className="w-full py-1 text-xs text-white/20 hover:text-white/40"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Transformation stat */}
          {profile.activities.length > 0 && forgotStep === "idle" && (
            <p className="mb-5 text-xs text-white/20">
              {profile.activities.length} {profile.activities.length === 1 ? "activity" : "activities"} · {profile.activities.reduce((sum, a) => sum + (a.skills?.length || 0), 0)} skills · built from your words
            </p>
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

        </>
      )}

      {/* Advisor tab content — kept mounted to preserve scroll & state */}
      <div className={activeTab === "advisor" ? "flex-1" : "hidden"}>
        <AdvisorChat
          advisorMessages={advisorMessages}
          onNewMessage={onAdvisorMessage}
          isLoading={advisorLoading}
          isRefreshing={refreshingAnalysis}
        />
      </div>

      {/* App Helper tab content — kept mounted to preserve state */}
      <div className={activeTab === "apphelper" ? "flex-1" : "hidden"}>
        <AppHelper profile={profile} profileId={profileId} loadedSession={loadedSession} onSessionLoaded={() => setLoadedSession(null)} onSessionsChanged={onAppHelperSessionsChanged} />
      </div>

      {/* Strategy tab content — kept mounted to preserve state */}
      <div className={activeTab === "strategy" ? "flex-1" : "hidden"}>
        <Strategy profile={profile} profileId={profileId} onDiscussWithAdvisor={handleDiscussWithAdvisor} autoSubmit={autoSubmitStrategy} />
      </div>

      {showSavePopover && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowSavePopover(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.15] bg-white/[0.08] p-6 shadow-2xl backdrop-blur-[40px]">
            <h3 className="mb-2 text-base font-semibold text-white">Save my profile</h3>
            <p className="mb-4 text-sm text-white/50">Enter your email so you can find your profile later.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={identifierInput}
                onChange={(e) => setIdentifierInput(e.target.value)}
                placeholder="you@gmail.com"
                className="flex-1 rounded-lg border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/25 focus:outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleSaveIdentifier()}
                autoFocus
              />
              <button
                onClick={handleSaveIdentifier}
                disabled={!identifierInput.trim() || identifierSaving}
                className="shrink-0 rounded-lg border border-white/[0.10] bg-white/[0.10] px-5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white disabled:opacity-40"
              >
                {identifierSaved ? "Saved!" : identifierSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {showResume && (
        <ResumeModal profile={profile} profileId={profileId} onClose={() => setShowResume(false)} />
      )}
    </div>
  );
}
