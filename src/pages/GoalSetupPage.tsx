import { useState } from "react";
import type { StudentGoals } from "../types/profile";

interface GoalSetupPageProps {
  onComplete: (goals: StudentGoals) => void;
}

const GRADES = [9, 10, 11, 12] as const;

export default function GoalSetupPage({ onComplete }: GoalSetupPageProps) {
  const [grade, setGrade] = useState<9 | 10 | 11 | 12 | null>(null);
  const [targetUniversities, setTargetUniversities] = useState("");
  const [location, setLocation] = useState("");

  const canContinue = grade !== null;

  const handleContinue = () => {
    if (!grade) return;
    onComplete({ grade, targetUniversities: targetUniversities.trim(), location: location.trim() });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Almost there
        </h1>
        <p className="text-base text-white/60 sm:text-lg">
          A few quick questions so Kairo can give you better advice.
        </p>
      </div>

      <div className="w-full rounded-2xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px] sm:p-6">
        <div className="space-y-6">
          {/* Grade selector */}
          <div>
            <label className="mb-3 block text-sm font-medium text-white/80">
              What grade are you in?
            </label>
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => setGrade(g)}
                  className={`rounded-xl border py-3 text-sm font-medium transition-all ${
                    grade === g
                      ? "border-blue-500/60 bg-blue-500/20 text-blue-300"
                      : "border-white/[0.12] bg-white/[0.06] text-white/60 hover:bg-white/[0.10] hover:text-white/80"
                  }`}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </div>

          {/* Target universities */}
          <div>
            <label className="mb-2 block text-sm font-medium text-white/80">
              Any universities or programs you're eyeing?
            </label>
            <input
              type="text"
              value={targetUniversities}
              onChange={(e) => setTargetUniversities(e.target.value)}
              placeholder="e.g. UBC Engineering, U of T CS"
              className="w-full rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          {/* Location */}
          <div>
            <label className="mb-2 block text-sm font-medium text-white/80">
              Where are you located?
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Vancouver, BC"
              className="w-full rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-white/30">
            Universities & location are optional
          </span>
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40 sm:px-6 sm:text-base"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
