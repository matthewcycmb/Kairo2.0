interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  if (isAi) {
    // AI messages: no bubble, text flows directly — generous bottom margin for rhythm
    return (
      <div className="mb-10">
        {children}
      </div>
    );
  }

  // User messages: subtle, right-aligned
  return (
    <div className="flex justify-end mb-10">
      <div className="max-w-[85%] rounded-2xl bg-white/[0.10] text-white/80 px-5 py-3.5">
        {children}
      </div>
    </div>
  );
}
