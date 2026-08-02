import { useSeoMeta } from '@unhead/react';
import { ExternalLink, FileText, GitBranch, Scale } from 'lucide-react';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { openUrl } from '@/lib/downloadFile';

const repositoryUrl = 'https://github.com/2140wtf/2140wtf';
const commitSha = /^[0-9a-f]{7,40}$/i.test(import.meta.env.COMMIT_SHA)
  ? import.meta.env.COMMIT_SHA
  : 'main';
const sourceUrl = `${repositoryUrl}/tree/${commitSha}`;
const licenseUrl = `${repositoryUrl}/blob/${commitSha}/LICENSE`;
const noticesUrl = `${repositoryUrl}/blob/${commitSha}/NOTICE`;
const thirdPartyUrl = `${repositoryUrl}/blob/${commitSha}/THIRD_PARTY_NOTICES.md`;

function ExternalButton({ url, children }: { url: string; children: ReactNode }) {
  return (
    <Button variant="outline" className="h-auto min-h-11 justify-between gap-3 whitespace-normal text-left" onClick={() => void openUrl(url)}>
      <span>{children}</span>
      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
    </Button>
  );
}

export function LegalPage() {
  useLayoutOptions({});
  useSeoMeta({
    title: 'Legal & Source | 2140.wtf',
    description: '2140.wtf source code, license, attribution, and warranty information',
  });

  return (
    <main className="min-h-screen pb-16 sidebar:pb-0">
      <PageHeader title="Legal & Source" icon={<Scale className="size-5" />} backTo="/settings" />

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 text-base">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Free software, commercially usable</h1>
          <p className="leading-relaxed text-muted-foreground">
            2140.wtf is licensed under GNU AGPL-3.0-only. You may use, study,
            modify, redistribute, and commercialize it under that license. Users
            of modified network versions must be offered the corresponding source.
          </p>
        </section>

        <section className="grid gap-2" aria-labelledby="source-heading">
          <h2 id="source-heading" className="text-lg font-semibold">Corresponding source</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This build is version {import.meta.env.VERSION} from commit{' '}
            <code className="font-mono text-foreground">{commitSha}</code>.
          </p>
          <ExternalButton url={sourceUrl}><GitBranch className="mr-2 inline size-4" />Source for this build</ExternalButton>
          <ExternalButton url={licenseUrl}><Scale className="mr-2 inline size-4" />GNU AGPL-3.0 license</ExternalButton>
          <ExternalButton url={noticesUrl}><FileText className="mr-2 inline size-4" />Copyright and lineage</ExternalButton>
          <ExternalButton url={thirdPartyUrl}><FileText className="mr-2 inline size-4" />Third-party notices</ExternalButton>
        </section>

        <section className="space-y-2" aria-labelledby="lineage-heading">
          <h2 id="lineage-heading" className="text-lg font-semibold">Lineage</h2>
          <p className="leading-relaxed text-muted-foreground">
            The project began with Shakespeare as Mew, became Ditto, incorporated
            portions of Soapbox Armada, and has since been substantially extended
            by 2140.wtf contributors. Individual authorship remains in Git history.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="warranty-heading">
          <h2 id="warranty-heading" className="text-lg font-semibold">No warranty</h2>
          <p className="leading-relaxed text-muted-foreground">
            The software is provided without warranty, including implied warranties
            of merchantability or fitness for a particular purpose, to the extent
            permitted by law. Research-beta payment features should not be used with
            funds you cannot afford to lose.
          </p>
        </section>
      </div>
    </main>
  );
}
