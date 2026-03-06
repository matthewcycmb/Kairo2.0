interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 sm:px-6 sm:py-4 ${
          isAi
            ? "bg-white/[0.08] text-white backdrop-blur-[40px] border border-white/[0.12]"
            : "bg-white/[0.04] text-white backdrop-blur-[40px] border border-white/[0.08]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
