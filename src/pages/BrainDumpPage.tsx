import { useState, useRef, useCallback } from "react";

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
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={10}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white p-4 pr-14 text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {supportsVoice && (
            <button
              onClick={toggleListening}
              type="button"
              className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                isListening
                  ? "animate-pulse bg-red-500 text-white shadow-lg"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
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
          <p className="mt-2 text-center text-sm text-red-500">
            Listening... tap the mic to stop
          </p>
        )}

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
