import { useState, useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import type { AdvisorMessage, ActionItem } from "../types/profile";
import ReactMarkdown from "react-markdown";
import ChatBubble from "./ChatBubble";
import LoadingSpinner from "./LoadingSpinner";

/** Ensure message content is always a clean displayable string */
function sanitizeContent(content: unknown): string {
  if (typeof content === "string") {
    // If it looks like a raw JSON object, try to extract the message field
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.message === "string") return parsed.message;
      } catch {
        // Not valid JSON, return as-is
      }
    }
    return content;
  }
  // If content is an object (e.g. loaded from storage incorrectly)
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    // Last resort: stringify it cleanly
    return JSON.stringify(content);
  }
  return String(content ?? "");
}

interface AdvisorChatProps {
  advisorMessages: AdvisorMessage[];
  onNewMessage: (text: string) => void;
  isLoading: boolean;
  actionItems: ActionItem[];
  onToggleActionItem: (id: string) => void;
}

export default function AdvisorChat({
  advisorMessages,
  onNewMessage,
  isLoading,
  actionItems,
  onToggleActionItem,
}: AdvisorChatProps) {
  const [input, setInput] = useState("");
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [advisorMessages, isLoading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
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

  // Get suggestions from the last assistant message
  const lastAssistantMsg = [...advisorMessages].reverse().find((m) => m.role === "assistant");
  const suggestions = !isLoading && lastAssistantMsg?.suggestions?.length
    ? lastAssistantMsg.suggestions
    : [];

  const activeItems = actionItems.filter((i) => i.status === "pending");

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Pinned action items */}
      {activeItems.length > 0 && (
        <div className="rounded-2xl border border-white/[0.15] bg-white/[0.07] p-4 backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] sm:p-6">
          <div className="mb-3 flex items-center gap-2 border-l-[3px] border-blue-400 pl-3">
            <span className="text-lg font-bold text-white/90">
              Your Action Items
            </span>
            <span className="text-sm text-white/30">
              {activeItems.length}/2
            </span>
          </div>
          <div className="space-y-2.5">
            {activeItems.map((item) => (
              <label
                key={item.id}
                className="group flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-white/[0.05]"
              >
                <input
                  type="checkbox"
                  checked={item.status === "completed"}
                  onChange={() => onToggleActionItem(item.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-white/20 bg-white/[0.05] checked:border-blue-400 checked:bg-blue-400"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base leading-snug text-white/80">
                    {item.action}
                  </p>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onNewMessage(`Draft me a ready-to-copy message for this: "${item.action}". Put it in a code block.`);
                    }}
                    className="mt-0.5 text-xs text-white/30 underline decoration-white/15 transition-colors hover:text-white/50"
                  >
                    Draft this for me
                  </button>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.15] bg-white/[0.07] p-4 backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] sm:p-6">
        {advisorMessages.length === 0 && !isLoading && (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-base text-white/40">Your advisor is getting ready...</p>
          </div>
        )}

        {advisorMessages.map((msg) => (
          <ChatBubble key={msg.id} type={msg.role === "user" ? "user" : "ai"}>
            {msg.role === "user" ? (
              <div className="text-base leading-relaxed">{msg.content}</div>
            ) : (
              <div className="advisor-markdown text-base leading-[1.6]">
                <ReactMarkdown components={markdownComponents}>{sanitizeContent(msg.content)}</ReactMarkdown>
              </div>
            )}
          </ChatBubble>
        ))}

        {/* Suggestion chips */}
        {suggestions.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 pb-1 pt-3">
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

        {isLoading && <LoadingSpinner message="Kairo is thinking..." />}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 border-t border-white/10 pb-5 pt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your advisor anything..."
          disabled={isLoading}
          className="flex-1 rounded-2xl border border-white/[0.15] bg-white/[0.06] px-4 py-3 text-base text-white backdrop-blur-2xl backdrop-saturate-[180%] shadow-[0_2px_20px_rgba(0,0,0,0.08)] placeholder:text-white/40 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/[0.08] disabled:opacity-50"
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
