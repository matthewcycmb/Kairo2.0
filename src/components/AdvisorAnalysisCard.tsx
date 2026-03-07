import { useState, useRef, useEffect } from "react";
import type { AdvisorAnalysis } from "../types/profile";

interface AdvisorAnalysisCardProps {
  analysis: AdvisorAnalysis;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-white/40 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CollapsibleSection({
  title,
  borderColor,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  borderColor: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [children]);

  return (
    <div className="rounded-xl border border-white/[0.15] bg-[rgba(15,20,30,0.85)] p-4 sm:p-6">
      {/* Header — tappable on mobile, static on desktop */}
      <button
        onClick={onToggle}
        className={`flex w-full items-center justify-between border-l-[3px] pl-3 text-left sm:pointer-events-none ${borderColor}`}
      >
        <span className="text-lg font-bold text-white/90">{title}</span>
        <span className="sm:hidden">
          <ChevronIcon open={isOpen} />
        </span>
      </button>
      {/* Content — animated on mobile, always visible on desktop */}
      <div
        className="overflow-hidden transition-[max-height] duration-200 ease-in-out sm:!max-h-none"
        style={{ maxHeight: isOpen ? `${height + 16}px` : "0px" }}
      >
        <div ref={contentRef} className="pt-3">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AdvisorAnalysisCard({ analysis }: AdvisorAnalysisCardProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (key: string) => {
    setOpenSection((prev) => (prev === key ? null : key));
  };

  return (
    <div className="mb-4 space-y-3">
      <CollapsibleSection
        title="Profile Strengths"
        borderColor="border-white"
        isOpen={openSection === "strengths"}
        onToggle={() => toggle("strengths")}
      >
        <ul className="space-y-2">
          {analysis.strengths.map((s, i) => (
            <li key={i} className="text-base leading-relaxed text-white/70">
              {s}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="Gaps to Address"
        borderColor="border-amber-400"
        isOpen={openSection === "gaps"}
        onToggle={() => toggle("gaps")}
      >
        <ul className="space-y-2">
          {analysis.gaps.map((g, i) => (
            <li key={i} className="text-base leading-relaxed text-white/70">
              {g}
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="Action Step This Week"
        borderColor="border-blue-400"
        isOpen={openSection === "action"}
        onToggle={() => toggle("action")}
      >
        <p className="text-base leading-relaxed text-white/70">
          {analysis.actionStep}
        </p>
      </CollapsibleSection>
    </div>
  );
}
