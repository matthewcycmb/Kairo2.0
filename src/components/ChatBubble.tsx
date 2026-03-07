interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className={`rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.08)] ${
          isAi
            ? "w-full max-w-[720px] bg-white/[0.07] text-white backdrop-blur-2xl backdrop-saturate-[180%] border border-white/[0.15] px-4 py-3 sm:px-6 sm:py-4"
            : "max-w-[85%] bg-white/[0.05] text-white backdrop-blur-2xl backdrop-saturate-[180%] border border-white/[0.10] px-4 py-3 sm:px-6 sm:py-4"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
