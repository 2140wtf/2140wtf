import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface GroupMessageInputProps {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
}

export function GroupMessageInput({ disabled, onSend }: GroupMessageInputProps) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending || disabled) return;
    setIsSending(true);
    try {
      await onSend(trimmed);
      setDraft('');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-3 border-t bg-background">
      <div className="flex items-end gap-2 rounded-2xl border bg-muted/40 px-3 py-2 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-shadow">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a message…"
          disabled={disabled || isSending}
          className={cn(
            'min-h-[40px] max-h-32 resize-none flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          rows={1}
        />
        <Button
          size="icon"
          onClick={() => void handleSend()}
          disabled={disabled || isSending || !draft.trim()}
          className="size-9 shrink-0 rounded-xl"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 text-center sm:text-left">
        Encrypted with Group Ratchet. Only members can read these messages.
      </p>
    </div>
  );
}
