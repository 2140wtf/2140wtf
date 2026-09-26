import type { MeltQuoteResponse, Proof } from 'cashu-ts3';
import type { WalletTransaction } from './walletHistory';

export { PRIMARY_MINT_URL as DEFAULT_MINT_URL } from './mintConfig';

export interface WalletMintSummary {
  mintUrl: string;
  balanceSats: number;
  proofCount: number;
  active: boolean;
}

export interface LightningTopUpQuote {
  quoteId: string;
  invoice: string;
  amountSats: number;
  expiry: number | null;
  mintUrl: string;
}

export interface LightningPayQuote {
  amountSats: number;
  feeReserveSats: number;
  expiry: number | null;
  mintUrl: string;
  /** Raw melt quote — pass back to payQuotedInvoice. */
  quote: MeltQuoteResponse;
}

export interface WalletState {
  mintUrl: string;
  proofs: Proof[];
  balanceSats: number;
  /** Balance across every known mint. */
  totalBalanceSats: number;
  /** Every known mint, active first. */
  mints: WalletMintSummary[];
  /** Local operation history, newest first (bounded). */
  transactions: WalletTransaction[];
  isLoading: boolean;
  error: string | null;
}

export interface WalletActions {
  /** Select the active mint; adds it when new (public https only). */
  setMintUrl: (url: string) => Promise<void>;
  /** Alias of setMintUrl for the "add a mint" form. */
  addMint: (url: string) => Promise<void>;
  /** Forget a mint (refused while it holds proofs or a recovery marker). */
  removeMint: (url: string) => Promise<void>;
  receiveToken: (token: string) => Promise<number>;
  sendSats: (amount: number, mintUrl?: string) => Promise<string>;
  refreshProofs: () => Promise<void>;
  /** NUT-04: create a Lightning invoice that mints into this wallet. */
  createTopUp: (amountSats: number, mintUrl?: string) => Promise<LightningTopUpQuote>;
  /** NUT-04: poll a top-up quote; mints the proofs once paid. */
  completeTopUp: (quoteId: string, mintUrl?: string) => Promise<{ state: 'paid' | 'pending'; minted: number; balanceAfter: number }>;
  /** NUT-05: quote a bolt11 invoice payment (no funds move yet). */
  quotePayment: (invoice: string, mintUrl?: string) => Promise<LightningPayQuote>;
  /** NUT-05: pay a quoted invoice from this wallet. */
  payQuotedInvoice: (quote: MeltQuoteResponse, mintUrl?: string) => Promise<{ paid: boolean; changeSats: number; balanceAfter: number; state: string }>;
  /** Clear the local operation history. */
  clearHistory: () => void;
}
