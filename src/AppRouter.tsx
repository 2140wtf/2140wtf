import { lazy, Suspense, useMemo, useState } from "react";
import { Box, LayoutGrid, LayoutList, Plus, Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AudioNavigationGuard } from "@/components/AudioNavigationGuard";
import { BackButtonHandler } from "@/components/BackButtonHandler";
import { InitialSyncGate } from "@/components/InitialSyncGate";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { HighlightSelectionButton } from "@/components/HighlightSelectionButton";
import { MinimizedAudioBar } from "@/components/MinimizedAudioBar";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { sidebarItemIcon } from "@/lib/sidebarItems";
import { Toaster } from "./components/ui/toaster";
import { MainLayout } from "./components/MainLayout";
import { ScrollToTop } from "./components/ScrollToTop";
import { VersionCheck } from "./components/VersionCheck";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useProfileUrl } from "./hooks/useProfileUrl";
import { getExtraKindDef } from "./lib/extraKinds";
import { PollCubeFeed } from "./components/PollCubeFeed";

// Critical-path pages: eagerly loaded (landing + fallback)
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-loaded compose modal (pulls in emoji-mart ~620K)
const ReplyComposeModal = lazy(() => import("@/components/ReplyComposeModal").then(m => ({ default: m.ReplyComposeModal })));

// Lazy-loaded emoji pack dialog
const EmojiPackDialog = lazy(() => import("@/components/EmojiPackDialog").then(m => ({ default: m.EmojiPackDialog })));

// HomePage eagerly imported all page components; now lazy-loaded
const HomePage = lazy(() => import("./pages/HomePage").then(m => ({ default: m.HomePage })));

// All other pages: code-split via React.lazy
const AdvancedSettingsPage = lazy(() => import("./pages/AdvancedSettingsPage").then(m => ({ default: m.AdvancedSettingsPage })));

