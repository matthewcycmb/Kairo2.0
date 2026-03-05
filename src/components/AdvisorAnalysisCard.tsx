import type { AdvisorAnalysis } from "../types/profile";

interface AdvisorAnalysisCardProps {
  analysis: AdvisorAnalysis;
}

export default function AdvisorAnalysisCard({ analysis }: AdvisorAnalysisCardProps) {
  return (
    <div className="mb-4 space-y-3">
      {/* Strengths */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Profile Strengths
          </span>
        </div>
        <ul className="space-y-1.5">
          {analysis.strengths.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed text-white/80">
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Gaps */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            Gaps to Address
          </span>
        </div>
        <ul className="space-y-1.5">
          {analysis.gaps.map((g, i) => (
            <li key={i} className="text-sm leading-relaxed text-white/80">
              {g}
            </li>
          ))}
        </ul>
      </div>

      {/* Action Step */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.08] p-4 backdrop-blur-[40px]">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
            Action Step This Week
          </span>
        </div>
        <p className="text-sm leading-relaxed text-white/80">
          {analysis.actionStep}
        </p>
      </div>
    </div>
  );
}
