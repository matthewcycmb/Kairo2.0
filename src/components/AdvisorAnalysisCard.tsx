import type { AdvisorAnalysis } from "../types/profile";

interface AdvisorAnalysisCardProps {
  analysis: AdvisorAnalysis;
}

export default function AdvisorAnalysisCard({ analysis }: AdvisorAnalysisCardProps) {
  return (
    <div className="mb-4 space-y-3">
      {/* Strengths */}
      <div className="rounded-xl border border-white/[0.15] bg-[rgba(15,20,30,0.85)] p-4 sm:p-6">
        <div className="mb-3 border-l-[3px] border-white pl-3">
          <span className="text-lg font-bold text-white/90">
            Profile Strengths
          </span>
        </div>
        <ul className="space-y-2">
          {analysis.strengths.map((s, i) => (
            <li key={i} className="text-base leading-relaxed text-white/70">
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Gaps */}
      <div className="rounded-xl border border-white/[0.15] bg-[rgba(15,20,30,0.85)] p-4 sm:p-6">
        <div className="mb-3 border-l-[3px] border-amber-400 pl-3">
          <span className="text-lg font-bold text-white/90">
            Gaps to Address
          </span>
        </div>
        <ul className="space-y-2">
          {analysis.gaps.map((g, i) => (
            <li key={i} className="text-base leading-relaxed text-white/70">
              {g}
            </li>
          ))}
        </ul>
      </div>

      {/* Action Step */}
      <div className="rounded-xl border border-white/[0.15] bg-[rgba(15,20,30,0.85)] p-4 sm:p-6">
        <div className="mb-3 border-l-[3px] border-blue-400 pl-3">
          <span className="text-lg font-bold text-white/90">
            Action Step This Week
          </span>
        </div>
        <p className="text-base leading-relaxed text-white/70">
          {analysis.actionStep}
        </p>
      </div>
    </div>
  );
}
