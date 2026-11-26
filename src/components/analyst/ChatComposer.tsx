import { ArrowUp } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

interface ChatComposerProps {
  onSend: (message: string) => Promise<void> | void;
  disabled?: boolean;
  sending?: boolean;
  initialDraft?: string | null;
  placeholder?: string;
  compact?: boolean;
}

export function ChatComposer({
  onSend,
  disabled = false,
  sending = false,
  initialDraft,
  placeholder = 'Ask about funnel leaks, metrics, D-010 strategy, or propose a follow-up task...',
  compact = false,
}: ChatComposerProps) {
  const [draft, setDraft] = useState(initialDraft ?? '');

  useEffect(() => {
    if (initialDraft && initialDraft.trim()) {
      setDraft(initialDraft);
    }
  }, [initialDraft]);

  const canSubmit = draft.trim().length > 0 && !disabled && !sending;

  const submit = async () => {
    if (!canSubmit) return;
    const text = draft.trim();
    setDraft('');
    await onSend(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-md border border-[#D9D7D0] bg-white p-2.5 focus-within:border-[#315F52]"
    >
      <div className="flex items-end gap-2">
        <textarea
          rows={compact ? 2 : 3}
          value={draft}
          disabled={disabled || sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Growth Analyst question"
          className="max-h-36 min-h-[44px] w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-[#202824] placeholder:text-[#788C83] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Send message"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#264B40] disabled:cursor-not-allowed disabled:bg-[#E8E6E0] disabled:text-[#788C83]"
        >
          <span>{sending ? 'Sending...' : 'Send'}</span>
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {!compact ? (
        <p className="mt-1.5 px-1.5 text-[11px] text-[#788C83]">
          Enter to send · Shift+Enter for a new line
        </p>
      ) : null}
    </form>
  );
}
