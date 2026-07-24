import { ChevronDown, Copy, ExternalLink, HelpCircle, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { GenericPaymentContent } from "@/components/GenericPaymentContent";
import { PaymentMethodIcon } from "@/components/PaymentMethodIcon";
import { ZapSuccessScreen } from "@/components/ZapSuccessScreen";
import { Button } from "@/components/ui/button";
import {
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QRCodeCanvas } from "@/components/ui/qrcode";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppContext } from "@/hooks/useAppContext";
import { useAuthor } from "@/hooks/useAuthor";
import { usePaymentTargets } from "@/hooks/usePaymentTargets";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { useToast } from "@/hooks/useToast";
import { useWallet } from "@/hooks/useWallet";
import { useZap } from "@/hooks/useZap";
import { canZap } from "@/lib/canZap";
import { writeClipboardText } from "@/lib/clipboard";
import {
  fetchBtcPrice,
} from "@/lib/bitcoinMoney";
import { DEFAULT_ESPLORA_APIS } from "@/lib/esplora";
import {
  PAYMENT_METHODS,
  findLightningTarget,
  type PaymentMethodDef,
  type PaymentTarget,
} from "@/lib/paymentTargets";
import { ZAP_PRESETS, formatSats } from "@/lib/zaps";

import type { ChatMsg, ZapPayment } from "@/components/chat/transport";

interface ZapDialogImplProps {
  target: ChatMsg;
  sendZap?: (target: ChatMsg, payment: ZapPayment) => Promise<void>;
  onDone: () => void;
}

const PRESETS = ZAP_PRESETS.slice(0, 5);

type DialogMethodId = string;

interface DialogMethod {
  id: DialogMethodId;
  def: PaymentMethodDef;
  target?: PaymentTarget;
}

function methodTitle(method: DialogMethod | undefined): string {
  return method?.def.label ?? "Zap";
}

