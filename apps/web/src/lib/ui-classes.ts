// Shared UI utility classes.
//
// MODAL_OVERLAY_CLASSES: Use on the ModalOverlay (react-aria-components) of
// every centered modal dialog. Solid 70% black scrim, no backdrop blur, to
// match the in-app image preview style. Per-modal overlay styling is a
// regression risk: if you fork this for a one-off modal you'll create
// inconsistent dim levels across the app. If a future modal genuinely needs
// a different scrim, add a new exported constant here rather than inlining.
export const MODAL_OVERLAY_CLASSES =
  "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70";
