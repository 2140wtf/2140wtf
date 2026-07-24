import { Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { BaoMark } from "@/components/brand/BaoMark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { registerConsentPromptOpener, resolveConsentPrompt, setDecryptConsent } from "@/lib/decryptConsent";

/**
 * The one-time bulk-decrypt consent prompt (see `@/lib/decryptConsent`).
 *
 * Mounted once, app-wide. It registers the prompt opener the gate calls the
 * first time any surface needs a real (uncached) decrypt, and surfaces a single
 * dialog no matter how many surfaces raced to that point. Answering it persists
 * the choice globally; declining leaves messages as encrypted placeholders with
 * manual "Decrypt" / "Decrypt all" controls, so the signer is never poked until
 * the user asks.
 */
export function DecryptConsentDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => registerConsentPromptOpener(() => setOpen(true)), []);

  const allow = () => {
    setDecryptConsent("allowed");
    setOpen(false);
  };

  const decline = () => {
    setDecryptConsent("declined");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissing without a button (Esc / backdrop) counts as "not now":
        // resolve the pending prompt as declined WITHOUT persisting, so the
        // user is asked again next time rather than silently locked out.
        if (!next) {
          resolveConsentPrompt("declined");
          setOpen(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <BaoMark size={72} />
            <div className="space-y-1">
              <DialogTitle className="text-lg font-bold tracking-tight text-foreground">
                Decrypt your messages
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Your messages and invites are end-to-end encrypted. ₿AO needs your signer to
                unlock them. With a browser extension or remote signer, that can mean an approval
                for each one.
              </p>
            </div>
          </div>

          <div className="w-full rounded-lg border border-border bg-secondary/40 p-4">
            <div className="flex items-center gap-2 font-medium">
              <Lock className="size-4 shrink-0 text-muted-foreground" />
              <span>One decision, remembered</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Allow decryption and ₿AO handles it quietly from here on. Decline and your messages
              stay locked until you tap <strong>Decrypt</strong> on a message or{" "}
              <strong>Decrypt all</strong> at the top of a conversation.
            </p>
          </div>

          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={decline}>
              Not now
            </Button>
            <Button onClick={allow}>
              Decrypt
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
