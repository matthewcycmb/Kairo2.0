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

interface ActivityOverride {
  name?: string;
  role?: string;
  description?: string;
}

interface ResumeData {
  fields: ResumeFields;
  hiddenActivities: string[];
  hiddenAchievements: string[];
  hiddenSkills: string[];
  activityOverrides: Record<string, ActivityOverride>;
}

const STORAGE_KEY = "kairo-resume-fields";

function loadData(profile: StudentProfile): ResumeData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Support old format (just fields) and new format (fields + hidden)
      if (parsed.fields) {
        return {
          hiddenActivities: [],
          hiddenAchievements: [],
          hiddenSkills: [],
          activityOverrides: {},
          ...parsed,
        };
      }
      return {
        fields: parsed,
        hiddenActivities: [],
        hiddenAchievements: [],
        hiddenSkills: [],
        activityOverrides: {},
      };
    }
  } catch {
    // ignore
  }
  return {
    fields: {
      name: "",
      email: "",
      phone: "",
      city: profile.goals?.location ?? "",
      school: "",
    },
    hiddenActivities: [],
    hiddenAchievements: [],
    hiddenSkills: [],
    activityOverrides: {},
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
  const [data, setData] = useState<ResumeData>(() => loadData(profile));
  const [editing, setEditing] = useState(false);
  const resumeRef = useRef<HTMLDivElement>(null);

  const fields = data.fields;
  const hiddenActivities = new Set(data.hiddenActivities);
  const hiddenAchievements = new Set(data.hiddenAchievements);
  const hiddenSkills = new Set(data.hiddenSkills);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const updateField = (key: keyof ResumeFields, value: string) => {
    setData((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  };

  const toggleHideActivity = (id: string) => {
    setData((prev) => {
      const set = new Set(prev.hiddenActivities);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, hiddenActivities: Array.from(set) };
    });
  };

  const toggleHideAchievement = (key: string) => {
    setData((prev) => {
      const set = new Set(prev.hiddenAchievements);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, hiddenAchievements: Array.from(set) };
    });
  };

  const toggleHideSkill = (skill: string) => {
    setData((prev) => {
      const set = new Set(prev.hiddenSkills);
      if (set.has(skill)) set.delete(skill);
      else set.add(skill);
      return { ...prev, hiddenSkills: Array.from(set) };
    });
  };

  const updateActivityOverride = (id: string, field: keyof ActivityOverride, value: string) => {
    setData((prev) => {
      const existing = prev.activityOverrides[id] || {};
      return {
        ...prev,
        activityOverrides: {
          ...prev.activityOverrides,
          [id]: { ...existing, [field]: value },
        },
      };
    });
  };

  const getActivityField = (id: string, field: keyof ActivityOverride, original: string | undefined) => {
    const override = data.activityOverrides[id]?.[field];
    return override !== undefined ? override : (original ?? "");
  };

  const showAll = () => {
    setData((prev) => ({
      ...prev,
      hiddenActivities: [],
      hiddenAchievements: [],
      hiddenSkills: [],
    }));
  };

  const hiddenCount =
    data.hiddenActivities.length +
    data.hiddenAchievements.length +
    data.hiddenSkills.length;

  const activitiesAndLeadership = profile.activities
    .filter((a) => ACTIVITY_CATEGORIES.includes(a.category))
    .filter((a) => !hiddenActivities.has(a.id));
  const volunteering = profile.activities
    .filter((a) => VOLUNTEERING_CATEGORIES.includes(a.category))
    .filter((a) => !hiddenActivities.has(a.id));

  // For edit mode: show all activities including hidden ones
  const allActivitiesAndLeadership = profile.activities.filter((a) =>
    ACTIVITY_CATEGORIES.includes(a.category)
  );
  const allVolunteering = profile.activities.filter((a) =>
    VOLUNTEERING_CATEGORIES.includes(a.category)
  );

  const allSkills = Array.from(
    new Set(profile.activities.flatMap((a) => a.skills ?? []))
  );
  const visibleSkills = allSkills.filter((s) => !hiddenSkills.has(s));

  const allAchievements = profile.activities.flatMap((a) =>
    (a.achievements ?? []).map((ach, i) => ({
      activity: a.name,
      text: ach,
      key: `${a.id}-ach-${i}`,
    }))
  );
  const visibleAchievements = allAchievements.filter(
    (ach) => !hiddenAchievements.has(ach.key)
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

    // Remove edit buttons from clone
    clone.querySelectorAll("[data-edit-btn]").forEach((btn) => btn.remove());

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
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Resume</h2>
            {hiddenCount > 0 && !editing && (
              <span className="rounded-full bg-white/[0.10] px-2.5 py-0.5 text-xs text-white/50">
                {hiddenCount} hidden
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                {hiddenCount > 0 && (
                  <button
                    onClick={showAll}
                    className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                  >
                    Show all
                  </button>
                )}
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                >
                  Edit
                </button>
                <button
                  onClick={handleCopy}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={handleDownloadPDF}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                >
                  Download PDF
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.22]"
                >
                  Close
                </button>
              </>
            )}
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

        {/* Single-column layout — all sections full width */}
        <div className="space-y-5">
          {(editing ? allActivitiesAndLeadership : activitiesAndLeadership).length > 0 && (
            <Section title="Activities & Leadership">
              {(editing ? allActivitiesAndLeadership : activitiesAndLeadership).map((a) => (
                <ActivityLine
                  key={a.id}
                  name={getActivityField(a.id, "name", a.name)}
                  role={getActivityField(a.id, "role", a.role)}
                  description={getActivityField(a.id, "description", a.description)}
                  editing={editing}
                  hidden={hiddenActivities.has(a.id)}
                  onToggle={() => toggleHideActivity(a.id)}
                  onEditField={(field, value) => updateActivityOverride(a.id, field, value)}
                />
              ))}
            </Section>
          )}
          {(editing ? allVolunteering : volunteering).length > 0 && (
            <Section title="Volunteering & Community">
              {(editing ? allVolunteering : volunteering).map((a) => (
                <ActivityLine
                  key={a.id}
                  name={getActivityField(a.id, "name", a.name)}
                  role={getActivityField(a.id, "role", a.role)}
                  description={getActivityField(a.id, "description", a.description)}
                  editing={editing}
                  hidden={hiddenActivities.has(a.id)}
                  onToggle={() => toggleHideActivity(a.id)}
                  onEditField={(field, value) => updateActivityOverride(a.id, field, value)}
                />
              ))}
            </Section>
          )}
          {(editing ? allAchievements : visibleAchievements).length > 0 && (
            <Section title="Achievements">
              <ul className="space-y-1">
                {(editing ? allAchievements : visibleAchievements).map((ach) => (
                  <li
                    key={ach.key}
                    className={`flex items-start gap-1.5 text-sm ${
                      hiddenAchievements.has(ach.key) ? "text-white/25 line-through" : "text-white/60"
                    }`}
                  >
                    {editing && (
                      <button
                        data-edit-btn
                        onClick={() => toggleHideAchievement(ach.key)}
                        className="mt-0.5 shrink-0 text-white/30 transition-colors hover:text-red-400"
                        title={hiddenAchievements.has(ach.key) ? "Restore" : "Hide"}
                      >
                        {hiddenAchievements.has(ach.key) ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04c-.025.04-.091.131-.194.27a13 13 0 0 1-.657.803c-.285.322-.611.656-.972.98-.722.648-1.587 1.27-2.54 1.676-.476.203-.987.358-1.523.434v1.171a.75.75 0 0 1-1.5 0V8.58a7 7 0 0 1-1.476-.424c-.96-.406-1.828-1.03-2.553-1.681A13 13 0 0 1 .58 5.461a8 8 0 0 1-.213-.295.75.75 0 0 1 1.254-.82 6 6 0 0 0 .17.235c.184.235.437.532.745.847A11 11 0 0 0 4.88 7.24c.503.213.987.35 1.358.387v-1.17a.75.75 0 0 1 1.5 0v1.176c.371-.033.86-.17 1.369-.387a11 11 0 0 0 2.346-1.81c.312-.319.567-.62.752-.858l.172-.24a.75.75 0 0 1 1.04-.162Z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                          </svg>
                        )}
                      </button>
                    )}
                    <span>
                      <span className="mr-1.5 text-white/25">&bull;</span>
                      {ach.text}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(editing ? allSkills : visibleSkills).length > 0 && (
            <Section title="Skills">
              {editing ? (
                <div className="flex flex-wrap gap-1.5">
                  {allSkills.map((skill) => (
                    <button
                      key={skill}
                      data-edit-btn
                      onClick={() => toggleHideSkill(skill)}
                      className={`rounded-full border px-2.5 py-0.5 text-sm capitalize transition-colors ${
                        hiddenSkills.has(skill)
                          ? "border-white/5 text-white/25 line-through hover:border-white/15 hover:text-white/40"
                          : "border-white/10 text-white/60 hover:border-red-400/30 hover:text-red-400"
                      }`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm capitalize leading-relaxed text-white/60">
                  {visibleSkills.join(", ")}
                </p>
              )}
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
  editing,
  hidden,
  onToggle,
  onEditField,
}: {
  name: string;
  role?: string;
  description?: string;
  editing: boolean;
  hidden: boolean;
  onToggle: () => void;
  onEditField?: (field: keyof ActivityOverride, value: string) => void;
}) {
  return (
    <div className={`mb-1.5 flex items-start gap-2 ${hidden ? "opacity-40" : ""}`}>
      {editing && (
        <button
          data-edit-btn
          onClick={onToggle}
          className="mt-0.5 shrink-0 text-white/30 transition-colors hover:text-red-400"
          title={hidden ? "Restore" : "Hide"}
        >
          {hidden ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04c-.025.04-.091.131-.194.27a13 13 0 0 1-.657.803c-.285.322-.611.656-.972.98-.722.648-1.587 1.27-2.54 1.676-.476.203-.987.358-1.523.434v1.171a.75.75 0 0 1-1.5 0V8.58a7 7 0 0 1-1.476-.424c-.96-.406-1.828-1.03-2.553-1.681A13 13 0 0 1 .58 5.461a8 8 0 0 1-.213-.295.75.75 0 0 1 1.254-.82 6 6 0 0 0 .17.235c.184.235.437.532.745.847A11 11 0 0 0 4.88 7.24c.503.213.987.35 1.358.387v-1.17a.75.75 0 0 1 1.5 0v1.176c.371-.033.86-.17 1.369-.387a11 11 0 0 0 2.346-1.81c.312-.319.567-.62.752-.858l.172-.24a.75.75 0 0 1 1.04-.162Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          )}
        </button>
      )}
      <div className={`min-w-0 flex-1 ${hidden ? "line-through" : ""}`}>
        {editing && !hidden ? (
          <>
            <div className="flex items-baseline gap-1 text-sm">
              <input
                type="text"
                value={name}
                onChange={(e) => onEditField?.("name", e.target.value)}
                className="min-w-0 flex-shrink bg-transparent font-semibold text-white/80 outline-none border-b border-dashed border-white/15 focus:border-white/40"
                style={{ width: `${Math.max(name.length, 4) * 0.6 + 1}em` }}
              />
              <span className="text-white/30">&mdash;</span>
              <input
                type="text"
                value={role ?? ""}
                onChange={(e) => onEditField?.("role", e.target.value)}
                placeholder="Role"
                className="min-w-0 flex-shrink bg-transparent italic text-white/50 outline-none border-b border-dashed border-white/15 placeholder:text-white/20 focus:border-white/40"
                style={{ width: `${Math.max((role ?? "").length, 4) * 0.6 + 1}em` }}
              />
            </div>
            <textarea
              value={description ?? ""}
              onChange={(e) => {
                onEditField?.("description", e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              placeholder="Description..."
              rows={1}
              className="mt-0.5 w-full resize-none overflow-hidden bg-transparent text-sm leading-snug text-white/45 outline-none border-b border-dashed border-white/15 placeholder:text-white/20 focus:border-white/40"
            />
          </>
        ) : (
          <>
            <p className="text-sm text-white/80">
              <span className="font-semibold">{name}</span>
              {role && <span className="italic text-white/50"> — {role}</span>}
            </p>
            {description && (
              <p className="text-sm leading-snug text-white/45">{description}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
