import { Wallet, RefreshCw } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { CashuWalletTab } from '@/components/CashuWalletTab';
import { ComingSoonTab } from '@/components/ComingSoonTab';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';

export function WalletPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const cashuWallet = useCashuWalletContext();

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
        <div className="px-4 pt-6 pb-4 max-w-sm mx-auto">
          <Tabs defaultValue="cashu" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="cashu">Cashu</TabsTrigger>
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
                  <p className="text-xs text-muted-foreground max-w-xs">
                    If your signer did not respond, unlock it and try again. You can also reset and create a new seed (this will erase any stored Cashu data for this account).
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                      <RefreshCw className="size-3.5 mr-1.5" />
                      Retry
                    </Button>
                    <Button variant="destructive" size="sm" onClick={cashuWallet.regenerateSeed}>
                      Reset &amp; regenerate
                    </Button>
                  </div>
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

            <TabsContent value="spark">
              <ComingSoonTab title="Spark" description="Lightning-native Spark wallet integration is coming soon." />
            </TabsContent>

            <TabsContent value="ark">
              <ComingSoonTab title="Ark" description="Ark layer-2 wallet support is coming soon." />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </main>
  );
}
