import type { StackContainerProps } from "../src";

export function ToastGroup({ children, group }: StackContainerProps) {
  return (
    <ol
      className="toast-group"
      aria-live="polite"
      data-expanded={group.expanded}
      style={{ "--front-height": `${group.frontHeight}px` } as React.CSSProperties}
      {...group.props}
    >
      {children}
    </ol>
  );
}
