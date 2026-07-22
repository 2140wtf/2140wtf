import { useSeoMeta } from '@unhead/react';
import { Eye, EyeOff, Info } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { IntroImage } from '@/components/IntroImage';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppContext } from '@/hooks/useAppContext';
import { usePublishPreferences, type PublishFeature } from '@/hooks/usePublishPreferences';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface ToggleRowProps {
  feature: PublishFeature;
  title: string;
  description: string;
  warning?: React.ReactNode;
}

function ToggleRow({ feature, title, description, warning }: ToggleRowProps) {
  const { isEnabled, setEnabled } = usePublishPreferences();
  const enabled = isEnabled(feature);

  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={`publish-${feature}`} className="text-sm font-medium cursor-pointer">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        {enabled && warning && <div className="mt-2">{warning}</div>}
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
    description: 'Control what 2140.wtf publishes to Nostr on your behalf',
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
              Decide what 2140.wtf is allowed to publish to Nostr.
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
              NOSTR PETS
            </CardTitle>
            <CardDescription>
              Pet state and interactions are published to your configured relays.
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
              Events 2140.wtf publishes automatically when you change settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
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

        {/* Content */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Content you create
            </CardTitle>
            <CardDescription>
              Notes, media, articles, polls, and live chat messages.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="notes"
              title="Notes & replies"
              description="Publish text notes, replies, and voice messages (kinds 1, 1222, 1244)."
            />
            <ToggleRow
              feature="photos"
              title="Photos"
              description="Publish picture posts (kind 20)."
            />
            <ToggleRow
              feature="articles"
              title="Articles"
              description="Publish long-form articles (kind 30023)."
            />
            <ToggleRow
              feature="polls"
              title="Polls"
              description="Publish polls and poll votes (kinds 1068, 6969, 1018)."
            />
            <ToggleRow
              feature="liveChat"
              title="Live chat"
              description="Publish live stream chat messages (kind 1311)."
            />
          </CardContent>
        </Card>

        {/* Profile & lists */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Profile & lists
            </CardTitle>
            <CardDescription>
              Metadata about you and the public lists you curate.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="profile"
              title="Profile metadata"
              description="Publish profile info, status, interests, payment targets, and profile tabs (kinds 0, 30315, 10015, 10133, 16769)."
            />
            <ToggleRow
              feature="lists"
              title="User lists"
              description="Publish NIP-51 lists, love lists, and pinned notes (kinds 30000, 10001, 39089)."
            />
            <ToggleRow
              feature="emojiPacks"
              title="Emoji packs"
              description="Publish custom emoji packs and emoji sets (kinds 30030, 10030)."
            />
          </CardContent>
        </Card>

        {/* Marketplace */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Marketplace
            </CardTitle>
            <CardDescription>
              Product listings, shipping options, and sales.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow
              feature="marketplace"
              title="Marketplace listings"
              description="Publish product/art listings, shipping options, and sold updates (kinds 30018, 30017, 30040)."
            />
          </CardContent>
        </Card>

        {/* Badges */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Badges
            </CardTitle>
            <CardDescription>
              Create, award, accept, and manage Nostr badges.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow
              feature="badges"
              title="Badge events"
              description="Publish badge definitions, awards, and accepted badge sets (kinds 30009, 8, 10008)."
            />
          </CardContent>
        </Card>

        {/* Events & messaging */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Events & messaging
            </CardTitle>
            <CardDescription>
              Calendar RSVPs and private messages.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="rsvp"
              title="Calendar RSVPs"
              description="Publish calendar event RSVPs (kind 31925)."
            />
            <ToggleRow
              feature="directMessages"
              title="Direct messages & group chat"
              description="Publish NIP-17 DMs, gift wraps, and group chat messages (kinds 14, 13, 1059, 9)."
            />
          </CardContent>
        </Card>

        {/* Moderation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Moderation
            </CardTitle>
            <CardDescription>
              Reports and deletion requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="reports"
              title="Reports"
              description="Publish moderation reports and Roadstr reports (kinds 1984, 1315)."
            />
            <ToggleRow
              feature="deleteRequests"
              title="Delete requests"
              description="Publish deletion requests for your own events (kind 5)."
            />
          </CardContent>
        </Card>

        {/* Roadstr */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Roadstr
            </CardTitle>
            <CardDescription>
              Roadstr location check-ins.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow
              feature="roadstr"
              title="Roadstr check-ins"
              description="Publish Roadstr check-in events (kind 1316)."
            />
          </CardContent>
        </Card>

        {/* Recovery */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Recovery
            </CardTitle>
            <CardDescription>
              Recovery re-publishes.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow
              feature="recovery"
              title="Recovery re-publish"
              description="Re-publish events from recovery dialogs."
            />
          </CardContent>
        </Card>

        {/* App data */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              App data
            </CardTitle>
            <CardDescription>
              Drafts, encrypted settings, theme definitions, and push subscriptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            <ToggleRow
              feature="drafts"
              title="Drafts"
              description="Publish drafts to relays (kind 31234)."
            />
            <ToggleRow
              feature="encryptedSettings"
              title="Encrypted settings sync"
              description="Publish encrypted app settings and Cashu backups (kind 30078)."
            />
            <ToggleRow
              feature="nutzaps"
              title="Receive Nutzaps"
              description="Publish a public Cashu receiver ad so others can send NIP-61 Nutzaps to you (kind 10019)."
              warning={
                <Alert>
                  <Info className="size-4" />
                  <AlertTitle>Public receiver ad is active</AlertTitle>
                  <AlertDescription>
                    Anyone can see that this account accepts Cashu Nutzaps and which mints and
                    relays you prefer. This is a deliberate metadata leak needed for senders to
                    target you — turn the toggle off to hide the ad again.
                  </AlertDescription>
                </Alert>
              }
            />
            <ToggleRow
              feature="themeDefinitions"
              title="Theme definitions"
              description="Publish custom theme definitions (kind 36767)."
            />
            <ToggleRow
              feature="pushSubscriptions"
              title="Push subscriptions"
              description="Publish push-subscription RPC events (kind 25742)."
            />
          </CardContent>
        </Card>

        {/* Disabled hint */}
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-muted-foreground">
          <EyeOff className="size-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            When a category is turned off, the matching buttons and actions are
            disabled and a tooltip points here. Account-deletion requests (NIP-62)
            are not covered by these toggles.
          </p>
        </div>
      </div>
    </main>
  );
}
