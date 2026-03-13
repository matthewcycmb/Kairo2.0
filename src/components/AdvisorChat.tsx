import { useState, useEffect, useRef, useMemo, useCallback, type ComponentPropsWithoutRef } from "react";
import type { AdvisorMessage } from "../types/profile";
import ReactMarkdown from "react-markdown";
import ChatBubble from "./ChatBubble";

/** Fix literal \n sequences to real newlines */
function fixNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

/** Try JSON.parse, then retry after fixing actual newlines inside JSON strings */
function tryParseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch {}
  // LLMs sometimes put actual newline chars inside JSON string values (invalid JSON)
  try {
    const fixed = text.replace(/"((?:[^"\\]|\\.)*)"/gs, (match) =>
      match.replace(/\r?\n/g, "\\n")
    );
    return JSON.parse(fixed);
  } catch {}
  return null;
}

/** Ensure message content is always a clean displayable string */
function sanitizeContent(content: unknown): string {
  if (typeof content === "string") {
    // If it looks like a raw JSON object, try to extract the message field
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = tryParseJson(trimmed);
      if (parsed && typeof parsed.message === "string") return fixNewlines(parsed.message);
    }
    return fixNewlines(content);
  }
  // If content is an object (e.g. loaded from storage incorrectly)
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.message === "string") return fixNewlines(obj.message);
    // Last resort: stringify it cleanly
    return JSON.stringify(content);
  }
  return String(content ?? "");
}

/** Typewriter hook — reveals text word by word */
function useTypewriter(text: string, active: boolean, speed: number = 18) {
  const [wordCount, setWordCount] = useState(0);
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const totalWords = words.length;

  useEffect(() => {
    if (!active) {
      setWordCount(totalWords);
      return;
    }
    setWordCount(0);
    let i = 0;
    const interval = setInterval(() => {
      // Reveal 1-3 tokens per tick for natural pacing
      const step = i < 10 ? 1 : i < 40 ? 2 : 3;
      i = Math.min(i + step, totalWords);
      setWordCount(i);
      if (i >= totalWords) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, active, totalWords, speed]);

  return {
    displayedText: words.slice(0, wordCount).join(""),
    isDone: wordCount >= totalWords,
  };
}

/** Typing indicator — three pulsing dots */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-4 px-1">
      <div className="h-2 w-2 rounded-full bg-white/30 animate-[pulse_1.4s_ease-in-out_infinite]" />
      <div className="h-2 w-2 rounded-full bg-white/30 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
      <div className="h-2 w-2 rounded-full bg-white/30 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
    </div>
  );
}

/** A single AI message with optional typewriter effect */
function AiMessage({
  content,
  isTyping,
  onTypingDone,
  markdownComponents,
}: {
  content: string;
  isTyping: boolean;
  onTypingDone: () => void;
  markdownComponents: Record<string, React.ComponentType<ComponentPropsWithoutRef<"pre">>>;
}) {
  const sanitized = useMemo(() => sanitizeContent(content), [content]);
  const { displayedText, isDone } = useTypewriter(sanitized, isTyping);

  useEffect(() => {
    if (isDone && isTyping) onTypingDone();
  }, [isDone, isTyping, onTypingDone]);

  return (
    <div className="advisor-markdown text-[17px] leading-[1.8] text-white/85">
      <ReactMarkdown components={markdownComponents}>
        {isTyping ? displayedText : sanitized}
      </ReactMarkdown>
    </div>
  );
}

interface AdvisorChatProps {
  advisorMessages: AdvisorMessage[];
  onNewMessage: (text: string) => void;
  isLoading: boolean;
  isRefreshing: boolean;
}

