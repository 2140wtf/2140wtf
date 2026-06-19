import { useState } from 'react';
import { Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, description?: string) => Promise<void>;
}

export function CreateGroupDialog({ open, onOpenChange, onCreate }: CreateGroupDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isCreating) return;
    setIsCreating(true);
    try {
      await onCreate(trimmedName, description.trim() || undefined);
      setName('');
      setDescription('');
      onOpenChange(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Users className="size-4 text-primary" />
            </div>
            Create Private Group
          </DialogTitle>
          <DialogDescription>
            Create an encrypted group chat. You will be the first admin and can invite others.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bitcoin Builders"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-description">Description (optional)</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              maxLength={256}
              rows={3}
            />
          </div>
          <Button
            onClick={() => void handleCreate()}
            disabled={isCreating || !name.trim()}
            className="w-full"
          >
            {isCreating ? 'Creating…' : 'Create Group'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
