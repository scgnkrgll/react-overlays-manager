import { useEffect, useRef } from "react";
import { useOverlay } from "../src";
import { overlays } from "./overlays";

export interface MenuItem<A extends string = string> {
  action: A;
  label: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
}

function ContextMenu({ x, y, items }: ContextMenuProps) {
  const { submit, dismiss } = useOverlay(ContextMenuOverlay);
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && dismiss();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  return (
    <ul
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-36 animate-in rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <li
          key={item.action}
          role="menuitem"
          tabIndex={-1}
          className="cursor-default rounded-md px-2 py-1.5 select-none hover:bg-accent hover:text-accent-foreground"
          onClick={() => submit(item.action)}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Submits the chosen item's action. */
export const ContextMenuOverlay = overlays.createOverlay<ContextMenuProps, string>("menu", ContextMenu);
