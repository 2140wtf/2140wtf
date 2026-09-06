// Ground truth for round 27b: craft CHECKSUM-VALID bolt11 invoices with
// hostile/extreme amounts (amount lives in the HRP per BOLT11), and see
// exactly what light-bolt11-decoder reports — including >2^53 amounts.
import { bech32 } from '@scure/base';
import { decode as decodeBolt11 } from 'light-bolt11-decoder';

// BOLT11 data part (5-bit words): timestamp(7) + payment-hash TLV + sig TLV
// + recovery TLV. The AMOUNT is plain ASCII inside the HRP: lnbc<digits><mult>.
function craftInvoice(hrp, tsSec = 1_700_000_000) {
  const words = [];
  for (let i = 6; i >= 0; i--) words.push(Math.floor(tsSec / 2 ** (5 * i)) & 31);
  words.push(1, 32 >> 5, 32 & 31, ...Array(52).fill(21)); // payment hash tag (32B, 52 words)
  words.push(3, 65 >> 5, 65 & 31, ...Array(104).fill(15)); // signature tag (65 bytes)
  words.push(7, 0, 1, 0, 1); // recovery-flag tag (1 byte = 0b00000001 → words [0,1])
  return bech32.encode(hrp, words, Number.MAX_SAFE_INTEGER);
}

const cases = [
  ['lnbc25u', '25 µBTC → 2_500_000 msats (sane)'],
  ['lnbc2m', '0.002 BTC → 200_000_000 msats'],
  ['lnbc999999999999999m', '15 nines × m → 9.99e22 msats (>> 2^53!)'],
  ['lnbc99999999999999999999p', '20 digits × p → 9.99e18 msats (> 2^53)'],
  ['lnbc9007199254740992n', '2^53 × 100 msats → 9.007e17 msats (> 2^53)'],
  ['lnbc99999999999999999', 'bare 17 nines, no multiplier → unit?'],
];

for (const [hrp, label] of cases) {
  const inv = craftInvoice(hrp);
  try {
    const d = decodeBolt11(inv);
    const amount = d.sections.find((s) => s.name === 'amount');
    const raw = Number(amount?.value);
    const sats = amount?.value == null ? null : raw / 1000;
    console.log(`${label}`);
    console.log(`   amountMsat=${amount?.value} → floorSats=${sats === null ? 'null' : Math.floor(sats)} · msatSafe=${Number.isSafeInteger(raw)} · satsSafe=${sats !== null && Number.isSafeInteger(sats)}`);
  } catch (e) {
    console.log(`${label}\n   THROW: ${String(e.message).slice(0, 80)}`);
  }
}
