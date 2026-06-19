import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a message…"
          disabled={disabled || isSending}
          className="min-h-[44px] max-h-32 resize-none"
          rows={1}
        />
        <Button
          size="icon"
          onClick={() => void handleSend()}
          disabled={disabled || isSending || !draft.trim()}
          className="shrink-0"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Encrypted with Group Ratchet. Only members can read these messages.
      </p>
    </div>
  );
}
