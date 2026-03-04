import { useState, useEffect, useRef, useMemo } from "react";
import type { ParsedActivity } from "../types/activity";
import type { FollowUpRound, StudentProfile, FollowUpQuestion } from "../types/profile";
import { callApi } from "../lib/apiClient";
import ChatBubble from "../components/ChatBubble";
import LoadingSpinner from "../components/LoadingSpinner";

interface ChatPageProps {
  rawText: string;
  profile: StudentProfile;
  followUpRounds: FollowUpRound[];
  currentRound: number;
  isLoading: boolean;
  error: string | null;
  onActivitiesParsed: (activities: ParsedActivity[], rounds: FollowUpRound[]) => void;
  onFollowUpComplete: (updatedActivities: ParsedActivity[], newRounds: FollowUpRound[]) => void;
  onGenerateProfile: () => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

interface ChatMessage {
  id: string;
  type: "ai" | "user";
  content: string;
}

export default function ChatPage({
  rawText,
  profile,
  followUpRounds,
  currentRound,
  isLoading,
  error,
  onActivitiesParsed,
  onFollowUpComplete,
  onGenerateProfile,
  setIsLoading,
  setError,
}: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentActivityIdx, setCurrentActivityIdx] = useState(0);
  const [showGenerateButton, setShowGenerateButton] = useState(false);
  const hasParsedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentQuestions =
    followUpRounds.length > 0
      ? followUpRounds[followUpRounds.length - 1].questions
      : [];

  // Group questions by activity
  const activitiesWithQuestions = useMemo(() => {
    const grouped: { activityName: string; activityId: string; questions: FollowUpQuestion[] }[] = [];
    const seen = new Map<string, number>();

    for (const q of currentQuestions) {
      const idx = seen.get(q.activityId);
      if (idx !== undefined) {
        // Max 2 questions per activity
        if (grouped[idx].questions.length < 2) {
          grouped[idx].questions.push(q);
        }
      } else {
        seen.set(q.activityId, grouped.length);
        grouped.push({ activityName: q.activityName, activityId: q.activityId, questions: [q] });
      }
    }
    return grouped;
  }, [currentQuestions]);

  const currentActivity = activitiesWithQuestions[currentActivityIdx];
  const totalActivities = activitiesWithQuestions.length;

  // Check if current activity's questions are all answered/skipped
  const currentActivityDone =
    currentActivity?.questions.every(
      (q) => answers[q.id] !== undefined && answers[q.id] !== ""
    ) ?? false;

  // Initial parse on mount (ref prevents StrictMode double-fire)
  useEffect(() => {
    if (hasParsedRef.current) return;
    hasParsedRef.current = true;

    setMessages([{ id: "user-dump", type: "user", content: rawText }]);

    async function parseInitial() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await callApi({ type: "parse", text: rawText });
        const activities = response.activities;
        const questions = response.followUpQuestions;

        const round: FollowUpRound = {
          roundNumber: 1,
          questions: questions.map((q) => ({ ...q, answer: undefined, skipped: false })),
          completed: false,
        };

        onActivitiesParsed(activities, questions.length > 0 ? [round] : []);

        const activityNames = activities.map((a) => a.name).join(", ");
        setMessages((prev) => [
          ...prev,
          {
            id: "ai-parse",
            type: "ai",
            content: `Nice! I found these activities: ${activityNames}. ${
              questions.length > 0
                ? "Let me ask a few questions to fill in the gaps."
                : "Looks like you gave me a lot of detail already!"
            }`,
          },
        ]);

        if (questions.length === 0) {
          setShowGenerateButton(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsLoading(false);
      }
    }

    parseInitial();
  }, [rawText, setIsLoading, setError, onActivitiesParsed]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, currentActivityIdx]);

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSkip = (questionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: "__SKIPPED__" }));
  };

  const handleNextActivity = () => {
    if (currentActivityIdx < totalActivities - 1) {
      // Record answers in messages
      if (currentActivity) {
        const text = currentActivity.questions
          .map((q) => {
            const ans = answers[q.id];
            return `${q.question}\n→ ${ans === "__SKIPPED__" ? "Skipped" : ans}`;
          })
          .join("\n\n");
        setMessages((prev) => [
          ...prev,
          { id: `user-${currentActivity.activityId}-${currentRound}`, type: "user", content: text },
        ]);
      }
      setCurrentActivityIdx((prev) => prev + 1);
    }
  };

  const handleFinishQuestions = async () => {
    // Record last activity's answers in messages
    if (currentActivity) {
      const text = currentActivity.questions
        .map((q) => {
          const ans = answers[q.id];
          return `${q.question}\n→ ${ans === "__SKIPPED__" ? "Skipped" : ans}`;
        })
        .join("\n\n");
      setMessages((prev) => [
        ...prev,
        { id: `user-${currentActivity.activityId}-${currentRound}`, type: "user", content: text },
      ]);
    }

    // Collect all non-skipped answers
    const answeredQuestions = currentQuestions
      .filter((q) => answers[q.id] && answers[q.id] !== "__SKIPPED__")
      .map((q) => ({
        questionId: q.id,
        activityId: q.activityId,
        question: q.question,
        answer: answers[q.id],
      }));

    if (answeredQuestions.length === 0) {
      // All skipped — go straight to profile
      setMessages((prev) => [
        ...prev,
        { id: `ai-done-${currentRound}`, type: "ai", content: "No worries! Let's build your profile with what we have." },
      ]);
      onFollowUpComplete(profile.activities, []);
      setShowGenerateButton(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await callApi({
        type: "followup",
        activities: profile.activities,
        answers: answeredQuestions,
      });

      // One round only — always go to profile after
      onFollowUpComplete(response.updatedActivities, []);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-followup-${currentRound}`,
          type: "ai",
          content: "Awesome, I've got a great picture of your activities now!",
        },
      ]);

      setShowGenerateButton(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const isLastActivity = currentActivityIdx === totalActivities - 1;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-6">
      <div className="mb-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">Kairo</h1>
        <p className="text-sm text-gray-400">Let's fill in the details</p>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pb-4">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} type={msg.type}>
            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
          </ChatBubble>
        ))}

        {/* Current activity questions (one activity at a time) */}
        {!isLoading && !showGenerateButton && currentActivity && (
          <div className="mb-4 ml-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-blue-600">
                {currentActivity.activityName}
              </p>
              <span className="text-xs text-gray-400">
                Activity {currentActivityIdx + 1} of {totalActivities}
              </span>
            </div>

            {currentActivity.questions.map((q) => (
              <div
                key={q.id}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <p className="mb-2 text-sm text-gray-700">{q.question}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={answers[q.id] === "__SKIPPED__" ? "" : answers[q.id] || ""}
                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                    placeholder="Your answer..."
                    disabled={answers[q.id] === "__SKIPPED__"}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  <button
                    onClick={() => handleSkip(q.id)}
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
          </div>
        )}

        {isLoading && <LoadingSpinner message="Kairo is thinking..." />}

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 pt-4">
        {showGenerateButton ? (
          <button
            onClick={onGenerateProfile}
            className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white shadow-sm transition-all hover:bg-blue-600"
          >
            Generate My Profile
          </button>
        ) : (
          !isLoading &&
          currentActivity && (
            <button
              onClick={isLastActivity ? handleFinishQuestions : handleNextActivity}
              disabled={!currentActivityDone}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLastActivity ? "Submit Answers" : "Next Activity →"}
            </button>
          )
        )}
      </div>
    </div>
  );
}
