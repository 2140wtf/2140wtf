/**
 * The ₿AO mark — a Bitcoin-symbol roundel used where Armada showed its crest
 * (invite/roles/decrypt-consent dialogs). Rendered with theme tokens so it
 * follows the user's custom theme. `BaoMarkKeyframes` keeps Armada's
 * `ArmadaCrestKeyframes` call sites working; the ₿AO mark needs no keyframes,
 * so it renders nothing.
 */
export function BaoMark({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, fontSize: size * 0.58 }}
    >
      <div className="size-full rounded-2xl bg-primary/15 text-primary flex items-center justify-center font-bold select-none">
        ₿
      </div>
    </div>
  );
}

/** No-op keyframes holder (the ₿AO mark is static). */
export function BaoMarkKeyframes() {
  return null;
}
