import { useState, useEffect, useRef } from "react";
import type { AdvisorMessage } from "../types/profile";
import ChatBubble from "./ChatBubble";
import LoadingSpinner from "./LoadingSpinner";
import AdvisorAnalysisCard from "./AdvisorAnalysisCard";

interface AdvisorChatProps {
  advisorMessages: AdvisorMessage[];
  onNewMessage: (text: string) => void;
  isLoading: boolean;
}

export default function AdvisorChat({
  advisorMessages,
  onNewMessage,
  isLoading,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.15] bg-white/[0.08] p-4 backdrop-blur-[40px]">
        {advisorMessages.length === 0 && !isLoading && (
          <div className="flex h-full items-center justify-center py-12">
            <p className="text-sm text-white/40">Your advisor is getting ready...</p>
          </div>
        )}

        {advisorMessages.map((msg) =>
          msg.analysis ? (
            <AdvisorAnalysisCard key={msg.id} analysis={msg.analysis} />
          ) : (
            <ChatBubble key={msg.id} type={msg.role === "user" ? "user" : "ai"}>
              <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
            </ChatBubble>
          )
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
          className="flex-1 rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="rounded-xl border border-white/[0.15] bg-white/[0.15] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
