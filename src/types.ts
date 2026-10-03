import type { ComponentType, FocusEventHandler, PointerEventHandler, ReactNode } from "react";

/** The state an overlay reads from `useOverlay()`. */
export type OverlayState =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly abortable: boolean }
  | { readonly phase: "failed"; readonly error: unknown }
  | { readonly phase: "closing" };

export type OverlayPhase = OverlayState["phase"];

interface BaseLayerConfig {
  /** Maximum number of active (not closing) overlays in this layer. Unlimited when omitted. */
  readonly limit?: number;
  /** What happens when `limit` is reached. Defaults to `"queue"`. */
  readonly overflow?: "queue" | "dismiss-oldest";
}

export interface PlainLayerConfig extends BaseLayerConfig {
  readonly stack?: false;
  /** Wraps every overlay of this layer. Always rendered. */
  readonly container?: ComponentType<{ children?: ReactNode }>;
}

/** A layer whose overlays form a pile that expands on hover or focus, like Ark UI toasts. */
export interface StackLayerConfig extends BaseLayerConfig {
  readonly stack: true;
  /** Renders the group. Spread `group.props` on its root so hover and focus expand the pile. */
  readonly container: ComponentType<StackContainerProps>;
}

export type LayerConfig = PlainLayerConfig | StackLayerConfig;

/** Where an overlay sits in its stack layer. Only available for overlays in a stack layer. */
export interface StackInfo {
  /** 0 is the newest overlay, at the front of the pile. */
  readonly index: number;
  /** Number of active (not queued, not closing) overlays in the layer. */
  readonly count: number;
  /** True while the group is hovered or focused. */
  readonly expanded: boolean;
  /** True while expanded or while the page is hidden. Pause auto-dismiss timers on this. */
  readonly paused: boolean;
  /** Sum of the measured heights of the newer overlays, in px. Add your gap in CSS. */
  readonly offset: number;
  /** Attach to the overlay's root element so its height is measured. */
  readonly ref: (element: HTMLElement | null) => void;
}

export interface StackGroup {
  readonly expanded: boolean;
  readonly count: number;
  /** Height of the front overlay (index 0), for sizing the collapsed pile. */
  readonly frontHeight: number;
  /** Spread on the group's root element. */
  readonly props: {
    readonly onPointerEnter: PointerEventHandler<HTMLElement>;
    readonly onPointerLeave: PointerEventHandler<HTMLElement>;
    readonly onFocus: FocusEventHandler<HTMLElement>;
    readonly onBlur: FocusEventHandler<HTMLElement>;
  };
}

export interface StackContainerProps {
  readonly children?: ReactNode;
  readonly group: StackGroup;
}

export interface CreateOverlayOptions {
  /**
   * Keep the overlay mounted in the `closing` phase until it calls `exited()`,
   * so it can play an exit animation. Without it, closing unmounts immediately.
   */
  readonly exitTransition?: boolean;
}

type IsVoid<V> = [V] extends [void] ? true : false;

export interface SubmitContext {
  /** Aborted when an `abortable` overlay is dismissed while pending. */
  readonly signal: AbortSignal;
}

/** Return a promise to keep the overlay pending until it settles. A rejection moves it to `failed`. */
export type OnSubmit<V> = (value: V, context: SubmitContext) => unknown;

interface BaseCallbacks {
  /** Called exactly once when the overlay closes for any reason other than a successful submit. */
  readonly onDismiss?: () => void;
  /** Allow `dismiss()` while `onSubmit` is pending. The submit's signal is aborted. */
  readonly abortable?: boolean;
}

/** Callbacks for `open()`. `onSubmit` is required when the overlay submits a value. */
export type OpenCallbacks<V> =
  IsVoid<V> extends true
    ? BaseCallbacks & { readonly onSubmit?: OnSubmit<V> }
    : BaseCallbacks & { readonly onSubmit: OnSubmit<V> };