export default function AdvisorChat({
  advisorMessages,
  onNewMessage,
  isLoading,
  isRefreshing,
}: AdvisorChatProps) {
  const [input, setInput] = useState("");
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typingDone, setTypingDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Track IDs we've already seen so we can detect truly new messages
  const seenIdsRef = useRef<Set<string>>(new Set(advisorMessages.map((m) => m.id)));

  // Detect when a new assistant message arrives and start typewriter
  useEffect(() => {
    const lastMsg = advisorMessages[advisorMessages.length - 1];
    if (lastMsg?.role === "assistant" && !seenIdsRef.current.has(lastMsg.id)) {
      setTypingId(lastMsg.id);
      setTypingDone(false);
    }
    // Update seen IDs
    seenIdsRef.current = new Set(advisorMessages.map((m) => m.id));
  }, [advisorMessages]);

  // Auto-scroll during typing and on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [advisorMessages, isLoading, typingDone]);

  // Scroll periodically while typewriter is active
  useEffect(() => {
    if (!typingId || typingDone) return;
    const interval = setInterval(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 300);
    return () => clearInterval(interval);
  }, [typingId, typingDone]);

  const handleTypingDone = useCallback(() => {
    setTypingDone(true);
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    onNewMessage(text);
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isLoading) return;
    onNewMessage(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyBlock = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBlock(text);
      setTimeout(() => setCopiedBlock(null), 2000);
    } catch {
      // silent fail
    }
  };

  const markdownComponents = {
    pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => {
      // Extract text content from the code child
      let codeText = "";
      if (children && typeof children === "object" && "props" in (children as React.ReactElement)) {
        const codeEl = children as React.ReactElement<{ children?: string }>;
        codeText = typeof codeEl.props.children === "string" ? codeEl.props.children : "";
      }
      return (
        <div className="group relative my-2">
          <pre {...props} className="overflow-x-auto rounded-lg bg-white/[0.06] p-3 text-sm">
            {children}
          </pre>
          {codeText && (
            <button
              onClick={() => handleCopyBlock(codeText)}
              className="absolute right-2 top-2 rounded-md border border-white/10 bg-white/[0.08] px-2 py-1 text-xs text-white/50 opacity-0 transition-opacity hover:bg-white/[0.15] hover:text-white/80 group-hover:opacity-100"
            >
              {copiedBlock === codeText ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      );
    },
  };

  // Get suggestions from the last assistant message — only show after typing finishes
  const lastAssistantMsg = [...advisorMessages].reverse().find((m) => m.role === "assistant");
  const isLastMsgTyping = typingId === lastAssistantMsg?.id && !typingDone;
  const suggestions = !isLoading && !isLastMsgTyping && lastAssistantMsg?.suggestions?.length
    ? lastAssistantMsg.suggestions
    : [];

  return (
    <div className="flex h-full flex-col px-1 pt-4 sm:px-2">
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.15] bg-white/[0.07] backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)]">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 sm:px-6 text-center border-b border-white/[0.10]">
          <h2 className="text-base font-semibold text-white/90">Kairo Advisor</h2>
          <p className="mt-1 text-sm text-white/50">Honest advice based on your profile</p>
        </div>

        {/* Messages area — independently scrollable */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 sm:px-6">
          {advisorMessages.length === 0 && !isLoading && !isRefreshing && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16">
              <div className="text-4xl text-white/20">&#10042;</div>
              <p className="text-center font-serif text-2xl leading-snug text-white/50">
                What's on your mind?
              </p>
            </div>
          )}

          {isRefreshing && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16">
              <div className="text-4xl text-white/20 animate-pulse">&#10042;</div>
              <p className="text-center font-serif text-2xl leading-snug text-white/50">
                Starting fresh...
              </p>
            </div>
          )}

          {advisorMessages.map((msg) => (
            <ChatBubble key={msg.id} type={msg.role === "user" ? "user" : "ai"}>
              {msg.role === "user" ? (
                <div className="text-[16px] leading-relaxed">{msg.content}</div>
              ) : (
                <AiMessage
                  content={msg.content}
                  isTyping={typingId === msg.id && !typingDone}
                  onTypingDone={handleTypingDone}
                  markdownComponents={markdownComponents}
                />
              )}
            </ChatBubble>
          ))}

          {/* Suggestion chips — fade in after typing completes */}
          {suggestions.length > 0 && (
            <div className="flex flex-col items-start gap-2.5 pb-4 pt-1 animate-[fadeIn_0.4s_ease-out]">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(s)}
                  className="max-w-[90%] rounded-2xl border border-white/[0.15] bg-white/[0.07] px-4 py-3 text-left text-[15px] leading-snug text-white/70 transition-all hover:border-white/[0.25] hover:bg-white/[0.12] hover:text-white/90"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {isLoading && <TypingIndicator />}

          <div ref={bottomRef} />
        </div>

        {/* Input area — pinned to bottom */}
        <div className="shrink-0 px-4 pb-4 pt-3 sm:px-6">
          <div className="relative flex items-end rounded-2xl border border-white/[0.12] bg-white/[0.06]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask your advisor anything..."
              disabled={isLoading}
              rows={1}
              className="flex-1 resize-none overflow-hidden bg-transparent px-4 py-3.5 text-base text-white/90 placeholder:text-white/40 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="m-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.10] text-white/40 transition-all hover:bg-white/[0.20] hover:text-white/70 disabled:opacity-30 [&:not(:disabled)]:text-white/60"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
