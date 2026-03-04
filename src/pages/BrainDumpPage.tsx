import { useState } from "react";

interface BrainDumpPageProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
}

const PLACEHOLDER = `Just dump everything here! For example:

- I play basketball on the school team, been doing it since grade 9
- I volunteer at the food bank on weekends
- I'm in the robotics club, we went to provincials last year
- I tutor grade 9 math
- I work part-time at Tim Hortons
- I got my Standard First Aid cert last summer`;

export default function BrainDumpPage({ onSubmit, isLoading }: BrainDumpPageProps) {
  const [text, setText] = useState("");

  const canSubmit = text.trim().length >= 20 && !isLoading;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-gray-900">
          Kairo
        </h1>
        <p className="text-lg text-gray-500">
          Dump your activities. We'll make them look good.
        </p>
      </div>

      <div className="w-full">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          className="w-full resize-none rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-400">
            {text.trim().length < 20 && text.trim().length > 0
              ? `${20 - text.trim().length} more characters needed`
              : "\u00A0"}
          </span>
          <button
            onClick={() => onSubmit(text.trim())}
            disabled={!canSubmit}
            className="rounded-xl bg-blue-500 px-6 py-2.5 font-medium text-white shadow-sm transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Let's go →
          </button>
        </div>
      </div>
    </div>
  );
}
