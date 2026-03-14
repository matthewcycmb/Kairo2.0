import { useState, useEffect, useRef } from "react";
import type { StudentProfile, StrategyGuideResponse, StrategyAOResponse } from "../types/profile";
import { callApi } from "../lib/apiClient";

interface StrategyProps {
  profile: StudentProfile;
  onDiscussWithAdvisor?: (strategyContext: string) => void;
  autoSubmit?: boolean;
}

/** Render text with **bold** markdown and paragraph breaks */
function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={i > 0 ? "mt-4" : ""}>
          {p.split(/(\*\*[^*]+\*\*)/).map((segment, j) =>
            segment.startsWith("**") && segment.endsWith("**") ? (
              <strong key={j} className="font-semibold text-white/95">{segment.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{segment}</span>
            )
          )}
        </p>
      ))}
    </>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.05] last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-[15px] font-medium text-white/60 sm:text-base">{title}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          className={`h-4 w-4 shrink-0 text-white/20 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="pb-6 text-[15px] leading-[1.75] text-white/65 sm:text-base sm:leading-[1.8]">
          {children}
        </div>
      )}
    </div>
  );
}

function getVerdictStyle(verdict: string): { label: string; color: string; bg: string; border: string } {
  const lower = verdict.toLowerCase();
  if (lower.includes("admit") && !lower.includes("waitlist") && !lower.includes("reject") && !lower.includes("borderline") && !lower.includes("unlikely")) {
    return { label: "Likely Admit", color: "text-green-400", bg: "bg-green-500/[0.08]", border: "border-green-500/20" };
  }
  if (lower.includes("reject") || lower.includes("unlikely")) {
    return { label: "Tough Odds", color: "text-red-400", bg: "bg-red-500/[0.08]", border: "border-red-500/20" };
  }
  return { label: "Borderline", color: "text-amber-400", bg: "bg-amber-500/[0.08]", border: "border-amber-500/20" };
}