/** Arguments of `Handle.open()`. Props are optional only when every prop is optional and no callback is required. */
export type OpenArgs<P, V> =
  IsVoid<V> extends true
    ? {} extends P
      ? [props?: P, callbacks?: OpenCallbacks<V>]
      : [props: P, callbacks?: OpenCallbacks<V>]
    : [props: P, callbacks: OpenCallbacks<V>];

/** Options for `openAsync()`. The promise replaces `onDismiss`, and `onSubmit` becomes optional. */
export interface OpenAsyncOptions<V> {
  /** Return a promise to keep the overlay pending until it settles. `openAsync` resolves only after it succeeds. */
  readonly onSubmit?: OnSubmit<V>;
  /** Allow `dismiss()` while `onSubmit` is pending. The submit's signal is aborted. */
  readonly abortable?: boolean;
}

/** Arguments of `Handle.openAsync()`. Props are optional only when every prop is optional. */
export type OpenAsyncArgs<P, V> = {} extends P
  ? [props?: P, options?: OpenAsyncOptions<V>]
  : [props: P, options?: OpenAsyncOptions<V>];

/** What `openAsync()` resolves to. It never rejects: a dismiss resolves with `submitted: false`. */
export type OverlayResult<V> =
  | { readonly submitted: true; readonly value: V }
  | { readonly submitted: false };

export type SubmitFn<V> = IsVoid<V> extends true ? () => void : (value: V) => void;

/** What `useOverlay(Handle)` returns inside the overlay component. */
export interface OverlayControl<V> {
  readonly state: OverlayState;
  /** Hands the value to the caller's `onSubmit`. Ignored unless the phase is `idle` or `failed`. */
  readonly submit: SubmitFn<V>;
  /** Closes without submitting. Ignored while pending unless the caller opened it as `abortable`. */
  readonly dismiss: () => void;
  /** Tells the manager the exit animation finished. Only used with `exitTransition: true`. */
  readonly exited: () => void;
}

/** `useOverlay()`'s return type: overlays in a stack layer also get `stack`. */
export type OverlayControlFor<V, S extends boolean> = OverlayControl<V> &
  (S extends true ? { readonly stack: StackInfo } : unknown);

/** A single open overlay, returned by `Handle.open()`. */
export interface OverlayInstance<P> {
  /** Replaces all props. The overlay is not remounted. */
  update(props: P): void;
  /** Same rules as the overlay's own `dismiss()`. */
  dismiss(): void;
}

/** Returned by `createOverlay`. The only way to open the overlay. */
export interface OverlayHandle<P, V, S extends boolean = false> {
  readonly displayName: string;
  open(...args: OpenArgs<P, V>): OverlayInstance<P>;
  /**
   * Opens the overlay and resolves once it closes: with the value after a successful submit,
   * or with `submitted: false` after a dismiss. Use `open()` to update or dismiss it from outside.
   */
  openAsync(...args: OpenAsyncArgs<P, V>): Promise<OverlayResult<V>>;
  /** Type-only carrier for `useOverlay`. Never set at runtime. */
  readonly "~types"?: { readonly props: P; readonly value: V; readonly stack: S };
}

type LayerNames<Layers> = Extract<keyof Layers, string>;
export type StackLayerName<Layers> = {
  [K in LayerNames<Layers>]: Layers[K] extends { readonly stack: true } ? K : never;
}[LayerNames<Layers>];
export type PlainLayerName<Layers> = Exclude<LayerNames<Layers>, StackLayerName<Layers>>;

export interface OverlayManager<Layers extends Record<string, LayerConfig>> {
  createOverlay<P, V = void>(
    layer: StackLayerName<Layers>,
    component: ComponentType<P>,
    options?: CreateOverlayOptions,
  ): OverlayHandle<P, V, true>;
  createOverlay<P, V = void>(
    layer: PlainLayerName<Layers>,
    component: ComponentType<P>,
    options?: CreateOverlayOptions,
  ): OverlayHandle<P, V, false>;
  /** Renders every open overlay. Mount once, inside your app's providers. */
  readonly Outlet: ComponentType;
  /** Dismisses every overlay, or only those in `layer`. Same rules as `dismiss()`. */
  dismissAll(layer?: LayerNames<Layers>): void;
}
