import type { NostrEvent, NostrMetadata } from "@nostrify/nostrify";
import { useNostr } from "@nostrify/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Users,
} from "lucide-react";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { saveNsec } from "@/lib/credentialManager";
import { openUrl } from "@/lib/downloadFile";
import { fetchFreshEvent } from "@/lib/fetchFreshEvent";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppLogo } from "@/components/AppLogo";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { IntroImage } from "@/components/IntroImage";
import { ProfileCard } from "@/components/ProfileCard";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "@/hooks/useAppContext";
import { useAuthors } from "@/hooks/useAuthors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEncryptedSettings, getLocalSettingsSync } from "@/hooks/useEncryptedSettings";
import { type SyncPhase, useInitialSync } from "@/hooks/useInitialSync";
import { useLoginActions } from "@/hooks/useLoginActions";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { usePublishPreferences } from "@/hooks/usePublishPreferences";
import { useNostrStorage } from "@/hooks/useNostrStorage";
import { OnboardingContext } from "@/hooks/useOnboarding";

import { toast } from "@/hooks/useToast";
import { useUploadFile } from "@/hooks/useUploadFile";
import { getAvatarShape, isValidAvatarShape } from "@/lib/avatarShape";
import { fetchContactList, hasMinimumFollows } from "@/lib/contactList";
import { parseAuthorEvent, useAuthor } from "@/hooks/useAuthor";

import { cn } from "@/lib/utils";
import { sanitizeUrl } from "@/lib/sanitizeUrl";
import { genUserName } from "@/lib/genUserName";

// ---------------------------------------------------------------------------
// InitialSyncGate
// ---------------------------------------------------------------------------

interface InitialSyncGateProps {
  children: ReactNode;
}

/**
 * Gates the main app behind an initial sync / setup flow for logged-in users.
 * - Logged-out users pass straight through.
 * - Logged-in users see a sync spinner, then either proceed (settings found)
 *   or walk through a brief questionnaire (fresh account / new device with no settings).
 * - Also provides `useOnboarding().startSignup()` for triggering signup from anywhere.
 */