const ArchivePage = lazy(() => import("./pages/ArchivePage").then(m => ({ default: m.ArchivePage })));
const ArtFeedPage = lazy(() => import("./pages/ArtFeedPage").then(m => ({ default: m.ArtFeedPage })));
const ArticleEditorPage = lazy(() => import("./pages/ArticleEditorPage").then(m => ({ default: m.ArticleEditorPage })));
const BadgesPage = lazy(() => import("./pages/BadgesPage").then(m => ({ default: m.BadgesPage })));
const BookmarksPage = lazy(() => import("./pages/BookmarksPage").then(m => ({ default: m.BookmarksPage })));
const BooksPage = lazy(() => import("./pages/BooksPage").then(m => ({ default: m.BooksPage })));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage").then(m => ({ default: m.ChangelogPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then(m => ({ default: m.LandingPage })));
const ClientFeedPage = lazy(() => import("./pages/ClientFeedPage").then(m => ({ default: m.ClientFeedPage })));
const ContentPage = lazy(() => import("./pages/ContentPage").then(m => ({ default: m.ContentPage })));
const ContentSettingsPage = lazy(() => import("./pages/ContentSettingsPage").then(m => ({ default: m.ContentSettingsPage })));
const CSAEPolicyPage = lazy(() => import("./pages/CSAEPolicyPage").then(m => ({ default: m.CSAEPolicyPage })));
const DomainFeedPage = lazy(() => import("./pages/DomainFeedPage").then(m => ({ default: m.DomainFeedPage })));
const EventsFeedPage = lazy(() => import("./pages/EventsFeedPage").then(m => ({ default: m.EventsFeedPage })));
const ExternalContentPage = lazy(() => import("./pages/ExternalContentPage").then(m => ({ default: m.ExternalContentPage })));
const GeotagPage = lazy(() => import("./pages/GeotagPage").then(m => ({ default: m.GeotagPage })));
const HashtagPage = lazy(() => import("./pages/HashtagPage").then(m => ({ default: m.HashtagPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then(m => ({ default: m.HelpPage })));
const KindFeedPage = lazy(() => import("./pages/KindFeedPage").then(m => ({ default: m.KindFeedPage })));
const MagicSettingsPage = lazy(() => import("./pages/MagicSettingsPage").then(m => ({ default: m.MagicSettingsPage })));
const MusicPage = lazy(() => import("./pages/MusicPage").then(m => ({ default: m.MusicPage })));
const NetworkSettingsPage = lazy(() => import("./pages/NetworkSettingsPage").then(m => ({ default: m.NetworkSettingsPage })));
const NIP19Page = lazy(() => import("./pages/NIP19Page").then(m => ({ default: m.NIP19Page })));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings").then(m => ({ default: m.NotificationSettings })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const PhotosFeedPage = lazy(() => import("./pages/PhotosFeedPage").then(m => ({ default: m.PhotosFeedPage })));
const PetsPage = lazy(() => import("./pages/PetsPage").then(m => ({ default: m.PetsPage })));
const PetsBattlePage = lazy(() => import("./pages/PetsBattlePage").then(m => ({ default: m.default })));
const PetsSettingsPage = lazy(() => import("./pages/PetsSettingsPage").then(m => ({ default: m.PetsSettingsPage })));
const PodcastsFeedPage = lazy(() => import("./pages/PodcastsFeedPage").then(m => ({ default: m.PodcastsFeedPage })));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage").then(m => ({ default: m.PrivacyPolicyPage })));
const PrivacySettingsPage = lazy(() => import("./pages/PrivacySettingsPage").then(m => ({ default: m.PrivacySettingsPage })));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings").then(m => ({ default: m.ProfileSettings })));
const RelayPage = lazy(() => import("./pages/RelayPage").then(m => ({ default: m.RelayPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then(m => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const SharePage = lazy(() => import("./pages/SharePage").then(m => ({ default: m.SharePage })));
const ThemesPage = lazy(() => import("./pages/ThemesPage").then(m => ({ default: m.ThemesPage })));
const TrendsPage = lazy(() => import("./pages/TrendsPage").then(m => ({ default: m.TrendsPage })));
const UserListsPage = lazy(() => import("./pages/UserListsPage").then(m => ({ default: m.UserListsPage })));
const VideosFeedPage = lazy(() => import("./pages/VideosFeedPage").then(m => ({ default: m.VideosFeedPage })));
const WalletPage = lazy(() => import("./pages/WalletPage").then(m => ({ default: m.WalletPage })));
const WalletSettingsPage = lazy(() => import("./pages/WalletSettingsPage").then(m => ({ default: m.WalletSettingsPage })));
const BtcMapPage = lazy(() => import("./pages/BtcMapPage").then(m => ({ default: m.BtcMapPage })));
const RoadstrPage = lazy(() => import("./pages/RoadstrPage").then(m => ({ default: m.RoadstrPage })));
const MarketPage = lazy(() => import("./pages/MarketPage").then(m => ({ default: m.MarketPage })));
const MessagesPage = lazy(() => import("./pages/MessagesPage").then(m => ({ default: m.MessagesPage })));
const MessageThreadPage = lazy(() => import("./pages/MessageThreadPage").then(m => ({ default: m.MessageThreadPage })));
const PredictionMarketsPage = lazy(() => import("./pages/PredictionMarketsPage").then(m => ({ default: m.PredictionMarketsPage })));
const WebxdcFeedPage = lazy(() => import("./pages/WebxdcFeedPage").then(m => ({ default: m.WebxdcFeedPage })));
const WikipediaPage = lazy(() => import("./pages/WikipediaPage").then(m => ({ default: m.WikipediaPage })));
const FollowPage = lazy(() => import("./pages/FollowPage").then(m => ({ default: m.FollowPage })));
const GroupChatPage = lazy(() => import("./pages/GroupChatPage").then(m => ({ default: m.GroupChatPage })));
const RemoteLoginSuccessPage = lazy(() => import("./pages/RemoteLoginSuccessPage").then(m => ({ default: m.RemoteLoginSuccessPage })));

const pollsDef = getExtraKindDef("polls")!;
const packsDef = getExtraKindDef("packs")!;
const articlesDef = getExtraKindDef("articles")!;
const emojisDef = getExtraKindDef("emojis")!;
const developmentDef = getExtraKindDef("development")!;
const highlightsDef = getExtraKindDef("highlights")!;

/** Polls feed page with a FAB that opens the compose modal (poll mode via + menu). */
function PollsFeedPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [view, setView] = useState<'list' | 'grid' | 'cubes'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [pollFilter, setPollFilter] = useState<'all' | 'zap' | 'regular'>('all');

  const pollKinds = useMemo(() => {
    if (pollFilter === 'zap') return [6969];
    if (pollFilter === 'regular') return [1068];
    return [pollsDef.kind, ...(pollsDef.extraFeedKinds ?? [])];
  }, [pollFilter]);

  const isCubes = view === 'cubes';

  return (
    <>
      <KindFeedPage
        kind={pollKinds}
        title={pollsDef.label}
        icon={sidebarItemIcon("polls", "size-5")}
        grid={view === 'grid'}
        searchQuery={isCubes ? undefined : searchQuery}
        showLoadMoreButton={!isCubes}
        onFabClick={() => setComposeOpen(true)}
        headerActions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ToggleGroup
              type="single"
              value={pollFilter}
              onValueChange={(v) => {
                if (v) setPollFilter(v as 'all' | 'zap' | 'regular');
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="all" aria-label="All polls">All</ToggleGroupItem>
              <ToggleGroupItem value="zap" aria-label="Zap to vote polls">Zap to vote</ToggleGroupItem>
              <ToggleGroupItem value="regular" aria-label="Regular polls">Regular poll</ToggleGroupItem>
            </ToggleGroup>
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search polls…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-32 lg:w-48 pl-8 text-xs rounded-full"
              />
            </div>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => {
                if (v) setView(v as 'list' | 'grid' | 'cubes');
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <LayoutList className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="2-column grid">
                <LayoutGrid className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="cubes" aria-label="Hosted cubes">
                <Box className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" className="rounded-full gap-1.5" onClick={() => setComposeOpen(true)}>
              <Plus className="size-4" />
              Create poll
            </Button>
          </div>
        }
      >
        {isCubes && (
          <PollCubeFeed
            filter={pollFilter}
            searchQuery={searchQuery}
          />
        )}
      </KindFeedPage>
      {composeOpen && (
        <Suspense fallback={null}>
          <ReplyComposeModal open={composeOpen} onOpenChange={setComposeOpen} initialMode="poll" />
        </Suspense>
      )}
    </>
  );
}

/** Emoji feed page with a FAB that opens the emoji pack creation dialog. */
function EmojiFeedPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <>
      <KindFeedPage
        kind={emojisDef.kind}
        title={emojisDef.label}
        icon={sidebarItemIcon("emojis", "size-5")}
        onFabClick={() => setComposeOpen(true)}
      />
      {composeOpen && (
        <Suspense fallback={null}>
          <EmojiPackDialog open={composeOpen} onOpenChange={setComposeOpen} />
        </Suspense>
      )}
    </>
  );
}

/** Redirects /profile to the user's canonical profile URL (nip05 or npub). */
function ProfileRedirect() {
  const { user, metadata } = useCurrentUser();
  const profileUrl = useProfileUrl(user?.pubkey ?? "", metadata);
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={profileUrl} replace />;
}

export function AppRouter() {
  return (
    <AudioPlayerProvider>
      <BrowserRouter>
        <Toaster />
        <VersionCheck />
        <MinimizedAudioBar />
        <AudioNavigationGuard />
        <DeepLinkHandler />
        <BackButtonHandler />
        <ScrollToTop />
        <HighlightSelectionButton />
        <InitialSyncGate>
          <Routes>
            {/* Auto-follow deep link: fullscreen immersive (no sidebars/nav) */}
            <Route path="/follow/:npub" element={<FollowPage />} />

            {/* All routes share the persistent MainLayout (sidebar + nav) */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/feed" element={<Index />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/trends" element={<TrendsPage />} />
              <Route path="/profile" element={<ProfileRedirect />} />
               <Route path="/t/:tag" element={<HashtagPage />} />
               <Route path="/g/:geohash" element={<GeotagPage />} />
              <Route path="/feed/:domain" element={<DomainFeedPage />} />
              <Route path="/client/:name" element={<ClientFeedPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/privacy" element={<PrivacySettingsPage />} />
              <Route path="/settings/profile" element={<ProfileSettings />} />
              <Route path="/settings/pets" element={<PetsSettingsPage />} />
              <Route path="/settings/feed" element={<ContentSettingsPage />} />
              <Route path="/settings/content" element={<ContentPage />} />
              <Route path="/settings/wallet" element={<WalletSettingsPage />} />
              <Route
                path="/settings/notifications"
                element={<NotificationSettings />}
              />
              <Route
                path="/settings/advanced"
                element={<AdvancedSettingsPage />}
              />
              <Route path="/settings/magic" element={<MagicSettingsPage />} />
              <Route path="/settings/network" element={<NetworkSettingsPage />} />
              <Route path="/lists" element={<UserListsPage />} />
              <Route path="/events" element={<EventsFeedPage />} />
              <Route path="/photos" element={<PhotosFeedPage />} />
              <Route path="/videos" element={<VideosFeedPage />} />
              {/* /streams redirects to /videos for backward compatibility */}
              <Route
                path="/streams"
                element={<Navigate to="/videos" replace />}
              />
              <Route path="/music" element={<MusicPage />} />
              <Route path="/podcasts" element={<PodcastsFeedPage />} />
              <Route path="/polls" element={<PollsFeedPage />} />
              <Route
                path="/packs"
                element={
                  <KindFeedPage
                    kind={packsDef.kind}
                    title={packsDef.label}
                    icon={sidebarItemIcon("packs", "size-5")}
                  />
                }
              />
              <Route path="/mini-apps" element={<WebxdcFeedPage />} />
              <Route path="/webxdc" element={<Navigate to="/mini-apps" replace />} />
              <Route path="/art" element={<ArtFeedPage />} />
              <Route path="/articles/new" element={<ArticleEditorPage />} />
              <Route path="/articles/edit/:naddr" element={<ArticleEditorPage />} />
              <Route
                path="/articles"
                element={
                  <KindFeedPage
                    kind={articlesDef.kind}
                    title={articlesDef.label}
                    icon={sidebarItemIcon("articles", "size-5")}
                    fabHref="/articles/new"
                  />
                }
              />
              <Route
                path="/highlights"
                element={
                  <KindFeedPage
                    kind={highlightsDef.kind}
                    title={highlightsDef.label}
                    icon={sidebarItemIcon("highlights", "size-5")}
                    showFAB={false}
                  />
                }
              />
              <Route path="/emojis" element={<EmojiFeedPage />} />
              <Route
                path="/development"
                element={
                  <KindFeedPage
                    kind={[
                      developmentDef.kind,
                      ...(developmentDef.extraFeedKinds ?? []),
                    ]}
                    title={developmentDef.label}
                    icon={sidebarItemIcon("development", "size-5")}
                    showFAB={false}
                  />
                }
              />
              <Route path="/themes" element={<ThemesPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/btcmap" element={<BtcMapPage />} />
              <Route path="/roadstr" element={<RoadstrPage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:npub" element={<MessageThreadPage />} />
              <Route path="/prediction-markets" element={<PredictionMarketsPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/groups" element={<GroupChatPage />} />

              <Route path="/pets" element={<PetsPage />} />
              <Route path="/pets/battle" element={<PetsBattlePage />} />
              <Route path="/badges" element={<BadgesPage />} />
              <Route path="/books" element={<BooksPage />} />
              <Route path="/archive" element={<ArchivePage />} />
              <Route path="/wikipedia" element={<WikipediaPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/safety" element={<CSAEPolicyPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="/about" element={<LandingPage />} />
              <Route path="/r/*" element={<RelayPage />} />
              <Route
                path="/settings/lists"
                element={<Navigate to="/lists" replace />}
              />
              <Route path="/i/*" element={<ExternalContentPage />} />

              {/* Landing route for content shared into 2140.wtf from another app's
                  Share button (Android share targets). */}
              <Route path="/share" element={<SharePage />} />

              {/* Callback target for remote signers (e.g. Amber, Primal) after NIP-46 approval */}
              <Route path="/remoteloginsuccess" element={<RemoteLoginSuccessPage />} />
              {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
              <Route path="/:nip19" element={<NIP19Page />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </InitialSyncGate>
      </BrowserRouter>
    </AudioPlayerProvider>
  );
}
export default AppRouter;
