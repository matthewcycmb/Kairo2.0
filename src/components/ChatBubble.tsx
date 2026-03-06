interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className={`rounded-2xl ${
          isAi
            ? "w-full max-w-[720px] bg-white/[0.08] text-white backdrop-blur-[40px] border border-white/[0.12] px-4 py-3 sm:px-6 sm:py-4"
            : "max-w-[85%] bg-white/[0.04] text-white backdrop-blur-[40px] border border-white/[0.08] px-4 py-3 sm:px-6 sm:py-4"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
