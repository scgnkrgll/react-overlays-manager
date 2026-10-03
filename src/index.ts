/**
 * Type-safe, headless manager for modals, menus, toasts and other overlays.
 *
 * @example
 * ```tsx
 * import { createOverlayManager } from "react-overlord";
 *
 * export const overlays = createOverlayManager({
 *   layers: { modal: {}, toast: { limit: 3 } },
 * });
 * ```
 *
 * @module
 */

export { createOverlayManager } from "./createOverlayManager.tsx";
export type { OverlayManagerConfig } from "./createOverlayManager.tsx";
export { useOverlay } from "./useOverlay.ts";
export type {
  CreateOverlayOptions,
  LayerConfig,
  OnSubmit,
  OpenArgs,
  OpenAsyncArgs,
  OpenAsyncOptions,
  OpenCallbacks,
  OverlayControl,
  OverlayControlFor,
  OverlayHandle,
  OverlayInstance,
  OverlayManager,
  OverlayPhase,
  OverlayResult,
  OverlayState,
  PlainLayerConfig,
  PlainLayerName,
  StackContainerProps,
  StackGroup,
  StackInfo,
  StackLayerConfig,
  StackLayerName,
  SubmitContext,
  SubmitFn,
} from "./types.ts";
