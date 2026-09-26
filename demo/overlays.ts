import { createOverlayManager } from "../src";
import { ToastGroup } from "./ToastGroup";

export const overlays = createOverlayManager({
  layers: {
    modal: {},
    menu: { limit: 1, overflow: "dismiss-oldest" },
    // Ark-style pile: overlapping toasts that expand on hover. The limit is only a safety cap.
    toast: { stack: true, limit: 24, container: ToastGroup },
  },
});
