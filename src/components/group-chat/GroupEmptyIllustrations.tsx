interface IllustrationProps {
  className?: string;
}

export function NoGroupsIllustration({ className }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M60 18L92 32v28c0 22-14 40-32 46-18-6-32-24-32-46V32l32-14Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      <path
        d="M48 54h24M48 68h16"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="88" cy="86" r="16" fill="currentColor" opacity="0.15" />
      <path
        d="M88 78v16M80 86h16"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NoMessagesIllustration({ className }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M28 34h52a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H56l-16 12v-12H28a8 8 0 0 1-8-8V42a8 8 0 0 1 8-8Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      <path
        d="M40 54h28M40 70h20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M44 20h48a8 8 0 0 1 8 8v36"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.25"
      />
    </svg>
  );
}

export function NoMembersIllustration({ className }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="60" cy="44" r="18" stroke="currentColor" strokeWidth="4" opacity="0.5" />
      <path
        d="M32 96c0-18 12-30 28-30s28 12 28 30"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.4"
      />
      <circle cx="92" cy="74" r="14" stroke="currentColor" strokeWidth="4" opacity="0.3" />
      <path
        d="M76 96c0-12 8-20 18-20s18 8 18 20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.25"
      />
      <circle cx="28" cy="74" r="14" stroke="currentColor" strokeWidth="4" opacity="0.3" />
      <path
        d="M8 96c0-12 8-20 18-20s18 8 18 20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  );
}
