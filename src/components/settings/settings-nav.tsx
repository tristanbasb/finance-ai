"use client";

import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { activeSection, SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/settings-ui";

/** Distance (px) sous le haut de la fenêtre à partir de laquelle une rubrique est « en cours ». */
const THRESHOLD = 140;

/**
 * Sommaire des Réglages : pastilles collantes (sous l'en-tête mobile), défilables à
 * l'horizontale, qui mènent à chaque carte et suivent la rubrique visible.
 */
export function SettingsNav() {
  const [active, setActive] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const tops = SETTINGS_SECTIONS.flatMap((s) => {
        const el = document.getElementById(s.id);
        return el ? [{ id: s.id, top: el.getBoundingClientRect().top }] : [];
      });
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActive(activeSection(tops, THRESHOLD, atBottom && window.scrollY > 0));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Garde la pastille active visible dans la bande défilante (sans faire défiler la page).
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!nav || !chip || nav.scrollWidth <= nav.clientWidth) return;
    const left = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Sommaire des réglages"
      className="sticky top-[var(--mobile-header-h)] z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-border bg-bg/85 px-4 py-2 backdrop-blur-md [scrollbar-width:none] sm:-mx-6 sm:px-6 md:top-0 md:mx-0 md:rounded-full md:border md:px-2"
    >
      {SETTINGS_SECTIONS.map((s) => (
        <Chip
          key={s.id}
          data-section={s.id}
          selected={active === s.id}
          onClick={() => {
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
            document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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
