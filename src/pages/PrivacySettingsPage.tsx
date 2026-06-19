import { useSeoMeta } from '@unhead/react';
import { Eye, EyeOff } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { IntroImage } from '@/components/IntroImage';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppContext } from '@/hooks/useAppContext';
import { usePublishPreferences, type PublishFeature } from '@/hooks/usePublishPreferences';

interface ToggleRowProps {
  feature: PublishFeature;
  title: string;
  description: string;
}

function ToggleRow({ feature, title, description }: ToggleRowProps) {
  const { isEnabled, setEnabled } = usePublishPreferences();
  const enabled = isEnabled(feature);

  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={`publish-${feature}`} className="text-sm font-medium cursor-pointer">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <Switch
        id={`publish-${feature}`}
        checked={enabled}
        onCheckedChange={(checked) => setEnabled(feature, checked)}
        className="shrink-0 mt-0.5"
      />
    </div>
  );
}

export function PrivacySettingsPage() {
  const { config } = useAppContext();

  useSeoMeta({
    title: `Privacy & Publishing | Settings | ${config.appName}`,
    description: 'Control what Ditto publishes to Nostr on your behalf',
  });

  return (
    <main>
      <PageHeader
        backTo="/settings"
        alwaysShowBack
        titleContent={
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">Privacy & Publishing</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Decide what Ditto is allowed to publish to Nostr.
            </p>
          </div>
        }
      />

      <div className="p-4 space-y-6">
        {/* Intro */}
        <div className="flex items-center gap-4 px-3 pt-2 pb-2">
          <IntroImage src="/advanced-intro.png" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Your data, your choice</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Nostr events are public by default. These toggles let you disable
              publishing for whole categories. Disabled features stay local until
              you turn them back on.
            </p>
          </div>
        </div>

        {/* Pets */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              2140 PETS
            </CardTitle>
            <CardDescription>
              Pet state and interactions are already sandboxed to the BAO relay.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow
              feature="pets"
              title="Publish pet events"
              description="Allow adopting, caring for, and battling pets. When off, no pet state or interaction events are published."
            />
          </CardContent>
        </Card>

        {/* Social */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Social actions
            </CardTitle>
            <CardDescription>
              Lightweight interactions on notes and pet pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="reactions"
              title="Reactions"
              description="Publish emoji/heart reactions (kind 7) on notes and comments."
            />
            <ToggleRow
              feature="reposts"
              title="Reposts"
              description="Publish repost and quote-boost events (kinds 6 and 16)."
            />
            <ToggleRow
              feature="comments"
              title="Comments & replies"
              description="Publish comment/reply events (kind 1111) on notes and other content."
            />
            <ToggleRow
              feature="zaps"
              title="Zap receipts"
              description="Publish Lightning and on-chain zap receipts and requests."
            />
          </CardContent>
        </Card>

        {/* Lists */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Lists
            </CardTitle>
            <CardDescription>
              Public lists are stored as replaceable Nostr events.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="follows"
              title="Follow list"
              description="Publish follow/unfollow changes (kind 3)."
            />
            <ToggleRow
              feature="mutes"
              title="Mute list"
              description="Publish mute/unmute changes (kind 10000)."
            />
            <ToggleRow
              feature="bookmarks"
              title="Bookmarks"
              description="Publish bookmark add/remove changes (kind 10003)."
            />
          </CardContent>
        </Card>

        {/* Auto-publish */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Auto-publish
            </CardTitle>
            <CardDescription>
              Events Ditto publishes automatically when you change settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="autoShareTheme"
              title="Share active theme"
              description="Publish your currently selected custom theme as a profile event (kind 16767)."
            />
            <ToggleRow
              feature="publishRelayList"
              title="Publish relay list"
              description="Publish your NIP-65 relay list (kind 10002) when you edit relays."
            />
            <ToggleRow
              feature="publishBlossomList"
              title="Publish Blossom servers"
              description="Publish your Blossom server list (kind 10063) when you edit file servers."
            />
          </CardContent>
        </Card>

        {/* Disabled hint */}
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-muted-foreground">
          <EyeOff className="size-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            When a category is turned off, the matching buttons and actions are
            disabled and a tooltip points here. Profile edits, direct messages,
            and account-deletion requests are not covered by these toggles.
          </p>
        </div>
      </div>
    </main>
  );
}
