import { useState, useEffect, useRef } from "react";
import type { StudentProfile, StrategyGuideResponse, StrategyAOResponse } from "../types/profile";
import { callApi } from "../lib/apiClient";
import { track } from "../lib/analytics";

const LOADING_STAGES = [
  "Reading your activities...",
  "Cross-referencing your profile...",
  "Comparing to other applicants...",
  "Evaluating program fit...",
  "Checking admission standards...",
  "Writing your verdict...",
  "Almost done...",
];

function StagedLoader({ program }: { program: string }) {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const stageInterval = setInterval(() => {
      setStage((s) => (s < LOADING_STAGES.length - 1 ? s + 1 : s));
    }, 2500);
    return () => clearInterval(stageInterval);
  }, []);

  // Smooth progress bar that slows down as it approaches 90%
  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        const remaining = 90 - p;
        return p + remaining * 0.04;
      });
    }, 200);
    return () => clearInterval(progressInterval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-14">
      <div className="w-48">
        <div className="h-[2px] overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-white/20 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm text-white/40 animate-[fadeIn_0.3s_ease-out]" key={stage}>{LOADING_STAGES[stage]}</p>
        <p className="mt-1.5 text-xs text-white/15">{program}</p>
      </div>
    </div>
  );
}

interface StrategyProps {
  profile: StudentProfile;
  profileId: string | null;
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button onClick={handleCopy} className="text-xs text-white/25 transition-colors hover:text-white/50">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function loadCachedStrategy(profileId: string | null): { ao: StrategyAOResponse; guide: StrategyGuideResponse; program: string } | null {
  if (!profileId) return null;
  try {
    const raw = localStorage.getItem(`kairo-strategy-${profileId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.ao?.verdict && data?.guide?.whatTheyLookFor && data?.program) return data;
  } catch {}
  return null;
}

function saveCachedStrategy(profileId: string | null, ao: StrategyAOResponse, guide: StrategyGuideResponse, program: string) {
  if (!profileId) return;
  try { localStorage.setItem(`kairo-strategy-${profileId}`, JSON.stringify({ ao, guide, program })); } catch {}
}

export default function Strategy({ profile, profileId, onDiscussWithAdvisor, autoSubmit }: StrategyProps) {
  const cached = useRef(loadCachedStrategy(profileId));

  const [targetProgram, setTargetProgram] = useState(
    cached.current?.program || profile.goals?.targetUniversities || ""
  );
  const [phase, setPhase] = useState<"input" | "loading" | "results">(cached.current ? "results" : "input");
  const [error, setError] = useState<string | null>(null);

  const [aoData, setAoData] = useState<StrategyAOResponse | null>(cached.current?.ao || null);
  const [guideData, setGuideData] = useState<StrategyGuideResponse | null>(cached.current?.guide || null);

  const [aoReady, setAoReady] = useState(!!cached.current?.ao);
  const [guideReady, setGuideReady] = useState(!!cached.current?.guide);

  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (autoSubmit && !autoSubmittedRef.current && targetProgram.trim().length >= 3 && phase === "input") {
      autoSubmittedRef.current = true;
      handleAnalyze();
    }
  }, [autoSubmit]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = async () => {
    if (targetProgram.trim().length < 3) return;

    setPhase("loading");
    setError(null);
    setAoData(null);
    setGuideData(null);
    setAoReady(false);
    setGuideReady(false);

    const program = targetProgram.trim();
    let aoResult: StrategyAOResponse | null = null;
    let guideResult: StrategyGuideResponse | null = null;

    const results = await Promise.allSettled([
      callApi({ type: "strategy-ao", profile, targetProgram: program }).then((r) => {
        aoResult = r;
        setAoData(r);
        setAoReady(true);
        try { localStorage.setItem(profileId ? `kairo-ao-review-${profileId}` : "kairo-ao-review", JSON.stringify({ ...r, targetProgram: program })); } catch {}
      }),
      callApi({ type: "strategy-guide", profile, targetProgram: program }).then((r) => {
        guideResult = r;
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

    track("strategy_analyzed", { program: targetProgram.trim() });

    // Cache results for persistence across page refreshes
    if (aoResult && guideResult) {
      saveCachedStrategy(profileId, aoResult, guideResult, program);
    }

    setPhase("results");
  };

  const handleReset = () => {
    setPhase("input");
    if (profileId) try { localStorage.removeItem(`kairo-strategy-${profileId}`); } catch {}
    setAoData(null);
    setGuideData(null);
    setAoReady(false);
    setGuideReady(false);
    setError(null);
  };

  const loadingSpinner = (_label: string) => (
    <StagedLoader program={targetProgram} />
  );

  const verdictStyle = aoData ? getVerdictStyle(aoData.verdict) : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Input card */}
      {phase === "input" ? (
        <div className="px-1">
          <div className="rounded-2xl border border-white/[0.10] bg-white/[0.05] px-5 py-4 sm:px-6 sm:py-5">
            <input
              type="text"
              value={targetProgram}
              onChange={(e) => setTargetProgram(e.target.value)}
              placeholder="Target program — e.g. Waterloo CS"
              className="w-full bg-transparent text-[15px] text-white placeholder:text-white/25 focus:outline-none sm:text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAnalyze();
                }
              }}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleAnalyze}
              disabled={targetProgram.trim().length < 3}
              className="text-sm font-medium text-white/60 transition-colors hover:text-white disabled:opacity-30"
            >
              Analyze →
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-1">
          <span className="truncate text-sm text-white/50">{targetProgram}</span>
          <button
            onClick={handleReset}
            className="shrink-0 text-xs text-white/30 transition-colors hover:text-white/50"
          >
            Change
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-300">
          {error}
          <div className="mt-2 flex gap-3">
            <button onClick={handleAnalyze} className="font-medium underline">
              Retry
            </button>
            <button onClick={() => setError(null)} className="text-red-300/60 underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Loading state — show until AO review is ready */}
      {(phase === "loading" || phase === "results") && !aoReady && (
        loadingSpinner(`Analyzing for ${targetProgram}...`)
      )}

      {/* AO Review — show once ready (hero, always first) */}
      {aoReady && aoData && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-5 sm:p-8">
          <h3 className="mb-4 text-xs font-medium tracking-widest text-white/20 uppercase">Admissions Officer Review</h3>
          {aoData && verdictStyle && (
            <div>
              {/* Verdict hero */}
              <div className={`rounded-2xl border ${verdictStyle.border} ${verdictStyle.bg} p-6 sm:p-8`}>
                <div className="flex items-start justify-between">
                  <span className={`text-2xl font-bold ${verdictStyle.color} sm:text-3xl`}>{verdictStyle.label}</span>
                  <CopyButton text={`${verdictStyle.label} for ${targetProgram}\n\n${aoData.verdict}${aoData.nextSteps ? `\n\nNext Steps:\n${aoData.nextSteps}` : ""}`} />
                </div>
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
                <div className="mt-6 text-center">
                  <button
                    onClick={() => {
                      const summary = `AO Review for "${targetProgram}":\n\nFirst Impression: ${aoData.firstImpression}\n\nStrengths: ${aoData.strengths}\n\nConcerns: ${aoData.concerns}\n\nComparison: ${aoData.comparison}\n\nVerdict: ${aoData.verdict}\n\nNext Steps: ${aoData.nextSteps || "N/A"}`;
                      onDiscussWithAdvisor(summary);
                    }}
                    className="text-sm text-white/40 transition-colors hover:text-white/60"
                  >
                    Discuss with Advisor →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Strategy Guide — show only after AO review is ready */}
      {aoReady && guideReady && guideData && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-5 sm:p-8">
          <h3 className="mb-2 text-xs font-medium tracking-widest text-white/20 uppercase">Program Strategy Guide</h3>
          <div>
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
