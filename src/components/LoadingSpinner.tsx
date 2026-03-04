interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message = "Thinking..." }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}
