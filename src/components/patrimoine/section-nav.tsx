"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { parseSection, patrimoineSections, type PatrimoineSectionId } from "@/lib/patrimoine";

function scrollToSection(id: PatrimoineSectionId, behavior: ScrollBehavior) {
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
}

/**
 * Navigation par rubrique (pastilles collantes) et défilement initial : `?section=` (posé par
 * les redirections /savings et /investments) ou `#hash`. Le paramètre est remplacé par le hash.
 * `showNews` : la section Actualités est affichée (sinon sa pastille est masquée).
 */
export function SectionNav({
  initialSection,
  showNews,
}: {
  initialSection: PatrimoineSectionId | null;
  showNews: boolean;
}) {
  const sections = patrimoineSections({ news: showNews });
  const [active, setActive] = useState<PatrimoineSectionId>(initialSection ?? "comptes");

  useEffect(() => {
    const target = initialSection ?? parseSection(window.location.hash);
    if (!target) return;
    scrollToSection(target, "auto");
    if (initialSection) window.history.replaceState(null, "", `/patrimoine#${target}`);
  }, [initialSection]);

  // Rubrique visible : celle dont le haut a dépassé le bandeau collant.
  useEffect(() => {
    const onScroll = () => {
      const visible = patrimoineSections({ news: showNews });
      let current: PatrimoineSectionId = visible[0].id;
      for (const s of visible) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showNews]);

  return (
    <nav
      aria-label="Rubriques du patrimoine"
      className="sticky top-[var(--mobile-header-h)] z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-border bg-bg/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:top-[var(--content-header-h)] md:mx-0 md:rounded-full md:border md:px-2"
    >
      {sections.map((s) => (
        <Chip
          key={s.id}
          current={active === s.id}
          onClick={() => {
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            scrollToSection(s.id, reduce ? "auto" : "smooth");
            window.history.replaceState(null, "", `#${s.id}`);
            setActive(s.id);
          }}
        >
          {s.label}
        </Chip>
      ))}
    </nav>
  );
}
