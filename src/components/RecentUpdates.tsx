import { useState, useEffect, useRef } from "react";
import type { StudentProfile } from "../types/profile";
import { callApi } from "../lib/apiClient";

interface Update {
  id: string;
  text: string;
  insight: string | null;
  timestamp: string;
  loading?: boolean;
}

interface RecentUpdatesProps {
  profile: StudentProfile;
  profileId: string | null;
}

function loadUpdates(profileId: string | null): Update[] {
  if (!profileId) return [];
  try {
    const raw = localStorage.getItem(`kairo-updates-${profileId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveUpdates(profileId: string | null, updates: Update[]) {
  if (!profileId) return;
  try { localStorage.setItem(`kairo-updates-${profileId}`, JSON.stringify(updates)); } catch {}
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function RecentUpdates({ profile, profileId }: RecentUpdatesProps) {
  const [updates, setUpdates] = useState<Update[]>(() => loadUpdates(profileId));
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when profileId changes
  useEffect(() => {
    setUpdates(loadUpdates(profileId));
  }, [profileId]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || text.length < 3 || submitting) return;

    const newUpdate: Update = {
      id: `upd-${Date.now()}`,
      text,
      insight: null,
      timestamp: new Date().toISOString(),
      loading: true,
    };

    const next = [newUpdate, ...updates];
    setUpdates(next);
    setInput("");
    setSubmitting(true);

    try {
      const response = await callApi({
        type: "quick-insight",
        profile,
        update: text,
      });
      newUpdate.insight = response.insight;
    } catch {
      newUpdate.insight = null;
    }

    newUpdate.loading = false;
    const final = [newUpdate, ...updates];
    setUpdates(final);
    saveUpdates(profileId, final);
    setSubmitting(false);
  };

  return (
    <div className="mb-6">
      {/* Input */}
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.10] bg-white/[0.05] px-4 py-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
          placeholder="What happened this week?"
          maxLength={200}
          disabled={submitting}
          className="min-w-0 flex-1 truncate bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none disabled:opacity-50"
        />
        {input.trim().length >= 3 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="shrink-0 text-xs font-medium text-white/50 hover:text-white/70 disabled:opacity-30"
          >
            Add
          </button>
        )}
      </div>

      {/* Updates log */}
      {updates.length > 0 && (
        <div className="mt-3 space-y-2">
          {updates.slice(0, 5).map((u) => (
            <div key={u.id} className="px-1">
              <div className="flex items-baseline gap-2">
                <p className="text-sm text-white/60">{u.text}</p>
                <span className="shrink-0 text-[10px] text-white/15">{timeAgo(u.timestamp)}</span>
              </div>
              {u.loading && (
                <p className="mt-1 text-xs text-white/20 italic">Thinking...</p>
              )}
              {u.insight && !u.loading && (
                <p className="mt-1 text-xs leading-relaxed text-white/35 italic">{u.insight}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
