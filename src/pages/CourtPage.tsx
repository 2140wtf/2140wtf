import { useState } from "react";
import {
  Gavel,
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
  HeartHandshake,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useSeoMeta } from "@unhead/react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { QRCodeCanvas } from "@/components/ui/qrcode";
import { ZapAmountInput } from "@/components/ZapAmountInput";
import { ZapSuccessScreen } from "@/components/ZapSuccessScreen";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/useToast";
import { JurorDashboard } from "@/components/bao-court/JurorDashboard";
import type { JurorSettingsState } from "@/components/bao-court/JurorSettings";
import { resolveLnurlPay, fetchLnurlInvoice } from "@/lib/lnurl";
import { bolt11Info } from "@/lib/zaps";
import { fetchBtcPrice } from "@/lib/bitcoin";
import { openUrl } from "@/lib/downloadFile";
import { notificationSuccess } from "@/lib/haptics";

const STORAGE_KEY = "bao-court-settings";

/** The Court's lightning tip jar. Resolved fresh over LNURL-pay on every zap. */
const COURT_SUPPORT_LUD16 = "baocourt@rizful.com";

/** Suggested zap amounts for the "Support the Court" card (max 214,000 sats). */
const SUPPORT_AMOUNTS_SATS: number[] = [214, 1_111, 2_140, 5_000, 21_400, 42_140, 100_000, 214_000];

const SUPPORT_COMMENT = "Supporting ₿AO Court — jury verification";

function loadSettings(): JurorSettingsState {
  const defaults: JurorSettingsState = { categories: ["sports"], bondAmountSats: 10_000, demoMode: true, demoPace: "guided", rail: "spark", realMode: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "categories" in parsed &&
      Array.isArray(parsed.categories) &&
      "bondAmountSats" in parsed &&
      typeof parsed.bondAmountSats === "number" &&
      "demoMode" in parsed &&
      typeof parsed.demoMode === "boolean" &&
      "demoPace" in parsed &&
      (parsed.demoPace === "guided" || parsed.demoPace === "fast") &&
      "rail" in parsed &&
      typeof parsed.rail === "string"
    ) {
      return {
        ...parsed,
        realMode: "realMode" in parsed && typeof parsed.realMode === "boolean" ? parsed.realMode : false,
      } as JurorSettingsState;
    }
  } catch {
    // Fall through to defaults.
  }
  return defaults;
}

type SupportStep = "amount" | "sending" | "manual" | "success";

/**
 * "Support the Court" zap card. Sends a NIP-57 zap to the Court's lightning
 * address through the app's existing LNURL/NIP-57 plumbing (src/lib/lnurl.ts —
 * the same layer both in-app zap flows use): the pay params are resolved fresh
 * on every send, a kind-9734 zap request is signed against the provider's
 * advertised nostrPubkey, and payment falls back NWC → WebLN → manual QR,
 * mirroring useZap's payment ladder. If the provider ever stops advertising
 * `allowsNostr`, the same code degrades to a plain LNURL-pay with no zap
 * request attached.
 */
