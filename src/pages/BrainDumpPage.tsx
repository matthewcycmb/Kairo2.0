import { useState, useRef, useCallback } from "react";
import { lookupIdentifier } from "../lib/profileApi";

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
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false);
  const [showLookup, setShowLookup] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const supportsVoice = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const startRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-CA";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[0];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        setText((prev) => (prev ? prev + " " : "") + transcript);
      }
    };

    recognition.onend = () => {
      if (wantListeningRef.current) {
        // Restart for next utterance
        startRecognition();
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = () => {
      wantListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      wantListeningRef.current = false;
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    wantListeningRef.current = true;
    setIsListening(true);
    startRecognition();
  }, [isListening, startRecognition]);

  const handleLookup = async () => {
    if (!lookupInput.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const profileId = await lookupIdentifier(lookupInput.trim());
      if (profileId) {
        window.location.href = window.location.origin + "?p=" + profileId;
      } else {
        setLookupError("No profile found for that identifier");
      }
    } catch {
      setLookupError("Something went wrong. Try again.");
    } finally {
      setLookupLoading(false);
    }
  };

  const canSubmit = text.trim().length >= 20 && !isLoading;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Kairo
        </h1>
        <p className="text-sm text-white/60 sm:text-lg">
          Turn your scattered EC's into an organized portfolio
        </p>
      </div>

      <div className="w-full rounded-2xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px] sm:p-6">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={8}
            className="w-full resize-none rounded-xl border border-white/[0.12] bg-white/[0.06] p-3 pr-12 text-sm text-white shadow-sm placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 sm:p-4 sm:pr-14 sm:text-base"
          />
          {supportsVoice && (
            <button
              onClick={toggleListening}
              type="button"
              className={`absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full transition-all sm:right-3 sm:top-3 ${
                isListening
                  ? "animate-pulse bg-red-500 text-white shadow-lg"
                  : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
              }`}
              title={isListening ? "Stop recording" : "Voice input"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                <path d="M17 11a1 1 0 0 1 2 0 7 7 0 0 1-6 6.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z" />
              </svg>
            </button>
          )}
        </div>

        {isListening && (
          <p className="mt-2 text-center text-sm text-red-400">
            Listening... tap the mic to stop
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-white/40">
            {text.trim().length < 20 && text.trim().length > 0
              ? `${20 - text.trim().length} more characters needed`
              : "\u00A0"}
          </span>
          <button
            onClick={() => onSubmit(text.trim())}
            disabled={!canSubmit}
            className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40 sm:px-6 sm:text-base"
          >
            Let's go →
          </button>
        </div>
      </div>

      <div className="mt-4 text-center">
        {!showLookup ? (
          <button
            onClick={() => setShowLookup(true)}
            className="text-sm text-white/40 transition-colors hover:text-white/60"
          >
            Already have a profile? Find it here.
          </button>
        ) : (
          <div className="mx-auto max-w-sm space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={lookupInput}
                onChange={(e) => { setLookupInput(e.target.value); setLookupError(null); }}
                placeholder="Your Instagram or email"
                className="flex-1 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
              <button
                onClick={handleLookup}
                disabled={!lookupInput.trim() || lookupLoading}
                className="shrink-0 rounded-lg border border-white/[0.15] bg-white/[0.15] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:opacity-40"
              >
                {lookupLoading ? "Finding..." : "Find"}
              </button>
            </div>
            {lookupError && (
              <p className="text-sm text-red-400">{lookupError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
