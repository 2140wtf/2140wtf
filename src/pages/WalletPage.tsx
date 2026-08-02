import { Wallet, RefreshCw, AlertTriangle } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { ArkWalletTab } from '@/components/ArkWalletTab';
import { CashuWalletTab } from '@/components/CashuWalletTab';
import { LightningWalletTab } from '@/components/LightningWalletTab';
import { ComingSoonTab } from '@/components/ComingSoonTab';
import { ResearchBetaAlert } from '@/components/ResearchBetaAlert';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';

export function WalletPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const cashuWallet = useCashuWalletContext();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  useSeoMeta({
    title: `Wallet | ${config.appName}`,
    description: 'Your Cashu wallet and future Lightning layers.',
  });

  return (
    <main>
      <PageHeader title="Wallet" icon={<Wallet className="size-5" />} />

      {!user ? (
        <div className="py-20 px-8 flex flex-col items-center gap-6 text-center">
          <div className="p-4 rounded-full bg-primary/10">
            <Wallet className="size-8 text-primary" />
          </div>
          <div className="space-y-2 max-w-xs">
            <h2 className="text-xl font-bold">Your Wallet</h2>
            <p className="text-muted-foreground text-sm">
              Log in to see your Cashu wallet and future Lightning layers.
            </p>
          </div>
          <LoginArea className="max-w-60" />
        </div>
      ) : (
        <div className="px-4 pt-6 pb-4 max-w-sm mx-auto space-y-4">
          <ResearchBetaAlert />
          <Tabs defaultValue="cashu" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-6">
              <TabsTrigger value="cashu">Cashu</TabsTrigger>
              <TabsTrigger value="lightning">Lightning</TabsTrigger>
              <TabsTrigger value="spark">Spark</TabsTrigger>
              <TabsTrigger value="ark">Ark</TabsTrigger>
            </TabsList>

            <TabsContent value="cashu">
              {cashuWallet.seedLoading ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="size-5 animate-spin" />
                    <p className="font-medium text-foreground">Sign in to wallet</p>
                    <p className="text-xs text-muted-foreground/80 max-w-xs">
                      Your signer may have opened a prompt in the background. Approve it to generate or unlock your Cashu seed.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Retry after signing
                  </Button>
                </div>
              ) : cashuWallet.seedError ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-destructive">{cashuWallet.seedError}</p>

                  <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3 text-left space-y-2 max-w-sm">
                    <p className="text-xs font-semibold">How to resolve this</p>
                    <ol className="list-decimal pl-4 space-y-1.5 text-xs text-muted-foreground">
                      <li>
                        Open your signer app or extension and look for a <span className="font-medium text-foreground">pending approval</span> —
                        the wallet asked to encrypt/decrypt (NIP-44) and is waiting for your OK.
                      </li>
                      <li>
                        If nothing is pending, open the signer's <span className="font-medium text-foreground">connections / permissions</span> for
                        this app (in Amber: Settings → Connections → 2140.wtf) and enable
                        <span className="font-medium text-foreground"> encrypt &amp; decrypt (NIP-44)</span> requests.
                      </li>
                      <li>
                        Come back here and tap <span className="font-medium text-foreground">Retry</span> — your wallet unlocks
                        without changing anything. No funds are touched.
                      </li>
                    </ol>
                    <p className="text-[11px] text-muted-foreground/80">
                        Only use reset if your signer is truly unavailable — see what it wipes first.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                      <RefreshCw className="size-3.5 mr-1.5" />
                      Retry
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setResetConfirmOpen(true)}>
                      Reset &amp; regenerate
                    </Button>
                  </div>

                  <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="size-5 text-destructive" />
                          Are you sure?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2 text-left">
                            <p>
                              Resetting wipes the Cashu seed stored on <span className="font-semibold text-foreground">this device</span> and
                              generates a new one. Any Cashu balance bound to the old seed — including your
                              ₿AO testnet coins and wallet proofs — is <span className="font-semibold text-foreground">erased from this device</span>.
                            </p>
                            <p>
                              Unless you have a backup of your seed phrase (or the balance lives in another
                              wallet/app that holds it), those funds are <span className="font-semibold text-destructive">lost permanently</span>.
                              There is no undo.
                            </p>
                            <p className="text-muted-foreground">
                              Safer first step: unlock your signer and tap <span className="font-medium text-foreground">Retry</span> —
                              most wallet errors are just a signer that hasn't approved the encryption request yet.
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep my wallet</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={cashuWallet.regenerateSeed}
                        >
                          Yes, wipe and regenerate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : !user.signer?.nip44 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Your signer does not support NIP-44, which is required for Cashu backup encryption.
                </div>
              ) : cashuWallet.seedAvailable && cashuWallet.seedPhrase ? (
                <CashuWalletTab />
              ) : (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Cashu wallet could not be initialized.
                  </p>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Try again
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="lightning">
              <LightningWalletTab />
            </TabsContent>

            <TabsContent value="spark">
              <ComingSoonTab title="Spark" description="Lightning-native Spark wallet integration is coming soon." />
            </TabsContent>

            <TabsContent value="ark">
              <ArkWalletTab />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </main>
  );
}
