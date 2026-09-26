/**
 * ₿AO Fund - protocol library surface.
 *
 * Event builders, API client, types, and attestation logic for the BAO
 * Fund protocol. Consumed by apps (2140.wtf, bao-fund) as a git dep.
 *
 * Note: React UI components are intentionally not exported yet; they
 * depend on the app's shadcn/ui kit.
 */
export * from './baoFundraising';
export * from './baoAttestation';
export * from './baoMarketParser';
export * from './baoComputeCredits';
export * from './baoWorkContract';
