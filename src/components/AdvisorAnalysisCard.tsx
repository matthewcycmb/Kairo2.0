import type { AdvisorAnalysis } from "../types/profile";

interface AdvisorAnalysisCardProps {
  analysis: AdvisorAnalysis;
}

export default function AdvisorAnalysisCard({ analysis }: AdvisorAnalysisCardProps) {
  return (
    <div className="mb-4 space-y-3">
      {/* Strengths */}
      <div className="rounded-xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 border-l-[3px] border-white pl-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/90">
            Profile Strengths
          </span>
        </div>
        <ul className="space-y-1.5">
          {analysis.strengths.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed text-white/70">
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Gaps */}
      <div className="rounded-xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 border-l-[3px] border-amber-400 pl-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/90">
            Gaps to Address
          </span>
        </div>
        <ul className="space-y-1.5">
          {analysis.gaps.map((g, i) => (
            <li key={i} className="text-sm leading-relaxed text-white/70">
              {g}
            </li>
          ))}
        </ul>
      </div>

      {/* Action Step */}
      <div className="rounded-xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 border-l-[3px] border-blue-400 pl-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/90">
            Action Step This Week
          </span>
        </div>
        <p className="text-sm leading-relaxed text-white/70">
          {analysis.actionStep}
        </p>
      </div>
    </div>
  );
}
