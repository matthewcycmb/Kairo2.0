import { useState, useEffect } from "react";
import type { StudentProfile, AppHelperSessionData } from "../types/profile";
import { callApi } from "../lib/apiClient";

type AppHelperSession = AppHelperSessionData;

interface AppHelperProps {
  profile: StudentProfile;
  profileId: string | null;
  loadedSession?: AppHelperSession | null;
  onSessionLoaded?: () => void;
  onSessionsChanged?: (sessions: AppHelperSession[]) => void;
}

function getStorageKey(profileId: string) {
  return `kairo-apphelper-sessions-${profileId}`;
}

function loadSessionsFromStorage(profileId: string | null): AppHelperSession[] {
  if (!profileId) return [];
  try {
    const saved = localStorage.getItem(getStorageKey(profileId));
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore
  }
  return [];
}

function mergeSessions(local: AppHelperSession[], blob: AppHelperSession[]): AppHelperSession[] {
  const byId = new Map<string, AppHelperSession>();
  for (const s of blob) byId.set(s.id, s);
  for (const s of local) byId.set(s.id, s); // local wins on conflict
  return Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function saveSessionsToStorage(profileId: string | null, sessions: AppHelperSession[]) {
  if (!profileId) return;
  localStorage.setItem(getStorageKey(profileId), JSON.stringify(sessions));
}

export { type AppHelperSession };

export default function AppHelper({ profile, profileId, loadedSession, onSessionLoaded, onSessionsChanged }: AppHelperProps) {
  const [question, setQuestion] = useState("");
  const [step, setStep] = useState<"question" | "clarify" | "answer">("question");
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, string>>({});
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [sessions, setSessions] = useState<AppHelperSession[]>(() => {
    const local = loadSessionsFromStorage(profileId);
    const blob = profile.appHelperSessions || [];
    return mergeSessions(local, blob);
  });

  // Re-load sessions when profileId changes — merge localStorage + profile blob
  useEffect(() => {
    const local = loadSessionsFromStorage(profileId);
    const blob = profile.appHelperSessions || [];
    const merged = mergeSessions(local, blob);
    setSessions(merged);
    // Backfill localStorage if blob had sessions localStorage didn't
    if (merged.length > local.length) {
      saveSessionsToStorage(profileId, merged);
    }
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load session from parent
  useEffect(() => {
    if (loadedSession) {
      loadSession(loadedSession);
      onSessionLoaded?.();
    }
  }, [loadedSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGetQuestions = async () => {
    if (question.trim().length < 5 || isLoading) return;
    setIsLoading(true);
    setLoadingMessage("Thinking about what to ask you...");
    setError(null);
    setAnswer("");
    setClarifyQuestions([]);
    setClarifyAnswers({});

    try {
      const response = await callApi({
        type: "app-helper",
        profile,
        question: question.trim(),
      });
      if (response.questions && response.questions.length > 0) {
        setClarifyQuestions(response.questions);
        setStep("clarify");
      } else {
        setError("Couldn't generate clarifying questions. Try rephrasing.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const allClarifyAnswered = clarifyQuestions.length > 0 &&
    clarifyQuestions.every((_, i) => clarifyAnswers[i]?.trim());

  const handleGenerate = async () => {
    if (!allClarifyAnswered || isLoading) return;
    setIsLoading(true);
    setLoadingMessage("Writing your answer...");
    setError(null);

    try {
      const answers = clarifyQuestions.map((q, i) => ({
        question: q,
        answer: clarifyAnswers[i].trim(),
      }));
      const response = await callApi({
        type: "app-helper",
        profile,
        question: question.trim(),
        clarifyAnswers: answers,
      });
      if (response.answer) {
        setAnswer(response.answer);
        setStep("answer");

        // Auto-save session
        const session: AppHelperSession = {
          id: `session-${Date.now()}`,
          question: question.trim(),
          clarifyQuestions,
          clarifyAnswers,
          answer: response.answer,
          timestamp: new Date().toISOString(),
        };
        const updated = [session, ...sessions];
        setSessions(updated);
        saveSessionsToStorage(profileId, updated);
        onSessionsChanged?.(updated);
      } else {
        setError("Couldn't generate an answer. Try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOver = () => {
    setStep("question");
    setQuestion("");
    setClarifyQuestions([]);
    setClarifyAnswers({});
    setAnswer("");
    setError(null);
  };

  const loadSession = (session: AppHelperSession) => {
    setQuestion(session.question);
    setClarifyQuestions(session.clarifyQuestions);
    setClarifyAnswers(session.clarifyAnswers);
    setAnswer(session.answer);
    setStep("answer");
    setError(null);
  };


  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Intro header */}
      <div className="rounded-2xl border border-white/[0.10] bg-white/[0.05] p-5 sm:p-6">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Paste your application question here..."
          rows={3}
          disabled={step !== "question"}
          className="w-full resize-none rounded-xl border border-white/[0.12] bg-white/[0.06] p-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60 sm:p-4 sm:text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && step === "question") {
              e.preventDefault();
              handleGetQuestions();
            }
          }}
        />
        {step === "question" && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-white/40">
              {question.trim().length > 0 && question.trim().length < 5
                ? `${5 - question.trim().length} more characters needed`
                : "\u00A0"}
            </span>
            <button
              onClick={handleGetQuestions}
              disabled={question.trim().length < 5 || isLoading}
              className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
        {step !== "question" && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleStartOver}
              className="text-sm text-white/40 transition-colors hover:text-white/60"
            >
              Start over
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-3 text-white/50">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">{loadingMessage}</span>
          </div>
        </div>
      )}

      {/* Step 2: Clarifying questions */}
      {step === "clarify" && !isLoading && (
        <div className="rounded-2xl border border-white/[0.15] bg-white/[0.06] p-4 backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] sm:p-6">
          <p className="mb-4 text-sm font-medium text-white/70">
            A few quick questions so your answer sounds like you
          </p>
          <div className="space-y-4">
            {clarifyQuestions.map((q, i) => (
              <div key={i}>
                <label className="mb-1.5 block text-sm text-white/60">{q}</label>
                <textarea
                  value={clarifyAnswers[i] || ""}
                  onChange={(e) => {
                    setClarifyAnswers((prev) => ({ ...prev, [i]: e.target.value }));
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }}
                  placeholder="Your answer..."
                  rows={1}
                  className="w-full resize-none overflow-hidden rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && allClarifyAnswered) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!allClarifyAnswered || isLoading}
              className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generate
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Answer display */}
      {step === "answer" && answer && !isLoading && (
        <div className="rounded-2xl border border-white/[0.15] bg-white/[0.06] p-4 backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-white/70">Your Answer</span>
            <div className="flex gap-2">
              <button
                onClick={() => setEditingAnswer((v) => !v)}
                className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
              >
                {editingAnswer ? "Done" : "Edit"}
              </button>
              <button
                onClick={handleCopy}
                className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          {editingAnswer ? (
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="w-full resize-none rounded-xl border border-white/[0.20] bg-white/[0.06] p-4 text-base leading-relaxed text-white/85 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
              rows={Math.max(6, answer.split("\n").length + 2)}
            />
          ) : (
            <div className="whitespace-pre-wrap rounded-xl border border-white/[0.10] bg-white/[0.04] p-4 text-base leading-relaxed text-white/85">
              {answer}
            </div>
          )}
          <p className="mt-3 text-xs text-white/30">
            Always review and edit before submitting — make sure everything is accurate and sounds like you.
          </p>
        </div>
      )}

      {/* Empty state */}
      {step === "question" && !isLoading && !error && (
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="text-center">
            <p className="text-base text-white/40">Paste an application question above</p>
            <p className="mt-1 text-sm text-white/25">
              Kairo will ask a few questions, then write a personalized answer
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
