import { useContext } from "react";
import { InstanceContext } from "./context.ts";
import type { OverlayControlFor, OverlayHandle } from "./types.ts";

/**
 * Controls for the overlay this component is rendered in. Must be called inside
 * the component registered for `handle`; open overlays with `handle.open()`.
 */
export function useOverlay<P, V, S extends boolean>(handle: OverlayHandle<P, V, S>): OverlayControlFor<V, S> {
  const context = useContext(InstanceContext);
  const name = handle.displayName;
  if (!context) {
    throw new Error(
      `useOverlay(${name}) must be called inside the ${name} overlay component. To open it, call ${name}.open().`,
    );
  }
  if (context.handle !== handle) {
    const hint =
      context.handle.displayName === name
        ? "A component can belong to only one handle; create a separate component for each createOverlay call."
        : "Pass the handle of the overlay this component belongs to.";
    throw new Error(`useOverlay(${name}) was called inside a different overlay (${context.handle.displayName}). ${hint}`);
  }
  return context.overlay as unknown as OverlayControlFor<V, S>;
}
