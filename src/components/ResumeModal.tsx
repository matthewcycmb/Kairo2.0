import { useState, useRef, useEffect } from "react";
import type { StudentProfile } from "../types/profile";
import type { ActivityCategory } from "../types/activity";
import { formatResumeAsText } from "../lib/profileUtils";

interface ResumeModalProps {
  profile: StudentProfile;
  onClose: () => void;
}

interface ResumeFields {
  name: string;
  email: string;
  phone: string;
  city: string;
  school: string;
}

const STORAGE_KEY = "kairo-resume-fields";

function loadFields(profile: StudentProfile): ResumeFields {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore
  }
  return {
    name: "",
    email: "",
    phone: "",
    city: profile.goals?.location ?? "",
    school: "",
  };
}

const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "Sports",
  "Arts & Music",
  "Clubs",
  "Work & Leadership",
];

const VOLUNTEERING_CATEGORIES: ActivityCategory[] = ["Volunteering"];

export default function ResumeModal({ profile, onClose }: ResumeModalProps) {
  const [copied, setCopied] = useState(false);
  const [fields, setFields] = useState<ResumeFields>(() => loadFields(profile));
  const resumeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
  }, [fields]);

  const updateField = (key: keyof ResumeFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const activitiesAndLeadership = profile.activities.filter((a) =>
    ACTIVITY_CATEGORIES.includes(a.category)
  );
  const volunteering = profile.activities.filter((a) =>
    VOLUNTEERING_CATEGORIES.includes(a.category)
  );

  const allSkills = Array.from(
    new Set(profile.activities.flatMap((a) => a.skills ?? []))
  );

  const allAchievements = profile.activities.flatMap((a) =>
    (a.achievements ?? []).map((ach) => ({ activity: a.name, text: ach }))
  );

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
    const el = resumeRef.current;
    if (!el) return;

    const clone = el.cloneNode(true) as HTMLElement;
    clone.classList.add("resume-print-clone");

    // cloneNode doesn't copy input values — replace inputs with spans
    const origInputs = el.querySelectorAll("input");
    const cloneInputs = clone.querySelectorAll("input");
    cloneInputs.forEach((input, i) => {
      const span = document.createElement("span");
      span.textContent = origInputs[i].value || origInputs[i].placeholder;
      span.className = input.className.replace(/border-b|border-dashed|border-white\/20|focus:\S+|placeholder:\S+|outline-none/g, "");
      input.replaceWith(span);
    });

    document.body.appendChild(clone);

    const cleanup = () => {
      clone.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);

    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={resumeRef}
        className="resume-content mx-4 my-8 w-full max-w-3xl rounded-2xl border border-white/[0.15] bg-white/[0.08] p-6 shadow-2xl backdrop-blur-[40px] sm:my-16 sm:p-8"
      >
        {/* Toolbar — hidden in print */}
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

        {/* Name + Contact */}
        <div className="mb-4 border-b border-white/10 pb-3 text-center">
          <EditableField
            value={fields.name}
            placeholder="Your Name"
            onChange={(v) => updateField("name", v)}
            className="text-2xl font-bold text-white/80"
          />
          <div className="mt-1 flex items-center justify-center gap-1 text-sm text-white/40">
            <EditableField
              value={fields.email}
              placeholder="Email"
              onChange={(v) => updateField("email", v)}
              className="text-sm text-white/40"
            />
            <span>&middot;</span>
            <EditableField
              value={fields.phone}
              placeholder="Phone"
              onChange={(v) => updateField("phone", v)}
              className="text-sm text-white/40"
            />
            <span>&middot;</span>
            <EditableField
              value={fields.city}
              placeholder="City, Province"
              onChange={(v) => updateField("city", v)}
              className="text-sm text-white/40"
            />
          </div>
        </div>

        {/* Layout: two columns when enough content, single column otherwise */}
        {(() => {
          const leftCount = activitiesAndLeadership.length + volunteering.length;
          const rightCount = allAchievements.length + (allSkills.length > 0 ? 1 : 0);
          const useTwoColumns = leftCount >= 3 && rightCount >= 2;

          if (useTwoColumns) {
            return (
              <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                <div className="flex-1 min-w-0 space-y-5">
                  {activitiesAndLeadership.length > 0 && (
                    <Section title="Activities & Leadership">
                      {activitiesAndLeadership.map((a) => (
                        <ActivityLine key={a.id} name={a.name} role={a.role} description={a.description} />
                      ))}
                    </Section>
                  )}
                  {volunteering.length > 0 && (
                    <Section title="Volunteering & Community">
                      {volunteering.map((a) => (
                        <ActivityLine key={a.id} name={a.name} role={a.role} description={a.description} />
                      ))}
                    </Section>
                  )}
                </div>
                <div className="md:w-[38%] space-y-5">
                  {allAchievements.length > 0 && (
                    <Section title="Achievements">
                      <ul className="space-y-1">
                        {allAchievements.map((ach, i) => (
                          <li key={i} className="text-sm text-white/60">
                            <span className="mr-1.5 text-white/25">&bull;</span>
                            {ach.text}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {allSkills.length > 0 && (
                    <Section title="Skills">
                      <p className="text-sm capitalize leading-relaxed text-white/60">
                        {allSkills.join(", ")}
                      </p>
                    </Section>
                  )}
                  <Section title="Education">
                    <p className="text-sm text-white/60">
                      <EditableField
                        value={fields.school}
                        placeholder="School Name"
                        onChange={(v) => updateField("school", v)}
                        className="text-sm font-semibold text-white/80"
                      />
                      {profile.goals?.grade && (
                        <span> &mdash; Grade {profile.goals.grade}</span>
                      )}
                    </p>
                  </Section>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-5">
              {activitiesAndLeadership.length > 0 && (
                <Section title="Activities & Leadership">
                  {activitiesAndLeadership.map((a) => (
                    <ActivityLine key={a.id} name={a.name} role={a.role} description={a.description} />
                  ))}
                </Section>
              )}
              {volunteering.length > 0 && (
                <Section title="Volunteering & Community">
                  {volunteering.map((a) => (
                    <ActivityLine key={a.id} name={a.name} role={a.role} description={a.description} />
                  ))}
                </Section>
              )}
              {allAchievements.length > 0 && (
                <Section title="Achievements">
                  <ul className="space-y-1">
                    {allAchievements.map((ach, i) => (
                      <li key={i} className="text-sm text-white/60">
                        <span className="mr-1.5 text-white/25">&bull;</span>
                        {ach.text}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {allSkills.length > 0 && (
                <Section title="Skills">
                  <p className="text-sm capitalize leading-relaxed text-white/60">
                    {allSkills.join(", ")}
                  </p>
                </Section>
              )}
              <Section title="Education">
                <p className="text-sm text-white/60">
                  <EditableField
                    value={fields.school}
                    placeholder="School Name"
                    onChange={(v) => updateField("school", v)}
                    className="text-sm font-semibold text-white/80"
                  />
                  {profile.goals?.grade && (
                    <span> &mdash; Grade {profile.goals.grade}</span>
                  )}
                </p>
              </Section>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function EditableField({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${className} inline-block border-b border-dashed border-white/20 bg-transparent text-center outline-none placeholder:text-white/25 focus:border-white/40`}
      style={{ width: `${Math.max(value.length, placeholder.length) * 0.6 + 1.5}em` }}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 border-b border-white/10 pb-1 text-xs font-bold uppercase tracking-wider text-white/50">
        {title}
      </h3>
      {children}
    </div>
  );
}

function ActivityLine({
  name,
  role,
  description,
}: {
  name: string;
  role?: string;
  description?: string;
}) {
  return (
    <div className="mb-1.5">
      <p className="text-sm text-white/80">
        <span className="font-semibold">{name}</span>
        {role && <span className="italic text-white/50"> — {role}</span>}
      </p>
      {description && (
        <p className="text-sm leading-snug text-white/45">{description}</p>
      )}
    </div>
  );
}
