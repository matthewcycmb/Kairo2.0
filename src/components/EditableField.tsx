import { useState } from "react";

interface EditableFieldProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  as?: "span" | "p" | "h3";
}

export default function EditableField({
  value,
  onSave,
  className = "",
  as: Tag = "span",
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    setIsEditing(false);
    if (draft.trim() !== value) {
      onSave(draft.trim());
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setDraft(value);
            setIsEditing(false);
          }
        }}
        className={`border-b-2 border-blue-400 bg-transparent outline-none ${className}`}
        autoFocus
      />
    );
  }

  return (
    <Tag
      onClick={() => {
        setIsEditing(true);
        setDraft(value);
      }}
      className={`cursor-pointer rounded px-1 hover:bg-white/10 ${className}`}
      title="Click to edit"
    >
      {value}
    </Tag>
  );
}