export default function Strategy({ profile, onDiscussWithAdvisor, autoSubmit }: StrategyProps) {
  const [targetProgram, setTargetProgram] = useState(
    profile.goals?.targetUniversities || ""
  );
  const [phase, setPhase] = useState<"input" | "loading" | "results">("input");
  const [error, setError] = useState<string | null>(null);

  const [aoData, setAoData] = useState<StrategyAOResponse | null>(null);
  const [guideData, setGuideData] = useState<StrategyGuideResponse | null>(null);

  const [aoReady, setAoReady] = useState(false);
  const [guideReady, setGuideReady] = useState(false);

  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (autoSubmit && !autoSubmittedRef.current && targetProgram.trim().length >= 3 && phase === "input") {
      autoSubmittedRef.current = true;
      handleAnalyze();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = async () => {
    if (targetProgram.trim().length < 3) return;

    setPhase("loading");
    setError(null);
    setAoData(null);
    setGuideData(null);
    setAoReady(false);
    setGuideReady(false);

    const program = targetProgram.trim();

    const results = await Promise.allSettled([
      callApi({ type: "strategy-ao", profile, targetProgram: program }).then((r) => {
        setAoData(r);
        setAoReady(true);
        try { localStorage.setItem("kairo-ao-review", JSON.stringify({ ...r, targetProgram: program })); } catch {}
      }),
      callApi({ type: "strategy-guide", profile, targetProgram: program }).then((r) => {
        setGuideData(r);
        setGuideReady(true);
      }),
    ]);

    const allFailed = results.every((r) => r.status === "rejected");
    if (allFailed) {
      const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      const msg = firstErr?.reason instanceof Error ? firstErr.reason.message : "Unknown error";
      setError(`Analysis failed: ${msg}`);
      setPhase("input");
      return;
    }

    setPhase("results");
  };

  const handleReset = () => {
    setPhase("input");
    setAoData(null);
    setGuideData(null);
    setAoReady(false);
    setGuideReady(false);
    setError(null);
  };

  const loadingSpinner = (label: string) => (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <svg className="h-5 w-5 animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-white/30">{label}</span>
    </div>
  );

  const verdictStyle = aoData ? getVerdictStyle(aoData.verdict) : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Input card */}
      <div className="rounded-2xl border border-white/[0.10] bg-white/[0.05] px-5 py-4 sm:px-6 sm:py-5">
        <input
          type="text"
          value={targetProgram}
          onChange={(e) => setTargetProgram(e.target.value)}
          placeholder="Target program — e.g. Waterloo CS"
          disabled={phase !== "input"}
          className="w-full bg-transparent text-[15px] text-white placeholder:text-white/30 focus:outline-none disabled:opacity-60 sm:text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter" && phase === "input") {
              e.preventDefault();
              handleAnalyze();
            }
          }}
        />

        {phase === "input" && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-white/40">
              {targetProgram.trim().length > 0 && targetProgram.trim().length < 3
                ? `${3 - targetProgram.trim().length} more characters needed`
                : "\u00A0"}
            </span>
            <button
              onClick={handleAnalyze}
              disabled={targetProgram.trim().length < 3}
              className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analyze
            </button>
          </div>
        )}
        {phase !== "input" && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleReset}
              className="text-sm text-white/40 transition-colors hover:text-white/60"
            >
              Try another program
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

      {/* AO Review */}
      {(phase === "loading" || phase === "results") && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-5 sm:p-8">
          <h3 className="text-xs font-medium tracking-widest text-white/25 uppercase">Admissions Officer Review</h3>
          {!aoReady ? loadingSpinner("Reading your application...") : aoData && verdictStyle && (
            <div>
              {/* Verdict hero */}
              <div className={`mt-6 rounded-2xl border ${verdictStyle.border} ${verdictStyle.bg} p-6 sm:p-8`}>
                <span className={`text-2xl font-bold ${verdictStyle.color} sm:text-3xl`}>{verdictStyle.label}</span>
                <div className="mt-4 text-[15px] leading-[1.75] text-white/70 sm:text-base sm:leading-[1.8]">
                  <RichText text={aoData.verdict} />
                </div>
              </div>

              {/* Next steps — always visible */}
              {aoData.nextSteps && (
                <div className="mt-5 rounded-2xl border border-blue-500/15 bg-blue-500/[0.04] p-6 sm:p-8">
                  <h4 className="mb-4 text-xs font-medium tracking-widest text-blue-400/70 uppercase">Next Steps</h4>
                  <div className="text-[15px] leading-[1.75] text-white/70 sm:text-base sm:leading-[1.8]">
                    <RichText text={aoData.nextSteps} />
                  </div>
                </div>
              )}

              {/* Collapsible detail sections */}
              <div className="mt-4">
                <Accordion title="First Impression">
                  <RichText text={aoData.firstImpression} />
                </Accordion>
                <Accordion title="What Stands Out">
                  <RichText text={aoData.strengths} />
                </Accordion>
                <Accordion title="Concerns">
                  <RichText text={aoData.concerns} />
                </Accordion>
                <Accordion title="How You Compare">
                  <RichText text={aoData.comparison} />
                </Accordion>
              </div>

              {onDiscussWithAdvisor && (
                <button
                  onClick={() => {
                    const summary = `AO Review for "${targetProgram}":\n\nFirst Impression: ${aoData.firstImpression}\n\nStrengths: ${aoData.strengths}\n\nConcerns: ${aoData.concerns}\n\nComparison: ${aoData.comparison}\n\nVerdict: ${aoData.verdict}\n\nNext Steps: ${aoData.nextSteps || "N/A"}`;
                    onDiscussWithAdvisor(summary);
                  }}
                  className="mt-4 w-full rounded-xl border border-white/[0.15] bg-white/[0.10] py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
                >
                  Discuss with Advisor
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Strategy Guide */}
      {(phase === "loading" || phase === "results") && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-5 sm:p-8">
          <h3 className="text-xs font-medium tracking-widest text-white/25 uppercase">Program Strategy Guide</h3>
          {!guideReady ? loadingSpinner("Building your strategy...") : guideData && (
            <div className="mt-2">
              <Accordion title="What They Look For" defaultOpen>
                <RichText text={guideData.whatTheyLookFor} />
              </Accordion>
              <Accordion title="Activities to Emphasize">
                <RichText text={guideData.activitiesToEmphasize} />
              </Accordion>
              <Accordion title="Activities to Downplay">
                <RichText text={guideData.activitiesToDownplay} />
              </Accordion>
              <Accordion title="Your Narrative Strategy">
                <RichText text={guideData.narrativeStrategy} />
              </Accordion>
              <Accordion title="Essay Approach">
                <RichText text={guideData.essayApproach} />
              </Accordion>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {phase === "input" && !error && (
        <div className="flex flex-1 items-center justify-center py-12">
          <p className="text-base text-white/30">Enter a program above to get started</p>
        </div>
      )}
    </div>
  );
}