export function InitialSyncGate({ children }: InitialSyncGateProps) {
  const { user } = useCurrentUser();
  const { phase, markComplete } = useInitialSync();
  const { isLoading: settingsLoading } = useEncryptedSettings();
  const { config } = useAppContext();
  const [preloadApp, setPreloadApp] = useState(false);
  const [signupActive, setSignupActive] = useState(false);
  // Track whether we've shown the app at least once so we don't re-gate on
  // subsequent background refetches (e.g. window focus).
  const hasShownApp = useRef(false);

  const startSignup = useCallback(() => setSignupActive(true), []);

  const handleSignupComplete = useCallback(() => {
    setSignupActive(false);
    markComplete();
  }, [markComplete]);

  const contextValue = useMemo(() => ({ startSignup }), [startSignup]);

  // Signup flow takes priority (doesn't require a logged-in user yet)
  if (signupActive) {
    return (
      <OnboardingContext.Provider value={contextValue}>
        {preloadApp && <div className="invisible">{children}</div>}
        <SetupQuestionnaire
          onComplete={handleSignupComplete}
          onPreload={() => setPreloadApp(true)}
          isSignup
        />
      </OnboardingContext.Provider>
    );
  }

  // Don't show sync/onboarding when logged out — just show the app.
  // Reset hasShownApp so that re-login shows the spinner until settings load.
  if (!user) {
    hasShownApp.current = false;
    return (
      <OnboardingContext.Provider value={contextValue}>
        {children}
      </OnboardingContext.Provider>
    );
  }

  // Normal logged-in sync flow
  if (phase === "syncing" || phase === "found") {
    return (
      <OnboardingContext.Provider value={contextValue}>
        <SyncScreen phase={phase} onSkip={phase === "syncing" ? markComplete : undefined} />
      </OnboardingContext.Provider>
    );
  }

  if (phase === "not-found") {
    return (
      <OnboardingContext.Provider value={contextValue}>
        {preloadApp && <div className="invisible">{children}</div>}
        <SetupQuestionnaire
          onComplete={markComplete}
          onPreload={() => setPreloadApp(true)}
        />
      </OnboardingContext.Provider>
    );
  }

  // For returning users (phase === "complete"), decide whether to gate:
  // - If we have a local lastSync timestamp, localStorage is trustworthy and
  //   we can render immediately. NostrSync will hot-swap any differences in
  //   the background once the remote settings arrive.
  // - If there's NO local timestamp (e.g. localStorage was cleared, or settings
  //   were never synced on this browser), show the spinner until settings load
  //   so the user sees correct state from the start.
  // Only gate on the very first load — once the app has been shown, don't
  // re-gate on background refetches (e.g. window focus).
  if (phase === "complete" && settingsLoading && !hasShownApp.current) {
    const hasLocalSync = user ? getLocalSettingsSync(config.appId, user.pubkey) > 0 : false;
    if (!hasLocalSync) {
      return (
        <OnboardingContext.Provider value={contextValue}>
          <SyncScreen phase="syncing" />
        </OnboardingContext.Provider>
      );
    }
  }

  hasShownApp.current = true;

  // idle or complete -> show app
  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
    </OnboardingContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Sync Screen
// ---------------------------------------------------------------------------

function SyncScreen({ phase, onSkip }: { phase: SyncPhase; onSkip?: () => void }) {
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    if (phase !== "syncing") {
      setShowSkip(false);
      return;
    }
    const id = setTimeout(() => setShowSkip(true), 6000);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 px-6 text-center max-w-sm">
        {/* Logo with gentle pulse */}
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping opacity-30" />
          <AppLogo size={72} className="relative" />
        </div>

        {/* Spinner */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-[2.5px] border-primary/20" />
            <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-t-primary animate-spin" />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {phase === "found"
                ? "Settings restored"
                : "Syncing your settings..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {phase === "found"
                ? "Welcome back! Loading your experience..."
                : "Checking for your preferences across devices"}
            </p>
          </div>
        </div>

        {phase === "syncing" && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
            {showSkip && onSkip && (
              <Button variant="outline" size="sm" className="rounded-none" onClick={onSkip}>
                Continue without syncing
              </Button>
            )}
          </div>
        )}

        {phase === "found" && (
          <div className="flex items-center gap-2 text-primary">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">All set</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Questionnaire
// ---------------------------------------------------------------------------

const PRIMAL_PACK_AUTHOR = "532d830dffe09c13e75e8b145c825718fc12b0003f61d61e9077721c7fff93cb";
const MINIMUM_FOLLOWS = 5;
const FEATURED_CREATORS = [
  { pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", label: "fiatjaf", role: "Creator of Nostr" },
  { pubkey: "fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416", label: "2140.wtf", role: "2140.wtf" },
  { pubkey: "606f05b0696f8d561a5470ead20d74b08ecd6243a6907acdc450a4849c9c0bc6", label: "₿AO HQ", role: "₿AO network" },
] as const;
const NEWS_SOURCES = [
  { pubkey: "11ef05a432dc240409bc6116b6fdc93f5e290ad757b6578302a2bb44a85e5649", label: "Hacker News" },
  { pubkey: "7e7224cfe0af5aaf9131af8f3e9d34ff615ff91ce2694640f1f1fee5d8febb7d", label: "Bitcoin Herald" },
  { pubkey: "59fbee7369df7713dbbfa9bbdb0892c62eba929232615c6ff2787da384cb770f", label: "Bitcoin Magazine" },
  { pubkey: "347447120a7a81123f131acfd91708dd2b85aca0e6a18647c6caa95914e45736", label: "CoinDesk" },
  { pubkey: "ecd4264b5dd03da823606f807370722bd66adc5943760428a09561fe58c5411d", label: "Cointelegraph" },
] as const;
const ACTIVE_SUGGESTION_CANDIDATES = [
  "19fefd7f39c96d2ff76f87f7627ae79145bc971d8ab23205005939a5a913bc2f",
  "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9",
  "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2",
  "58c741aa630c2da35a56a77c1d05381908bd10504fdd2d8b43f725efa6d23196",
  "472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e",
  "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
  "d61f3bc5b3eb4400efdae6169a5c17cabf3246b514361de939ce4a1a0da6ef4a",
  "63fe6318dc58583cfe16810f86dd09e18bfd76aabc24a0081ce2856f330504ed",
  "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c",
  "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194",
] as const;

/** App-owned starter packs. Subject packs are additionally loaded from Primal. */
const SUGGESTED_PACKS: NostrEvent[] = [{
  id: "2140-essentials",
  pubkey: "",
  kind: 39089,
  created_at: 0,
  content: "",
  sig: "",
  tags: [
    ["title", "2140 Essentials"],
    ["description", "A small Bitcoin and Nostr starting point. Selected by default."],
    ["p", "fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416"],
    ["p", "606f05b0696f8d561a5470ead20d74b08ecd6243a6907acdc450a4849c9c0bc6"],
    ["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"],
    ["p", "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c"],
    ["p", "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2"],
  ],
}];

// Steps for signup (includes keygen + profile) vs. settings-only (existing login)
type SignupStep = "keygen" | "download" | "profile";
type SettingsStep = "follows" | "privacy" | "outro";
type Step = SignupStep | SettingsStep;

const SIGNUP_STEPS: Step[] = [
  "keygen",
  "download",
  "profile",
  "follows",
  "privacy",
  "outro",
];
const SETTINGS_STEPS: Step[] = ["follows", "privacy", "outro"];

function SetupQuestionnaire({
  onComplete,
  onPreload,
  isSignup = false,
}: {
  onComplete: () => void;
  onPreload: () => void;
  isSignup?: boolean;
}) {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const login = useLoginActions();

  const steps = isSignup ? SIGNUP_STEPS : SETTINGS_STEPS;

  const [step, setStep] = useState<Step>(steps[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasFollows, setHasFollows] = useState<boolean | null>(null);

  // Signup-specific state
  const [nsec, setNsec] = useState("");

  // Derived pubkey for the just-generated nsec. Used as a defensive guard at
  // every signup publish site to ensure we sign with the *new* account, not a
  // previously logged-in one. Without this, a regression in useLoginActions's
  // auto-switch (or any future re-ordering of logins) could overwrite the
  // previous user's kind 0 metadata / kind 3 follow list during onboarding.
  const expectedPubkey = useMemo(() => {
    if (!nsec) return undefined;
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== "nsec") return undefined;
      return getPublicKey(decoded.data);
    } catch {
      return undefined;
    }
  }, [nsec]);

  const stepIndex = steps.indexOf(step);
  const progress = (stepIndex / (steps.length - 1)) * 100;

  const goTo = useCallback((target: Step) => setStep(target), []);

  const next = useCallback(() => {
    const i = steps.indexOf(step);
    if (i < steps.length - 1) {
      setStep(steps[i + 1]);
    }
  }, [step, steps]);

  const back = useCallback(() => {
    const i = steps.indexOf(step);
    if (i > 0) {
      setStep(steps[i - 1]);
    }
  }, [step, steps]);

  // Keygen handler — generates the key and advances to the save step.
  // The credential manager prompt is deferred until the user clicks "Continue".
  const handleGenerate = useCallback(() => {
    const sk = generateSecretKey();
    const encoded = nip19.nsecEncode(sk);
    setNsec(encoded);
    next();
  }, [next]);

  // Continue handler for the download step — saves the key via the best
  // available method (native credential manager on iOS/Android, file download
  // on web), logs in, and advances to the next step.
  //
  // If the user dismisses the iOS credential prompt, `saveNsec` resolves to
  // `'dismissed'` and we still advance — dismissal is a legitimate choice
  // (e.g. the user is saving the key in their own password manager).
  //
  // On Android, if no credential provider is available (e.g. GrapheneOS or
  // other de-Googled devices), `saveNsec` falls back to writing the key to
  // the app's Documents folder and returns `'saved-to-file'`. We surface a
  // toast so the user knows where to find the backup file.
  //
  // Only unexpected errors (decode failure, filesystem write failure)
  // surface as a destructive toast.
  const handleDownloadContinue = useCallback(async () => {
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== "nsec") throw new Error("Invalid nsec");

      const pubkey = getPublicKey(decoded.data);
      const npub = nip19.npubEncode(pubkey);

      const result = await saveNsec(npub, nsec, config.appName);

      if (result === "saved-to-file") {
        toast({
          title: "Secret key saved",
          description:
            "Your secret key was saved to the Documents folder on your device.",
        });
      }

      login.nsec(nsec);
      next();
    } catch {
      toast({
        title: "Save failed",
        description:
          "Could not save the key. Please copy it manually.",
        variant: "destructive",
      });
    }
  }, [nsec, login, next, config.appName]);

  // Check for existing follows and transition to the follows step (or outro if they have follows).
  //
  // Historically this callback also wrote a hardcoded `feedSettings` block + `contentWarningPolicy`
  // to both local config and encrypted relay settings. That block was the save handler for a
  // questionnaire that has since been removed, so it was overwriting settings with a stale
  // curated preset — clobbering the app-wide defaults in `App.tsx` (especially on the
  // `phase === 'not-found'` path, where a returning user on a new device could lose their
  // tuned feed settings if the encrypted-settings fetch returned empty). Defaults live in
  // `App.tsx`'s `defaultConfig` and cross-device sync handles the rest.
  const handleSaveAndContinue = useCallback(async () => {
    setIsSaving(true);

    // A useful default feed needs at least five follows. A relay timeout is
    // not evidence that the user already follows anyone, so use the shared
    // relay + IndexedDB fallback and keep uncertain/new users in this step.
    let userHasFollows = false;
    if (user) {
      try {
        const event = await fetchContactList(nostr, store, user.pubkey, { timeout: 5000 });
        userHasFollows = hasMinimumFollows(event, MINIMUM_FOLLOWS);
      } catch {
        userHasFollows = false;
      }
    }

    setHasFollows(userHasFollows);
    setIsSaving(false);

    if (userHasFollows) {
      goTo("privacy");
    } else {
      goTo("follows");
    }
  }, [user, nostr, store, goTo]);

  // Settings-only flow: the theme step is skipped, so run the follow-list check
  // immediately and route to follows/outro accordingly.
  useEffect(() => {
    if (!isSignup && step === "follows" && hasFollows === null) {
      handleSaveAndContinue();
    }
  }, [isSignup, step, hasFollows, handleSaveAndContinue]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className={cn(
          "w-full mx-auto my-auto px-4 py-8 sm:px-6 sm:py-12",
          step === "follows" ? "max-w-5xl" : "max-w-md",
        )}>
          {/* Signup steps */}
          {step === "keygen" && <KeygenStep onGenerate={handleGenerate} />}

          {step === "download" && (
            <DownloadStep nsec={nsec} onContinue={handleDownloadContinue} />
          )}

          {step === "profile" && (
            <ProfileStep
              onNext={handleSaveAndContinue}
              isSaving={isSaving}
              expectedPubkey={expectedPubkey}
            />
          )}

          {/* Settings steps */}
          {step === "follows" && hasFollows === false && (
            <FollowsStep
              onNext={(didFollow) => {
                if (didFollow) onPreload();
                goTo("privacy");
              }}
              onBack={back}
              expectedPubkey={expectedPubkey}
            />
          )}

          {step === "privacy" && (
            <PrivacyNoticeStep
              onNext={() => goTo("outro")}
              onOpenSettings={() => {
                onComplete();
              }}
            />
          )}

          {step === "outro" && <OutroStep onComplete={onComplete} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signup steps: Keygen, Download, Profile
// ---------------------------------------------------------------------------

function KeygenStep({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AppLogo size={80} />

      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Create your account
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
          Your identity on Nostr is a cryptographic key. We'll generate one
          for you now.
        </p>
      </div>

      <Button
        size="lg"
        className="w-full max-w-xs gap-2 rounded-full h-12"
        onClick={onGenerate}
      >
        Generate my key
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

function DownloadStep({
  nsec,
  onContinue,
}: {
  nsec: string;
  onContinue: () => Promise<void> | void;
}) {
  const { config } = useAppContext();
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Wrap the continue handler in an in-flight guard so rapid double-taps
  // don't trigger multiple credential prompts. `finally` guarantees the
  // button is re-enabled even if the handler throws, so users can never
  // get stuck on a disabled button.
  const handleClick = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onContinue();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-400">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Your secret key
        </h2>
        <p className="text-sm text-muted-foreground">
          This secret key controls your account on {config.appName}. You'll need it to log in later. Without it, you'll lose your account.
        </p>
      </div>

      <div className="relative">
        <Input
          type={showKey ? "text" : "password"}
          value={nsec}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="pr-10 font-mono text-base md:text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
          onClick={() => setShowKey(!showKey)}
        >
          {showKey ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>

      {showKey && (
        <div className="rounded-lg border border-amber-500/50 bg-card p-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-xs text-foreground">
            NEVER share your secret key with anyone. Avoid screenshotting your key or pasting it anywhere except a password manager. If shared, others will be able to access your account.{" "}
            <a
              href="https://soapbox.pub/blog/managing-nostr-keys/"
              onClick={(e) => {
                e.preventDefault();
                openUrl("https://soapbox.pub/blog/managing-nostr-keys/");
              }}
              className="underline underline-offset-2 hover:no-underline"
            >
              Learn more
            </a>
          </p>
        </div>
      )}

      <Button
        size="lg"
        className="w-full gap-2 rounded-full h-12"
        onClick={handleClick}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Download className="w-4 h-4" /> Save Key
          </>
        )}
      </Button>
    </div>
  );
}

function ProfileStep({
  onNext,
  isSaving = false,
  expectedPubkey,
}: {
  onNext: () => void;
  isSaving?: boolean;
  /**
   * Hex pubkey of the just-generated signup key. When set, the publish
   * handler refuses to publish kind 0 unless the active signer matches —
   * a defensive guard against signing with a previously logged-in user's
   * key and overwriting their profile metadata.
   */
  expectedPubkey?: string;
}) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();
  const { mutateAsync: publishEvent, isPending: isPublishing } =
    useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { isEnabled } = usePublishPreferences();
  const pickInputRef = useRef<HTMLInputElement>(null);
  const pendingField = useRef<"picture" | "banner">("picture");

  const [profileData, setProfileData] = useState<Partial<NostrMetadata>>({
    name: "",
    about: "",
    picture: "",
    banner: "",
    website: "",
    shape: "",
  });
  const [cropState, setCropState] = useState<{
    imageSrc: string;
    aspect: number;
    field: "picture" | "banner";
  } | null>(null);

  const handlePickImage = useCallback((field: "picture" | "banner") => {
    pendingField.current = field;
    pickInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const field = pendingField.current;
      setCropState({
        imageSrc: URL.createObjectURL(file),
        aspect: field === "picture" ? 1 : 3,
        field,
      });
    },
    [],
  );

  const handleCropConfirm = useCallback(
    async (blob: Blob) => {
      if (!cropState) return;
      const { field, imageSrc } = cropState;
      URL.revokeObjectURL(imageSrc);
      setCropState(null);
      try {
        const file = new File([blob], `${field}.jpg`, { type: "image/jpeg" });
        const [[, url]] = await uploadFile(file);
        setProfileData((prev) => ({ ...prev, [field]: url }));
      } catch {
        toast({
          title: "Upload failed",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    },
    [cropState, uploadFile],
  );

  const handleCropCancel = useCallback(() => {
    if (cropState) URL.revokeObjectURL(cropState.imageSrc);
    setCropState(null);
  }, [cropState]);

  const handlePublishProfile = useCallback(async () => {
    if (!user) return;
    if (!isEnabled('profile')) {
      toast({
        title: "Profile publishing disabled",
        description:
          "Turn on “Profile metadata” in Settings → Privacy & Publishing to publish your profile.",
        variant: "destructive",
      });
      onNext();
      return;
    }

    // Defensive guard: when this is the signup flow, only publish kind 0 if
    // the active signer matches the freshly generated key. If the
    // auto-switch in useLoginActions ever fails to promote the new login,
    // publishing here would sign with the *previous* user's signer and
    // overwrite their kind 0 metadata. Refuse rather than risk it.
    if (expectedPubkey && user.pubkey !== expectedPubkey) {
      toast({
        title: "Profile not saved",
        description:
          "The new account is not active yet, so your profile was not published (this prevents overwriting another account). You can update it later from settings.",
        variant: "destructive",
      });
      return;
    }

    const hasData = Object.values(profileData).some((v) => v);
    if (hasData) {
      try {
        // Build the outgoing metadata, stripping empty strings and validating shape.
        const { shape, ...rest } = profileData;
        const data: Record<string, unknown> = { ...rest };
        if (shape && isValidAvatarShape(shape)) {
          data.shape = shape;
        }
        for (const key in data) {
          if (data[key] === "") delete data[key];
        }
        await publishEvent({
          kind: 0,
          content: JSON.stringify(data),
          tags: [],
          onSigned: (event) => {
            // Render the profile immediately. Relays can take a moment to
            // return a just-published replaceable event, and an immediate
            // refetch must not turn the new account back into “Anonymous”.
            queryClient.setQueryData(["author", user.pubkey], parseAuthorEvent(event));
            void store.event(event);
          },
        });
        queryClient.invalidateQueries({ queryKey: ["logins"] });
        queryClient.invalidateQueries({ queryKey: ["author", user.pubkey] });
      } catch {
        toast({
          title: "Profile failed",
          description:
            "Your account was created but profile setup failed. You can update it later.",
          variant: "destructive",
        });
      }
    }
    onNext();
  }, [user, profileData, publishEvent, queryClient, store, onNext, expectedPubkey, isEnabled]);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-400">
      <div className="flex items-center gap-4">
        <IntroImage src="/profile-intro.png" />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Set up your profile
          </h2>
          <p className="text-sm text-muted-foreground">
            Tell people a bit about yourself. You can always change this later.
          </p>
        </div>
      </div>

      <input
        ref={pickInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChosen}
      />
      {cropState && (
        <ImageCropDialog
          open
          imageSrc={cropState.imageSrc}
          aspect={cropState.aspect}
          title={
            cropState.field === "picture"
              ? "Crop Profile Picture"
              : "Crop Banner"
          }
          onCancel={handleCropCancel}
          onCrop={handleCropConfirm}
        />
      )}

      <div className={cn(isPublishing && "opacity-50 pointer-events-none")}>
        <ProfileCard
          metadata={profileData}
          onChange={(patch) =>
            setProfileData((prev) => ({ ...prev, ...patch }))
          }
          onPickImage={handlePickImage}
          onAvatarShape={(shape) =>
            setProfileData((prev) => ({ ...prev, shape }))
          }
          showNip05={false}
        />
      </div>

      {isUploading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Uploading image…
        </div>
      )}

      <Button
        onClick={handlePublishProfile}
        className="w-full rounded-full h-11 gap-1.5"
        disabled={isPublishing || isUploading || isSaving}
      >
        {isPublishing || isSaving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Saving…
          </>
        ) : (
          <>
            Continue <ChevronRight className="w-4 h-4" />
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow Packs Step
// ---------------------------------------------------------------------------

/** Parse a follow pack event into structured data. */
function parsePackEvent(event: NostrEvent) {
  const getTag = (name: string) => event.tags.find(([n]) => n === name)?.[1];
  const title = getTag("title") || getTag("name") || "Untitled Pack";
  const description = getTag("description") || getTag("summary") || "";
  const image = getTag("image") || getTag("thumb") || getTag("banner");
  const pubkeys = event.tags.filter(([n]) => n === "p").map(([, pk]) => pk);

  return { title, description, image, pubkeys };
}

function FollowsStep({
  onNext,
  onBack,
  expectedPubkey,
}: {
  onNext: (didFollow: boolean) => void;
  onBack: () => void;
  /**
   * Hex pubkey of the just-generated signup key. When set, the follow-all
   * handler refuses to publish kind 3 unless the active signer matches —
   * a defensive guard against adding follows to the wrong account.
   */
  expectedPubkey?: string;
}) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { store } = useNostrStorage();
  const { isEnabled } = usePublishPreferences();

  const [packs, setPacks] = useState<NostrEvent[]>(SUGGESTED_PACKS);
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(() => new Set());
  const [activePubkeys, setActivePubkeys] = useState<string[]>([]);
  const [isCheckingActivity, setIsCheckingActivity] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);

  const selectedPubkeyCount = selectedPubkeys.size;

  useEffect(() => {
    let cancelled = false;
    const findActivePeople = async () => {
      setIsCheckingActivity(true);
      try {
        const events = await nostr.query([{
          kinds: [1],
          authors: [...ACTIVE_SUGGESTION_CANDIDATES],
          since: Math.floor(Date.now() / 1000) - 24 * 60 * 60,
          limit: 200,
        }], { signal: AbortSignal.timeout(8000) });
        const latestByAuthor = new Map<string, number>();
        for (const event of events) {
          latestByAuthor.set(event.pubkey, Math.max(latestByAuthor.get(event.pubkey) ?? 0, event.created_at));
        }
        const active = [...latestByAuthor.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([pubkey]) => pubkey);
        if (!cancelled) setActivePubkeys(active);
      } catch (error) {
        console.warn("Could not check active onboarding accounts:", error);
      } finally {
        if (!cancelled) setIsCheckingActivity(false);
      }
    };
    void findActivePeople();
    return () => { cancelled = true; };
  }, [nostr]);

  useEffect(() => {
    let cancelled = false;
    const loadSubjectPacks = async () => {
      try {
        const events = await nostr.query([{
          kinds: [39089],
          authors: [PRIMAL_PACK_AUTHOR],
          limit: 100,
        }], { signal: AbortSignal.timeout(8000) });

        const latest = new Map<string, NostrEvent>();
        for (const event of events) {
          const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
          const key = `${event.pubkey}:${d}`;
          const existing = latest.get(key);
          if (!existing || event.created_at > existing.created_at) latest.set(key, event);
        }
        const subjectPacks = [...latest.values()]
          .filter((event) => {
            const { title, pubkeys } = parsePackEvent(event);
            return pubkeys.length > 0 && !(
              /(?:ditto|soapbox|primal)\s+team/i.test(title) ||
              /ditto\s+follow\s+pack/i.test(title)
            );
          })
          .sort((a, b) => parsePackEvent(a).title.localeCompare(parsePackEvent(b).title));
        if (!cancelled) setPacks([...SUGGESTED_PACKS, ...subjectPacks]);
      } catch (error) {
        console.warn('Could not load optional onboarding packs:', error);
      }
    };
    void loadSubjectPacks();
    return () => { cancelled = true; };
  }, [nostr]);

  const togglePubkey = useCallback((pubkey: string) => {
    setSelectedPubkeys((current) => {
      const next = new Set(current);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  }, []);

  const selectPubkeys = useCallback((pubkeys: readonly string[]) => {
    setSelectedPubkeys((current) => new Set([...current, ...pubkeys]));
  }, []);

  const togglePack = useCallback((pack: NostrEvent) => {
    const pubkeys = parsePackEvent(pack).pubkeys.filter((pubkey) => /^[0-9a-f]{64}$/.test(pubkey));
    setSelectedPubkeys((current) => {
      const next = new Set(current);
      const allSelected = pubkeys.length > 0 && pubkeys.every((pubkey) => next.has(pubkey));
      for (const pubkey of pubkeys) {
        if (allSelected) next.delete(pubkey);
        else next.add(pubkey);
      }
      return next;
    });
  }, []);

  const handleContinue = useCallback(async () => {
    if (!user) return;

    if (selectedPubkeyCount < MINIMUM_FOLLOWS) {
      toast({
        title: "Choose at least five people",
        description: "Your Follows feed needs at least five accounts before you continue.",
        variant: "destructive",
      });
      return;
    }

    if (!isEnabled('follows')) {
      toast({
        title: "Follows publishing disabled",
        description:
          "Turn on “Follows” in Settings → Privacy & Publishing to save your follow list.",
        variant: "destructive",
      });
      return;
    }

    // Defensive guard: when this is the signup flow, only publish kind 3
    // if the active signer matches the freshly generated key. Without
    // this, a regression in the auto-switch would add follows to the
    // previously logged-in user's contact list.
    if (expectedPubkey && user.pubkey !== expectedPubkey) {
      toast({
        title: "Follows not saved",
        description:
          "The new account is not active yet, so your follows were not saved (this prevents modifying another account). You can follow people later from the app.",
        variant: "destructive",
      });
      return;
    }

    setIsFollowing(true);

    try {
      const packPubkeys = [...selectedPubkeys];

      // 1. Fetch freshest kind 3 from relays, with the local event store as a
      // fallback floor so a relay miss cannot wipe the existing follow list.
      const prev = await fetchFreshEvent(
        nostr,
        { kinds: [3], authors: [user.pubkey] },
        { store },
      );

      // 2. Separate p-tags from non-p-tags to preserve relay hints, petnames, etc.
      const existingPTags = prev?.tags.filter(([n]) => n === "p") ?? [];
      const nonPTags = prev?.tags.filter(([n]) => n !== "p") ?? [];
      const existingPubkeys = new Set(existingPTags.map(([, pk]) => pk));

      // 3. Merge: add new pubkeys that aren't already followed
      const newPTags = packPubkeys
        .filter((pk) => !existingPubkeys.has(pk))
        .map((pk) => ["p", pk]);

      if (new Set([...existingPTags, ...newPTags].map(([, pk]) => pk)).size < MINIMUM_FOLLOWS) {
        throw new Error("At least five follows are required");
      }

      // 4. Publish with prev for published_at preservation
      await publishEvent({
        kind: 3,
        content: prev?.content ?? "",
        tags: [...nonPTags, ...existingPTags, ...newPTags],
        prev: prev ?? undefined,
      });

      onNext(true);
    } catch (error) {
      console.error("Failed to follow suggested accounts:", error);
      toast({
        title: "Couldn't save your follows",
        description: "Your choices are unchanged. Check your relay connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsFollowing(false);
    }
  }, [user, selectedPubkeys, selectedPubkeyCount, isEnabled, expectedPubkey, nostr, store, publishEvent, onNext]);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-400">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Find people to follow</h2>
        <p className="text-sm text-muted-foreground">
          Follow at least five active accounts to build your feed.
        </p>
      </div>

      <div className="max-h-[58dvh] space-y-7 overflow-y-auto pr-1">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Meet the creators</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FEATURED_CREATORS.map((person) => (
              <PersonSuggestionCard
                key={person.pubkey}
                pubkey={person.pubkey}
                fallbackName={person.label}
                subtitle={person.role}
                selected={selectedPubkeys.has(person.pubkey)}
                onToggle={() => togglePubkey(person.pubkey)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Active right now</h3>
              <p className="text-xs text-muted-foreground">
                {isCheckingActivity ? "Checking recent posts…" : `${activePubkeys.length} people posted in the last 24 hours`}
              </p>
            </div>
            {activePubkeys.length > 0 && (
              <Button type="button" size="sm" className="rounded-full" onClick={() => selectPubkeys(activePubkeys)}>
                Follow all
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {activePubkeys.map((pubkey) => (
              <ActivePersonButton
                key={pubkey}
                pubkey={pubkey}
                selected={selectedPubkeys.has(pubkey)}
                onToggle={() => togglePubkey(pubkey)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold">News sources</h3>
            <p className="text-xs text-muted-foreground">Pick the sources you want in your feed.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {NEWS_SOURCES.map((source) => (
              <PersonSuggestionCard
                key={source.pubkey}
                pubkey={source.pubkey}
                fallbackName={source.label}
                selected={selectedPubkeys.has(source.pubkey)}
                onToggle={() => togglePubkey(source.pubkey)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold">Explore by interest</h3>
            <p className="text-xs text-muted-foreground">Optional Nostr follow packs from trusted curators.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {packs.map((pack) => {
              const packPubkeys = parsePackEvent(pack).pubkeys;
              return (
                <PackCard
                  key={pack.id}
                  event={pack}
                  selected={packPubkeys.length > 0 && packPubkeys.every((pubkey) => selectedPubkeys.has(pubkey))}
                  onToggle={() => togglePack(pack)}
                />
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isFollowing}
          className="flex-1 rounded-full h-11"
        >
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={isFollowing || selectedPubkeyCount < MINIMUM_FOLLOWS}
          className="flex-1 rounded-full h-11 gap-1.5"
        >
          {isFollowing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Following…</>
          ) : (
            <>Continue ({selectedPubkeyCount}/{MINIMUM_FOLLOWS}) <ChevronRight className="w-4 h-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

function PersonSuggestionCard({
  pubkey,
  fallbackName,
  subtitle,
  selected,
  onToggle,
}: {
  pubkey: string;
  fallbackName?: string;
  subtitle?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || fallbackName || genUserName(pubkey);
  const picture = sanitizeUrl(metadata?.picture);

  return (
    <div className={cn(
      "flex min-h-48 flex-col items-center rounded-xl border bg-card p-4 text-center transition-colors",
      selected && "border-primary bg-primary/5",
    )}>
      <Avatar className="size-16" shape={getAvatarShape(metadata)}>
        <AvatarImage src={picture} alt={name} />
        <AvatarFallback className="bg-primary/15 text-primary text-lg">
          {name[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <p className="mt-3 line-clamp-1 font-semibold">{name}</p>
      <p className="min-h-5 text-xs text-muted-foreground">{subtitle ?? "News on Nostr"}</p>
      <Button
        type="button"
        size="sm"
        variant={selected ? "secondary" : "default"}
        className="mt-auto w-full rounded-full"
        aria-pressed={selected}
        onClick={onToggle}
      >
        {selected ? "Following" : "Follow"}
      </Button>
    </div>
  );
}

function ActivePersonButton({
  pubkey,
  selected,
  onToggle,
}: {
  pubkey: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const picture = sanitizeUrl(metadata?.picture);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={`${selected ? "Unfollow" : "Follow"} ${name}`}
      title={name}
      className={cn(
        "rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary ring-2 ring-primary" : "bg-muted hover:ring-2 hover:ring-primary/60",
      )}
    >
      <Avatar className="size-11" shape={getAvatarShape(metadata)}>
        <AvatarImage src={picture} alt="" />
        <AvatarFallback className="bg-primary/15 text-xs text-primary">
          {name[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
    </button>
  );
}

/** Compact follow pack card for the onboarding flow. */
function PackCard({
  event,
  selected,
  onToggle,
}: {
  event: NostrEvent;
  selected: boolean;
  onToggle: () => void;
}) {
  const { title, description, pubkeys } = useMemo(
    () => parsePackEvent(event),
    [event],
  );

  // Show first 6 member avatars
  const previewPubkeys = useMemo(() => pubkeys.slice(0, 6), [pubkeys]);
  const { data: membersMap } = useAuthors(previewPubkeys);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={description || title}
      className={cn(
        'relative min-h-28 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/30',
      )}
    >
      <span className={cn(
        'absolute right-3 top-3 flex size-7 items-center justify-center rounded-full border transition-colors',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/50',
      )} aria-hidden>
        {selected && <Check className="size-4" />}
      </span>
      <div className="space-y-4 pr-8">
        {/* Title + member count */}
        <div className="min-w-0">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug">{title}</h3>
            {description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Member avatar stack */}
        <div className="flex items-center gap-1">
          <div className="flex gap-1">
            {previewPubkeys.map((pk) => {
              const member = membersMap?.get(pk);
              const name = member?.metadata?.name || member?.metadata?.display_name || 'Anonymous';
              return (
                <MiniAvatar
                  key={pk}
                  src={member?.metadata?.picture}
                  name={name}
                />
              );
            })}
          </div>
          {pubkeys.length > previewPubkeys.length && (
            <span className="text-xs text-muted-foreground ml-1">
              +{pubkeys.length - previewPubkeys.length} more
            </span>
          )}
          {pubkeys.length <= previewPubkeys.length && (
            <span className="text-xs text-muted-foreground ml-1 flex items-center gap-1">
              <Users className="size-3" /> {pubkeys.length}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Tiny avatar used in pack member stacks. */
function MiniAvatar({ src, name, metadata }: { src?: string; name: string; metadata?: NostrMetadata }) {
  return (
    <Avatar className="size-7 ring-2 ring-background" shape={getAvatarShape(metadata)}>
      <AvatarImage src={sanitizeUrl(src)} alt={name} />
      <AvatarFallback className="bg-primary/15 text-primary text-[10px]">
        {name[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

// ---------------------------------------------------------------------------
// Privacy Notice Step
// ---------------------------------------------------------------------------

function PrivacyNoticeStep({
  onNext,
  onOpenSettings,
}: {
  onNext: () => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const { config } = useAppContext();

  const handleOpenSettings = () => {
    onOpenSettings();
    navigate("/settings/privacy");
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-400">
      <div className="flex items-center gap-4">
        <IntroImage src="/advanced-intro.png" />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Privacy & publishing
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Here is what {config.appName} may publish to Nostr so you can use
            it across devices.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex gap-3">
          <div className="mt-0.5 size-2 rounded-full bg-primary shrink-0" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Encrypted settings.</span>{" "}
            Theme, feed filters, sidebar order, notification preferences, and
            read cursors are encrypted to your key and synced as a NIP-78 event
            (kind 30078).
          </p>
        </div>
        <div className="flex gap-3">
          <div className="mt-0.5 size-2 rounded-full bg-primary shrink-0" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Relays & file servers.</span>{" "}
            Changes to your relay list (kind 10002) or Blossom servers
            (kind 10063) are published when you edit them.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="mt-0.5 size-2 rounded-full bg-primary shrink-0" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">NOSTR Pet.</span>{" "}
            Pet state and Nostr pet profiles are public events (kinds 31124
            and 11125) sent only to the ₿AO pets relay at this stage of
            development.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
        <p className="text-xs leading-relaxed">
          You can change every auto-publish option anytime in{" "}
          <span className="font-medium text-foreground">
            Settings → Privacy & Publishing
          </span>
          .
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full gap-2 rounded-full h-12"
          onClick={onNext}
        >
          Continue to {config.appName}
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          className="w-full rounded-full h-11"
          onClick={handleOpenSettings}
        >
          Open Privacy & Publishing settings
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outro Step
// ---------------------------------------------------------------------------

function OutroStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="relative">
        <AppLogo size={72} />
        <div className="absolute -bottom-1 -right-1 bg-primary/10 rounded-full p-1.5">
          <Heart className="w-5 h-5 text-primary fill-primary" />
        </div>
      </div>

      <div className="space-y-3 max-w-xs">
        <h2 className="text-2xl font-bold tracking-tight">You're all set</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          That's it! Go find something wonderful, share something fun, and make
          yourself at home.
        </p>
      </div>

      <Button
        size="lg"
        className="w-full max-w-xs gap-2 rounded-full h-12"
        onClick={onComplete}
      >
        Let's go
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared nav buttons
// ---------------------------------------------------------------------------

function _StepNav({
  onBack,
  onNext,
  nextLabel = "Continue",
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex gap-3">
      <Button
        variant="ghost"
        onClick={onBack}
        className="flex-1 rounded-full h-11"
      >
        Back
      </Button>
      <Button onClick={onNext} className="flex-1 rounded-full h-11 gap-1.5">
        {nextLabel}
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
