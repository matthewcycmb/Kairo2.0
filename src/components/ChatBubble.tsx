interface ChatBubbleProps {
  type: "ai" | "user";
  children: React.ReactNode;
}

export default function ChatBubble({ type, children }: ChatBubbleProps) {
  const isAi = type === "ai";

  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isAi
            ? "bg-white text-gray-800 shadow-sm border border-gray-100"
            : "bg-blue-500 text-white"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
