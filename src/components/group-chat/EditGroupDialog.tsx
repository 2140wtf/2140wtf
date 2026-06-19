import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
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

interface EditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  initialDescription?: string;
  onSave: (name: string, description?: string) => Promise<void>;
}

export function EditGroupDialog({
  open,
  onOpenChange,
  initialName,
  initialDescription,
  onSave,
}: EditGroupDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription ?? '');
    }
  }, [open, initialName, initialDescription]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSaving) return;

    const trimmedDescription = description.trim();
    const hasChanged =
      trimmedName !== initialName ||
      trimmedDescription !== (initialDescription ?? '').trim();
    if (!hasChanged) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(trimmedName, trimmedDescription || undefined);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Pencil className="size-4 text-primary" />
            </div>
            Edit Group
          </DialogTitle>
          <DialogDescription>
            Update the group name and description. All members will receive the update.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-group-name">Group name</Label>
            <Input
              id="edit-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-group-description">Description (optional)</Label>
            <Textarea
              id="edit-group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              maxLength={256}
              rows={3}
            />
          </div>
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving || !name.trim()}
            className="w-full"
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
