import { Info } from "lucide-react";
import { useSeoMeta } from "@unhead/react";

import { useAppContext } from "@/hooks/useAppContext";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { PageHeader } from "@/components/PageHeader";

export function AboutPage() {
  const { config } = useAppContext();
  useLayoutOptions({});

  useSeoMeta({
    title: `About | ${config.appName}`,
    description: "About 2140.wtf — art, film, music, and the Bitcoin movement.",
  });

  return (
    <main className="min-h-screen pb-16 sidebar:pb-0">
      <PageHeader title="About" icon={<Info className="size-5" />} />

      <article className="px-4 py-6 max-w-2xl space-y-6 text-base leading-relaxed">
        <p>
          At{" "}
          <a
            href="https://2140.wtf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline underline-offset-4"
          >
            2140.wtf
          </a>
          , we believe that art, film, and music can creatively capture the
          essence of the Bitcoin movement, which is more than just a tech
          culture or financial revolution — it&apos;s a movement and a way of
          thinking that resonates with many of us.
        </p>

        <p>
          Our collective, 2140.wtf, is dedicated to promoting the tools of
          freedom. We are strong supporters of the NOSTR protocol and host the
          NOSTR LONDON meetup and podcast, bringing like-minded individuals
          together to discuss and explore the possibilities of this innovative
          technology.
        </p>

        <p>
          Through various events, we promote the Bitcoin ethos and provide a
          platform for people to express themselves, learn, and get inspired.
          Our collective consists of individuals who understand the principles
          of peaceful revolution and are committed to accessing the unlimited
          potential of the crowd.
        </p>

        <p>
          We don&apos;t just cater to bitcoiners, but also reach out to artists,
          activists, and individuals who are passionate about taking action and
          creating positive change. By doing so, we aim to promote innovative
          solutions that may have gone unnoticed and provide a space for people
          to come together, share ideas, and drive progress.
        </p>

        <p>
          Read the original Bitcoin whitepaper:{' '}
          <a
            href="https://bitcoin.org/bitcoin.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline underline-offset-4"
          >
            bitcoin.org/bitcoin.pdf
          </a>
        </p>
      </article>

    </main>
  );
}
