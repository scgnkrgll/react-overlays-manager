import { createContext } from "react";
import type { Control } from "./store.ts";
import type { StackInfo } from "./types.ts";

export interface InstanceContextValue {
  readonly handle: { readonly displayName: string };
  /** What `useOverlay` returns: the control, plus `stack` in stack layers. */
  readonly overlay: Control | (Control & { readonly stack: StackInfo });
}

export const InstanceContext = createContext<InstanceContextValue | null>(null);
InstanceContext.displayName = "OverlayInstance";
