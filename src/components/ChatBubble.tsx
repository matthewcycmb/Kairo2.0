interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  if (isAi) {
    // AI messages: no bubble, just text flowing directly
    return (
      <div className="mb-6 text-white/90">
        {children}
      </div>
    );
  }

  // User messages: subtle, right-aligned, minimal styling
  return (
    <div className="flex justify-end mb-6">
      <div className="max-w-[85%] rounded-2xl bg-white/[0.08] text-white/80 px-4 py-3">
        {children}
      </div>
    </div>
  );
}
