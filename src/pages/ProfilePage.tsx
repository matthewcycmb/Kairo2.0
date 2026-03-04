import { useState } from "react";
import type { ParsedActivity } from "../types/activity";
import type { StudentProfile } from "../types/profile";
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
  const [showForgot, setShowForgot] = useState(false);
  const [forgotText, setForgotText] = useState("");
  const [copied, setCopied] = useState(false);

  const grouped = groupByCategory(profile.activities);

  const handleCopy = async () => {
    try {
      await copyProfileToClipboard(profile);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  const handleForgotSubmit = async () => {
    if (forgotText.trim().length < 10) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await callApi({ type: "parse", text: forgotText.trim() });
      onAddActivities(response.activities);
      setForgotText("");
      setShowForgot(false);
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

      {isLoading && <LoadingSpinner message="Adding activities..." />}

      <div className="mt-12 border-t border-gray-100 pt-4">
        {!showForgot ? (
          <button
            onClick={() => setShowForgot(true)}
            className="text-xs text-gray-400 hover:text-gray-500"
          >
            + I forgot something
          </button>
        ) : (
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
                Add
              </button>
              <button
                onClick={() => { setShowForgot(false); setForgotText(""); }}
                className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