function SupportCourtCard() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { activeConnection, payWithNWC, webln } = useWallet();
  const { toast } = useToast();

  const [amountSats, setAmountSats] = useState<number | string>(2_140);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<SupportStep>("amount");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [recipientPubkey, setRecipientPubkey] = useState<string>(COURT_SUPPORT_LUD16);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const { data: btcPrice } = useQuery({
    queryKey: ["btc-price", config.esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(config.esploraApis, signal),
    staleTime: 30_000,
  });

  const numericAmountSats =
    typeof amountSats === "string"
      ? Number(amountSats.replace(/,/g, "")) || 0
      : amountSats;

  const resetDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setStep("amount");
      setInvoice(null);
      setCopied(false);
      setError("");
    }
  };

  const handleSupport = async () => {
    setError("");
    if (!user?.signer) {
      toast({
        title: "Sign in to zap",
        description: "You must be logged in to support the Court.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(numericAmountSats) || numericAmountSats < 1) {
      setError("Enter an amount.");
      return;
    }

    setStep("sending");
    try {
      // Always resolve the LNURL-pay params fresh — never hardcode the response.
      const params = await resolveLnurlPay({ lud16: COURT_SUPPORT_LUD16 });
      const amountMsats = numericAmountSats * 1000;
      if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
        throw new Error(
          `Amount must be between ${Math.ceil(params.minSendable / 1000)} and ${Math.floor(params.maxSendable / 1000)} sats.`,
        );
      }

      // NIP-57: when the provider advertises zaps, sign a kind-9734 against the
      // provider's nostrPubkey (the recipient identity for a lightning-address
      // zap) and hand it ONLY to the LNURL callback — the provider publishes
      // the public receipt. Otherwise this is a plain LNURL-pay.
      let zapRequest: string | undefined;
      if (params.allowsNostr && params.nostrPubkey) {
        setRecipientPubkey(params.nostrPubkey);
        const signed = await user.signer.signEvent({
          kind: 9734,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["p", params.nostrPubkey],
            ["amount", String(amountMsats)],
            ["relays", ...config.appRelays],
          ],
        });
        zapRequest = JSON.stringify(signed);
      }

      const bolt11 = await fetchLnurlInvoice(params, {
        amountMsats,
        comment: SUPPORT_COMMENT,
        zapRequest,
      });
      // Never pay an invoice that doesn't encode what we asked for.
      if (bolt11Info(bolt11).amountMsats !== amountMsats) {
        throw new Error("The wallet service returned a mismatched invoice.");
      }

      if (activeConnection) {
        await payWithNWC(bolt11);
      } else if (webln) {
        await webln.enable();
        await webln.sendPayment(bolt11);
      } else {
        // Manual fallback: surface the invoice for an external wallet. The
        // provider's receipt confirms the zap once paid.
        setInvoice(bolt11);
        setStep("manual");
        return;
      }

      notificationSuccess();
      setStep("success");
    } catch (e) {
      setStep("amount");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  const handleCopyInvoice = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HeartHandshake className="size-5 text-primary" />
          <h2 className="text-base font-semibold">Support the Court</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Zaps keep jury verification free for everyone. Pick an amount — or set your own in the
          next step.
        </p>
        <ToggleGroup
          type="single"
          value={String(numericAmountSats)}
          onValueChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) setAmountSats(n);
          }}
          className="grid grid-cols-4 sm:grid-cols-8 gap-1 w-full"
        >
          {SUPPORT_AMOUNTS_SATS.map((amount) => (
            <ToggleGroupItem
              key={amount}
              value={String(amount)}
              className="h-8 min-w-0 text-xs font-semibold px-1"
              data-state={numericAmountSats === amount ? "on" : "off"}
            >
              {amount.toLocaleString("en-US")}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="outline" className="w-full" onClick={() => resetDialog(true)}>
          <Zap className="size-4 mr-2 text-amber-500" />
          Zap {numericAmountSats.toLocaleString("en-US")} sats to the Court
        </Button>

        <Dialog open={dialogOpen} onOpenChange={resetDialog}>
          <DialogContent className="max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Support the Court</DialogTitle>
              <DialogDescription>
                Zaps keep jury verification free for everyone.
              </DialogDescription>
            </DialogHeader>

            {step === "success" ? (
              <ZapSuccessScreen
                recipientPubkey={recipientPubkey}
                recipientLabel="₿AO Court"
                amountSats={numericAmountSats}
                btcPrice={btcPrice}
                kind="lightning"
                onClose={() => resetDialog(false)}
              />
            ) : step === "manual" && invoice ? (
              <div className="grid gap-3 py-2">
                <div className="flex justify-center">
                  <div className="bg-white p-3 rounded-xl" aria-label="Lightning invoice QR code">
                    <QRCodeCanvas value={invoice.toUpperCase()} size={220} level="M" className="block" />
                  </div>
                </div>
                <div className="flex gap-2 min-w-0">
                  <Input
                    value={invoice}
                    readOnly
                    aria-label="Lightning invoice"
                    className="font-mono text-xs min-w-0 flex-1 overflow-hidden text-ellipsis"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopyInvoice}
                    className="shrink-0"
                    aria-label="Copy invoice"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openUrl(`lightning:${invoice}`)}
                  className="w-full"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Lightning Wallet
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Scan the QR or copy the invoice to pay with any Lightning wallet.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 py-2">
                <ZapAmountInput
                  amountSats={amountSats}
                  onChange={(value) => {
                    setAmountSats(value);
                    setError("");
                  }}
                  btcPrice={btcPrice}
                  currencyDisplay={config.currencyDisplay ?? "sats"}
                  presets={SUPPORT_AMOUNTS_SATS}
                  disabled={step === "sending"}
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button
                  type="button"
                  onClick={handleSupport}
                  disabled={numericAmountSats <= 0 || step === "sending"}
                  className="w-full"
                >
                  {step === "sending" ? (
                    <>
                      <Loader2 className="size-4 mr-1.5 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Zap className="size-4 mr-1.5 text-amber-500" />
                      Zap the Court
                    </>
                  )}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function CourtPage(): React.JSX.Element {
  const { config } = useAppContext();
  const [settings, setSettings] = useState<JurorSettingsState>(loadSettings);
  const [howItWorksOpen, setHowItWorksOpen] = useState(true);

  useSeoMeta({
    title: `₿AO Court | ${config.appName}`,
    description: "Decentralized jury verification for ₿AO disputes",
  });

  const handleSettingsChange = (next: JurorSettingsState) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors.
    }
  };

  return (
    <main>
      <PageHeader title="₿AO Court" icon={<Gavel className="size-5" />}>
        <span className="text-sm text-muted-foreground hidden sm:inline">
          A bonded jury verifies the outcome
        </span>
      </PageHeader>

      <div className="px-4 py-4 max-w-6xl mx-auto space-y-4">
        <Alert>
          <Info className="size-4" />
          <AlertDescription>
            Have a dispute? A bonded jury verifies the outcome. Independent jurors each lock a small
            refundable deposit, review the evidence, and vote — the majority decision settles
            ₿AO disputes, including bao.markets outcomes. Serving costs nothing beyond the deposit,
            and voting takes a single click.
          </AlertDescription>
        </Alert>

        <Collapsible
          open={howItWorksOpen}
          onOpenChange={setHowItWorksOpen}
          className="rounded-xl border-2 border-primary/70 bg-primary/5 p-1 shadow-md ring-2 ring-primary/20"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="default"
              className="w-full justify-between px-4 py-3 text-base font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`${howItWorksOpen ? "Hide" : "Show"} how ₿AO Court works`}
            >
              <span>How it works — read this first</span>
              {howItWorksOpen ? (
                <ChevronUp className="size-5" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-5" aria-hidden="true" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-lg border border-primary/30 bg-background p-4 space-y-3 text-sm leading-6 text-foreground/80">
              <p>
                Each jury runs a distributed key ceremony (threshold FROST) so the jurors share one
                public key and no single device ever holds the full secret. Jurors commit to their
                votes with a hash, reveal them together, then combine partial signatures into a
                single threshold attestation that records the verified outcome.
              </p>
              <p>
                Juror bonds are locked on the Spark rail and refunded when the case closes; a bond
                is slashed only for proven cheating. Real appeals require multiple online
                participants.
              </p>
              <p>
                Practice mode opens a named jury room: 3–5 users choose a category, lock 10,000 fake
                Spark sats, and run a practice key ceremony together — the full protocol, no real
                money.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <JurorDashboard settings={settings} onSettingsChange={handleSettingsChange} />

        <SupportCourtCard />
      </div>
    </main>
  );
}

export default CourtPage;
