import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_STORAGE_KEY, clearAssistantConversation } from "@/lib/assistant-storage";

describe("clearAssistantConversation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supprime la conversation de l'assistant du localStorage", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { removeItem } });
    clearAssistantConversation();
    expect(ASSISTANT_STORAGE_KEY).toBe("finance-ai.assistant.conversation.v1");
    expect(removeItem).toHaveBeenCalledWith(ASSISTANT_STORAGE_KEY);
  });

  it("ne lève pas si le stockage est indisponible", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(() => clearAssistantConversation()).not.toThrow();
  });
});
