import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type FocusEvent,
} from "react";
import { InstanceContext, type InstanceContextValue } from "./context.ts";
import { OverlayStore, type Callbacks, type Entry } from "./store.ts";
import type {
  CreateOverlayOptions,
  LayerConfig,
  OverlayHandle,
  OverlayInstance,
  OverlayManager,
  StackGroup,
  StackInfo,
} from "./types.ts";

type AnyHandle = OverlayHandle<unknown, unknown, boolean>;
type AnyComponent = ComponentType<Record<string, unknown>>;

export interface OverlayManagerConfig<Layers extends Record<string, LayerConfig>> {
  /** Named layers. Declaration order is render order: later layers draw on top. */
  readonly layers: Layers;
}

export function createOverlayManager<const Layers extends Record<string, LayerConfig>>(
  config: OverlayManagerConfig<Layers>,
): OverlayManager<Layers> {
  const store = new OverlayStore<AnyHandle, AnyComponent>(config.layers);
  const hasStackLayer = Object.values(config.layers).some((layer) => layer.stack);

  function createOverlay(
    layer: string,
    component: ComponentType<never>,
    options: CreateOverlayOptions = {},
  ): AnyHandle {
    if (!store.hasLayer(layer)) {
      throw new Error(`Unknown overlay layer "${layer}". Declared layers: ${Object.keys(config.layers).join(", ")}.`);
    }
    const handle: AnyHandle = {
      displayName: component.displayName ?? (component.name || "Overlay"),
      open(props?: unknown, callbacks?: Callbacks): OverlayInstance<unknown> {
        const id = store.open({
          layer,
          handle,
          component: component as AnyComponent,
          exitTransition: options.exitTransition ?? false,
          props: props ?? {},
          callbacks: callbacks ?? {},
        });
        return {
          update: (next) => store.update(id, next),
          dismiss: () => store.dismiss(id),
        };
      },
    };
    return handle;
  }

  // One set of group handlers per stack layer, so containers get stable props.
  const groupProps = new Map<string, StackGroup["props"]>();
  for (const [layer, layerConfig] of Object.entries(config.layers)) {
    if (!layerConfig.stack) continue;
    groupProps.set(layer, {
      onPointerEnter: () => store.setExpanded(layer, true),
      onPointerLeave: () => store.setExpanded(layer, false),
      onFocus: () => store.setExpanded(layer, true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        // Moving focus between toasts in the group keeps it expanded.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) store.setExpanded(layer, false);
      },
    });
  }

  // One ResizeObserver per manager measures every stacked overlay.
  const ids = new WeakMap<Element, number>();
  let observer: ResizeObserver | null = null;
  const measure = (id: number, element: HTMLElement | null, previous: HTMLElement | null) => {
    if (previous) observer?.unobserve(previous);
    if (!element) return;
    ids.set(element, id);
    // offsetHeight ignores transforms, so a scaled-down toast in the pile still reports its real height.
    store.setHeight(id, element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    observer ??= new ResizeObserver((records) => {
      const heights: [number, number][] = [];
      for (const record of records) {
        const target = record.target as HTMLElement;
        const recordId = ids.get(target);
        if (recordId !== undefined) heights.push([recordId, record.borderBoxSize[0]?.blockSize ?? target.offsetHeight]);
      }
      store.setHeights(heights); // one snapshot and re-render for everything that resized together
    });
    observer.observe(element);
  };

  function Outlet() {
    const layers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

    useEffect(() => {
      if (!hasStackLayer || typeof document === "undefined") return;
      const sync = () => store.setPageHidden(document.visibilityState === "hidden");
      sync();
      document.addEventListener("visibilitychange", sync);
      return () => document.removeEventListener("visibilitychange", sync);
    }, []);

    return (
      <>
        {layers.map(({ layer, entries, group }) => {
          const children = entries.map((entry) => <InstanceView key={entry.id} entry={entry} measure={measure} />);
          const layerConfig = store.layerConfig(layer)!;
          if (layerConfig.stack) {
            const Container = layerConfig.container;
            return (
              <Container key={layer} group={{ ...group!, props: groupProps.get(layer)! }}>
                {children}
              </Container>
            );
          }
          const Container = layerConfig.container ?? Fragment;
          return <Container key={layer}>{children}</Container>;
        })}
      </>
    );
  }

  return {
    createOverlay: createOverlay as OverlayManager<Layers>["createOverlay"],
    Outlet,
    dismissAll: (layer) => store.dismissAll(layer),
  };
}

type Measure = (id: number, element: HTMLElement | null, previous: HTMLElement | null) => void;

/** Re-renders only when this overlay's entry changes, not when another overlay does. */
const InstanceView = memo(function InstanceView({
  entry,
  measure,
}: {
  entry: Entry<AnyHandle, AnyComponent>;
  measure: Measure;
}) {
  const { id, handle, control, stack, component: Component } = entry;

  // Stable for the overlay's lifetime (InstanceView is keyed by id).
  const ref = useMemo(() => {
    let current: HTMLElement | null = null;
    return (element: HTMLElement | null) => {
      measure(id, element, current);
      current = element;
    };
  }, [id, measure]);

  // Stable across prop-only updates, so `useOverlay` consumers only re-render on state or position changes.
  const stackInfo = useMemo<StackInfo | null>(() => (stack ? { ...stack, ref } : null), [stack, ref]);
  const value = useMemo<InstanceContextValue>(
    () => ({ handle, overlay: stackInfo ? { ...control, stack: stackInfo } : control }),
    [handle, control, stackInfo],
  );
  return (
    <InstanceContext.Provider value={value}>
      <Component {...(entry.props as Record<string, unknown>)} />
    </InstanceContext.Provider>
  );
});
