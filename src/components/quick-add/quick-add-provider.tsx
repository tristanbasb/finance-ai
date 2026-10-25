"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ImportWizard } from "@/components/transactions/import-wizard";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-fields";
import { toast } from "@/components/ui/toast";
import { isQuickAddShortcut, type Proposal } from "@/lib/quick-add";
import { QuickAddSheet, type QuickAddData } from "./quick-add-sheet";

export type QuickAddContextValue = {
  /**
   * Ouvre la feuille « Nouvelle opération », toujours vierge. `prefill` avec un montant affiche
   * directement la proposition modifiable ; sans montant, le formulaire prérempli.
   */
  open: (prefill?: Partial<Proposal>) => void;
  /** Ouvre directement l'assistant d'import d'un relevé CSV. */
  openImport: () => void;
};

const QuickAddContext = createContext<QuickAddContextValue | null>(null);

export function useQuickAdd(): QuickAddContextValue {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd doit être utilisé sous <QuickAddProvider>.");
  return ctx;
}

type Session = { nonce: number; open: boolean; prefill?: Partial<Proposal> };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url);
  return (await res.json()) as T;
}

async function loadData(): Promise<QuickAddData> {
  const [accounts, categories, status] = await Promise.all([
    getJson<{ id: number; name: string; type: string; archived: boolean }[]>("/api/accounts"),
    getJson<CategoryOption[]>("/api/categories"),
    getJson<{ enabled?: unknown }>("/api/ai/status"),
  ]);
  return {
    accounts: accounts.map((a): AccountOption => ({
      id: a.id,
      name: a.name,
      type: a.type,
      archived: a.archived,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      icon: c.icon,
    })),
    aiEnabled: status.enabled === true,
  };
}

const LOAD_ERROR = "Impossible de charger les comptes et les catégories. Vérifiez la connexion.";

/**
 * Saisie rapide accessible partout : `useQuickAdd().open()`, raccourci « N » (hors champ de
 * saisie et hors dialogue ouvert). Comptes, catégories et état de l'IA sont chargés à la
 * première ouverture, puis rechargés à l'ouverture suivant un ajout. Monte aussi l'assistant
 * d'import CSV, ouvert par `openImport()` (lien « Importer un relevé CSV » de la feuille, bloc de
 * démarrage de l'accueil).
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session>({ nonce: 0, open: false });
  const [importState, setImportState] = useState({ nonce: 0, open: false });
  const [data, setData] = useState<QuickAddData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stale = useRef(true);
  const loading = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (loading.current) return true;
    loading.current = true;
    setLoadError(null);
    try {
      setData(await loadData());
      stale.current = false;
      return true;
    } catch {
      setLoadError(LOAD_ERROR);
      return false;
    } finally {
      loading.current = false;
    }
  }, []);

  const open = useCallback(
    (prefill?: Partial<Proposal>) => {
      setSession((s) => ({ nonce: s.nonce + 1, open: true, prefill }));
      if (stale.current) void load();
    },
    [load],
  );

  const close = useCallback(() => setSession((s) => ({ ...s, open: false })), []);

  const onAdded = useCallback(() => {
    toast.success("Opération ajoutée");
    stale.current = true;
    close();
    router.refresh();
  }, [close, router]);

  const openImport = useCallback(() => {
    setImportState((s) => ({ nonce: s.nonce + 1, open: true }));
    // L'assistant s'affiche dès que comptes et catégories sont chargés.
    if (stale.current)
      void load().then((ok) => {
        if (!ok) {
          setImportState((s) => ({ ...s, open: false }));
          toast.error(LOAD_ERROR);
        }
      });
  }, [load]);

  const onImport = useCallback(() => {
    close();
    openImport();
  }, [close, openImport]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || !isQuickAddShortcut(e) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const value = useMemo(() => ({ open, openImport }), [open, openImport]);

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      <QuickAddSheet
        key={session.nonce}
        open={session.open}
        onClose={close}
        data={data}
        loadError={loadError}
        onRetryLoad={load}
        prefill={session.prefill}
        onImport={onImport}
        onAdded={onAdded}
      />
      {data && (
        <ImportWizard
          key={`import-${importState.nonce}`}
          open={importState.open}
          onClose={() => {
            setImportState((s) => ({ ...s, open: false }));
            stale.current = true;
          }}
          accounts={data.accounts}
          categories={data.categories}
        />
      )}
    </QuickAddContext.Provider>
  );
}
