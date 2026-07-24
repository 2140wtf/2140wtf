/** Fenced code block. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre
      data-lang={lang}
      className="my-1.5 max-w-full overflow-x-auto rounded-md border border-border/60 bg-muted/50 px-3 py-2 font-mono text-[13px] leading-snug whitespace-pre-wrap break-words"
    >
      <code>{code}</code>
    </pre>
  );
}

/** `inline code` span. */
export function InlineCode({ code }: { code: string }) {
  return (
    <code className="rounded-[3px] border border-border/40 bg-muted/60 px-1 py-px font-mono text-[0.85em]">
      {code}
    </code>
  );
}
