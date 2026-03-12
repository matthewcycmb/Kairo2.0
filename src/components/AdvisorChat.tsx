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
    <div className="flex items-center gap-1 py-4 px-1">
      <div className="h-2 w-2 rounded-full bg-white/40 animate-[pulse_1.4s_ease-in-out_infinite]" />
      <div className="h-2 w-2 rounded-full bg-white/40 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
      <div className="h-2 w-2 rounded-full bg-white/40 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
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
    <div className="advisor-markdown text-base leading-[1.6]">
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
  const prevMsgCountRef = useRef(advisorMessages.length);

  // Detect when a new assistant message arrives and start typewriter
  useEffect(() => {
    const prevCount = prevMsgCountRef.current;
    prevMsgCountRef.current = advisorMessages.length;

    if (advisorMessages.length > prevCount) {
      const newest = advisorMessages[advisorMessages.length - 1];
      if (newest.role === "assistant") {
        setTypingId(newest.id);
        setTypingDone(false);
      }
    }
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
    <div className="flex h-full flex-col gap-3">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-2 sm:px-4 pt-4">
        {advisorMessages.length === 0 && !isLoading && !isRefreshing && (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-base text-white/40">Your advisor is getting ready...</p>
          </div>
        )}

        {isRefreshing && (
          <div className="flex h-full items-center justify-center py-12">
            <p className="animate-pulse text-base text-white/50">Loading new chat...</p>
          </div>
        )}

        {advisorMessages.map((msg) => (
          <ChatBubble key={msg.id} type={msg.role === "user" ? "user" : "ai"}>
            {msg.role === "user" ? (
              <div className="text-base leading-relaxed">{msg.content}</div>
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
          <div className="flex flex-col items-start gap-1.5 pb-1 pt-3 animate-[fadeIn_0.3s_ease-in]">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestionClick(s)}
                className="rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-left text-sm leading-snug text-white/60 backdrop-blur-xl backdrop-saturate-[180%] transition-colors hover:bg-white/[0.12] hover:text-white/80"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {isLoading && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 border-t border-white/10 pb-5 pt-4">
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
          className="flex-1 resize-none overflow-hidden rounded-2xl border border-white/[0.15] bg-white/[0.06] px-4 py-3 text-base text-white backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] placeholder:text-white/40 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/[0.08] disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="rounded-2xl border border-white/[0.15] bg-white/[0.10] px-5 py-3 text-base font-medium text-white backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] transition-colors hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
