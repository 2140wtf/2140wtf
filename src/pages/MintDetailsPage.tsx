import { Landmark } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MintInfoPanel } from '@/pages/MintDiscoveryPage';
import { useMintDiscovery } from '@/hooks/useMintDiscovery';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';

export function MintDetailsPage() {
  const [params] = useSearchParams();
  const mintUrl = safeNormalizeMintUrl(params.get('url') ?? '');
  const discovery = useMintDiscovery({ global: true });
  const reviews = mintUrl
    ? (discovery.data?.recommendations ?? []).filter((review) => review.mintUrls.includes(mintUrl))
    : [];

  useSeoMeta({ title: 'Cashu Mint Details | 2140.wtf' });

  return (
    <main className="pb-12">
      <PageHeader title="Mint details" icon={<Landmark className="size-5" />} backTo="/mints" />
      <div className="mx-auto max-w-2xl px-4 py-6">
        {mintUrl ? (
          <Card>
            <CardHeader>
              <CardTitle className="break-all text-lg">{mintUrl}</CardTitle>
            </CardHeader>
            <CardContent>
              <MintInfoPanel url={mintUrl} />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center text-muted-foreground">
              This mint URL is invalid or unsafe.
            </CardContent>
          </Card>
        )}
        {mintUrl && reviews.length > 0 && (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-lg">Community reviews</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {reviews.map((review) => (
                <article key={review.event.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{review.event.pubkey.slice(0, 12)}…</span>
                    <span>{review.rating ? `${review.rating}/5` : 'Recommended'}</span>
                  </div>
                  {review.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{review.content}</p>}
                </article>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