/** The zap dialog body — method switcher + Lightning/generic panes. */
export default function ZapDialogImpl({ target, sendZap, onDone }: ZapDialogImplProps) {
  const { config } = useAppContext();
  const { toast } = useToast();
  const { activeConnection, webln } = useWallet();
  const author = useAuthor(target.pubkey);
  const metadata = author.data?.metadata;
  const displayName = useScopedDisplayName(target.pubkey, metadata);

  const isPrivate = Boolean(sendZap);
  // A private zap's tally is proven by the payment preimage, which only a
  // connected wallet (NWC / WebLN) can return — the manual QR path can't, so
  // without a wallet the pane blocks instead of offering a payment that could
  // never be counted (matching the original feat/zaps design).
  const walletRequired = isPrivate && !activeConnection && !webln;
  const hasLightning = canZap(metadata);

  // NIP-A3 payment targets. Only fetch once the dialog is open (the parent
  // already gates the mount on `open`). On-chain Bitcoin targets (addresses
  // and BIP-352 silent payment codes) render through the generic QR+copy
  // pane — this build has no on-chain sending.
  const { targets: paymentTargets } = usePaymentTargets(target.pubkey);
  const lightningTarget = useMemo(() => findLightningTarget(paymentTargets), [paymentTargets]);

  const genericTargets = useMemo(
    () => paymentTargets.filter((t) => t.type !== "lightning"),
    [paymentTargets],
  );

  // Build the ordered method list: Lightning first (native), then every
  // declared payment target (Bitcoin, Monero, …) via the generic pane.
  const methods = useMemo<DialogMethod[]>(() => {
    const list: DialogMethod[] = [];
    if (hasLightning || lightningTarget) {
      list.push({ id: "lightning", def: PAYMENT_METHODS.lightning });
    }
    for (const t of genericTargets) {
      list.push({ id: t.type, def: PAYMENT_METHODS[t.type], target: t });
    }
    // No Lightning address and no payment targets — still offer the Lightning
    // pane so the dialog isn't empty (the zap resolve will surface the error).
    if (list.length === 0) {
      list.push({ id: "lightning", def: PAYMENT_METHODS.lightning });
    }
    return list;
  }, [hasLightning, lightningTarget, genericTargets]);

  // Determine the default method: the first available method. (Armada also
  // honored a persisted defaultZapMethod preference; 2140.wtf's AppConfig has
  // no such key, so the registry order governs.)
  const defaultMethodId: DialogMethodId = methods[0].id;
  const [activeMethod, setActiveMethod] = useState<DialogMethodId>(defaultMethodId);
  const currentMethod = methods.find((m) => m.id === activeMethod) ?? methods[0];

  // Success state — replaces the method UI when set.
  const [success, setSuccess] = useState<
    | { kind: "lightning"; amountSats: number }
    | null
  >(null);

  const { data: btcPrice } = useQuery({
    queryKey: ["btc-price"],
    queryFn: ({ signal }) => fetchBtcPrice([...DEFAULT_ESPLORA_APIS], signal),
    staleTime: 30_000,
  });

  // ── Lightning state ──
  const [amount, setAmount] = useState<number>(PRESETS[1]);
  const [editingAmount, setEditingAmount] = useState(false);
  const [error, setError] = useState("");
  const amountInputRef = useRef<HTMLInputElement>(null);

  const { zap, status, invoice } = useZap({
    target,
    recipient: { pubkey: target.pubkey, metadata },
    sendZap,
  });

  const busy = status === "resolving" || status === "paying";
  const showingInvoice = status === "manual" && invoice;

  useEffect(() => {
    if (editingAmount) {
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }
  }, [editingAmount]);

  const commitAmountEdit = useCallback(() => setEditingAmount(false), []);

  const handleLightningZap = async () => {
    setError("");
    if (amount <= 0) { setError("Enter an amount."); return; }
    try {
      const outcome = await zap(amount, "");
      if (outcome === "paid") {
        setSuccess({ kind: "lightning", amountSats: amount });
      } else if (outcome === "unproven") {
        toast({
          title: `Sent ${formatSats(amount)} sats ⚡`,
          description:
            "The payment went through, but the wallet hasn't provided the proof a private zap tally needs. We'll keep checking for a couple of minutes and count the zap if it turns up — wallets like Alby Hub, Coinos, or lnbits provide it reliably.",
        });
        setSuccess({ kind: "lightning", amountSats: amount });
      }
      // "manual" keeps the dialog open — the QR view renders below.
    } catch (e) {
      toast({
        title: "Zap failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const handleCopy = () => {
    if (invoice) {
      void writeClipboardText(invoice);
      toast({ title: "Invoice copied" });
    }
  };

  const openInWallet = () => {
    if (invoice) window.location.href = `lightning:${invoice}`;
  };

  return (
    <>
      <div className="flex items-center justify-between px-4 h-12">
        <DialogTitle className="text-base font-semibold flex items-center gap-1.5 min-w-0">
          {success ? (
            "Success"
          ) : showingInvoice ? (
            "Lightning Payment"
          ) : methods.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 min-w-0 rounded-md px-1 -mx-1 hover:bg-secondary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                  aria-label="Switch payment method"
                >
                  <PaymentMethodIcon method={currentMethod?.def} />
                  <span className="truncate">{methodTitle(currentMethod)}</span>
                  <ChevronDown className="size-4 shrink-0 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44" onClick={(e) => e.stopPropagation()}>
                {methods.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => setActiveMethod(m.id)}
                    className="gap-2"
                  >
                    <PaymentMethodIcon method={m.def} />
                    <span>{m.def.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="truncate">
              {isPrivate ? "Private Zap" : `Zap ${displayName}`}
            </span>
          )}
          {isPrivate && !showingInvoice && !success && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="How private zaps work"
                >
                  <HelpCircle className="size-4 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" className="w-72 p-3 text-xs leading-relaxed text-foreground/80">
                Payment proof (preimage) is sealed into the channel so members verify the zap locally. No public receipt, no relay tally.
              </PopoverContent>
            </Popover>
          )}
        </DialogTitle>
        <button
          type="button"
          onClick={onDone}
          className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="overflow-y-auto max-h-[calc(95vh-3rem)]">
        {success ? (
          <ZapSuccessScreen
            recipientPubkey={target.pubkey}
            amountSats={success.amountSats}
            btcPrice={btcPrice}
            onClose={onDone}
          />
        ) : showingInvoice ? (
          <LightningInvoiceView
            invoice={invoice!}
            amount={amount}
            webln={!!webln}
            busy={busy}
            onPay={handleLightningZap}
            onCopy={handleCopy}
            onOpenInWallet={openInWallet}
          />
        ) : currentMethod?.def.kind === "lightning" ? (
          <LightningZapPane
            amount={amount}
            setAmount={setAmount}
            editingAmount={editingAmount}
            setEditingAmount={setEditingAmount}
            amountInputRef={amountInputRef}
            commitAmountEdit={commitAmountEdit}
            error={error}
            setError={setError}
            busy={busy}
            status={status}
            walletRequired={walletRequired}
            onZap={handleLightningZap}
          />
        ) : currentMethod?.target ? (
          <GenericPaymentContent
            method={currentMethod.def}
            target={currentMethod.target}
            amountSats={amount}
            currencyDisplay={config.currencyDisplay}
            btcPrice={btcPrice}
            onAmountChange={(v) => setAmount(typeof v === "string" ? Number(v) || 0 : v)}
            onSuccess={(r) => setSuccess({ kind: "lightning", amountSats: r.amountSats })}
          />
        ) : null}
      </div>
    </>
  );
}

// ── Lightning pane (amount + presets + send) ──────────────────────────────

interface LightningZapPaneProps {
  amount: number;
  setAmount: (n: number) => void;
  editingAmount: boolean;
  setEditingAmount: (v: boolean) => void;
  amountInputRef: React.RefObject<HTMLInputElement | null>;
  commitAmountEdit: () => void;
  error: string;
  setError: (s: string) => void;
  busy: boolean;
  status: string;
  /** Private zap with no connected wallet: block the CTA (no provable payment). */
  walletRequired: boolean;
  onZap: () => void;
}

function LightningZapPane({
  amount,
  setAmount,
  editingAmount,
  setEditingAmount,
  amountInputRef,
  commitAmountEdit,
  error,
  setError,
  busy,
  status,
  walletRequired,
  onZap,
}: LightningZapPaneProps) {
  return (
    <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      <div className="flex flex-col items-center pt-2">
        {editingAmount ? (
          <div className="flex items-baseline justify-center">
            <input
              ref={amountInputRef}
              type="number"
              inputMode="numeric"
              min={1}
              value={amount || ""}
              onChange={(e) => { setAmount(Number(e.target.value)); setError(""); }}
              onBlur={commitAmountEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitAmountEdit(); }
              }}
              aria-label="Amount in sats"
              className="bg-transparent border-0 outline-none text-4xl font-semibold text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              style={{ width: `${Math.max(2, String(amount).length + 1)}ch` }}
            />
            <span className="text-4xl font-semibold text-muted-foreground"> sats</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingAmount(true)}
            aria-label="Edit amount"
            className="flex items-baseline justify-center rounded-md px-2 -mx-2 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <span className="text-4xl font-semibold tabular-nums">
              {formatSats(amount)}
            </span>
            <span className="text-4xl font-semibold text-muted-foreground"> sats</span>
          </button>
        )}
      </div>

      <ToggleGroup
        type="single"
        value={PRESETS.includes(amount) ? String(amount) : ""}
        onValueChange={(v) => { if (v) { setAmount(Number(v)); setError(""); setEditingAmount(false); } }}
        className="grid grid-cols-5 gap-1 w-full"
      >
        {PRESETS.map((preset) => (
          <ToggleGroupItem
            key={preset}
            value={String(preset)}
            className="h-8 min-w-0 text-xs font-semibold px-1"
          >
            {formatSats(preset)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {walletRequired && (
        <p className="text-xs text-amber-500">
          Private zaps need a payment proof, so connect a wallet first (Settings → Wallet).
        </p>
      )}

      <Button
        type="button"
        onClick={onZap}
        disabled={busy || amount <= 0 || walletRequired}
        className="w-full"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            {status === "resolving" ? "Creating invoice…" : "Paying…"}
          </>
        ) : (
          `Send ${formatSats(amount)} sats`
        )}
      </Button>
    </div>
  );
}

// ── Lightning invoice (QR) view ───────────────────────────────────────────

interface LightningInvoiceViewProps {
  invoice: string;
  amount: number;
  webln: boolean;
  busy: boolean;
  onPay: () => void;
  onCopy: () => void;
  onOpenInWallet: () => void;
}

function LightningInvoiceView({
  invoice,
  amount,
  webln,
  busy,
  onPay,
  onCopy,
  onOpenInWallet,
}: LightningInvoiceViewProps) {
  return (
    <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      <div className="flex flex-col items-center pt-1">
        <div className="text-3xl font-semibold tabular-nums">
          {formatSats(amount)} sats
        </div>
      </div>

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
          onClick={onCopy}
          className="shrink-0"
          aria-label="Copy invoice"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-2">
        {webln && (
          <Button type="button" onClick={onPay} disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Processing…
              </>
            ) : (
              "Pay with WebLN"
            )}
          </Button>
        )}
        <Button
          type="button"
          variant={webln ? "outline" : "default"}
          onClick={onOpenInWallet}
          className="w-full"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Open in Lightning Wallet
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Scan the QR or copy the invoice to pay with any Lightning wallet.
      </p>
    </div>
  );
}
