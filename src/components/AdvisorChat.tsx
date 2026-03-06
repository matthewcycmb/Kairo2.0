import { useState, useEffect, useRef } from "react";
import type { AdvisorMessage, ActionItem } from "../types/profile";
import ChatBubble from "./ChatBubble";
import LoadingSpinner from "./LoadingSpinner";
import AdvisorAnalysisCard from "./AdvisorAnalysisCard";

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

  // Get suggestions from the last assistant message
  const lastAssistantMsg = [...advisorMessages].reverse().find((m) => m.role === "assistant");
  const suggestions = !isLoading && lastAssistantMsg?.suggestions?.length
    ? lastAssistantMsg.suggestions
    : [];

  const activeItems = actionItems.filter((i) => i.status === "pending");

  return (
    <div className="flex h-full flex-col">
      {/* Pinned action items */}
      {activeItems.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px] sm:p-6">
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
                  <p className="mt-0.5 text-sm text-white/35">
                    {item.gap}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px] sm:p-6">
        {advisorMessages.length === 0 && !isLoading && (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-base text-white/40">Your advisor is getting ready...</p>
          </div>
        )}

        {advisorMessages.map((msg) =>
          msg.analysis ? (
            <AdvisorAnalysisCard key={msg.id} analysis={msg.analysis} />
          ) : (
            <ChatBubble key={msg.id} type={msg.role === "user" ? "user" : "ai"}>
              <div className="whitespace-pre-wrap text-base leading-relaxed">{msg.content}</div>
            </ChatBubble>
          )
        )}

        {/* Suggestion chips */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1 pt-3">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestionClick(s)}
                className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white/80"
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
      <div className="flex gap-2 border-t border-white/10 pt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your advisor anything..."
          disabled={isLoading}
          className="flex-1 rounded-xl border border-white/[0.15] bg-white/[0.08] px-4 py-3 text-base text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="rounded-xl border border-white/10 bg-white/[0.15] px-5 py-3 text-base font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
