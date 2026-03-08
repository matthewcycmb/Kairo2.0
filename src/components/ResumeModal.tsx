import { useState, useRef } from "react";
import type { StudentProfile } from "../types/profile";
import { groupByCategory, getCategoryDisplayName, formatResumeAsText } from "../lib/profileUtils";

interface ResumeModalProps {
  profile: StudentProfile;
  onClose: () => void;
}

export default function ResumeModal({ profile, onClose }: ResumeModalProps) {
  const [copied, setCopied] = useState(false);
  const grouped = groupByCategory(profile.activities);
  const resumeRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatResumeAsText(profile));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  };

  const handleDownloadPDF = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm print:static print:block print:overflow-visible print:bg-white"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={resumeRef}
        className="resume-content mx-4 my-8 w-full max-w-2xl rounded-2xl border border-white/[0.15] bg-[#1a1a2e]/95 p-6 shadow-2xl backdrop-blur-xl sm:my-16 sm:p-8 print:mx-auto print:my-0 print:max-w-none print:rounded-none print:border-none print:bg-white print:p-[0.75in] print:shadow-none"
      >
        {/* Header — hidden in print */}
        <div className="mb-6 flex items-center justify-between print:hidden">
          <h2 className="text-xl font-bold text-white">Resume</h2>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleDownloadPDF}
              className="rounded-lg border border-white/[0.15] bg-white/[0.10] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
            >
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-white/[0.10] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {/* Contact placeholder */}
        <div className="mb-8 border-b border-white/10 pb-4 text-center print:border-black/20 print:pb-3">
          <p className="text-lg font-semibold text-white/60 print:text-xl print:text-black">[Your Name]</p>
          <p className="mt-1 text-sm text-white/35 print:text-black/60">[Email] | [Phone] | [City, Province]</p>
        </div>

        {/* Activities by category */}
        {Array.from(grouped.entries()).map(([category, activities]) => (
          <div key={category} className="mb-8">
            <h3 className="mb-3 border-b border-white/10 pb-1 text-sm font-bold uppercase tracking-wider text-white/70 print:border-black/20 print:text-black">
              {getCategoryDisplayName(category)}
            </h3>
            <div className="space-y-6">
              {activities.map((activity) => (
                <div key={activity.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-white/90 print:text-black">{activity.name}</p>
                    {activity.yearsActive && (
                      <span className="shrink-0 text-sm text-white/40 print:text-black/50">{activity.yearsActive}</span>
                    )}
                  </div>
                  {activity.role && (
                    <p className="text-sm italic text-white/50 print:text-black/60">{activity.role}</p>
                  )}
                  {activity.description && (
                    <p className="text-sm text-white/60 print:text-black/70">{activity.description}</p>
                  )}
                  {activity.achievements && activity.achievements.length > 0 && (
                    <ul className="space-y-0.5 pl-1">
                      {activity.achievements.map((a, i) => (
                        <li key={i} className="text-sm text-white/60 print:text-black/70">
                          <span className="mr-1.5 text-white/30 print:text-black/40">&#8226;</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                  {activity.skills && activity.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {activity.skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs text-white/50 print:border-black/15 print:bg-black/[0.04] print:text-black/60"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
