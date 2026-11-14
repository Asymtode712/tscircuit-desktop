import { create } from "zustand";

/**
 * tscircuit desktop: a standing request to report an autorouter bug. The command
 * palette makes it, and the Circuit tab on screen answers it with its report dialog.
 */
export const useAutorouterReportRequest = create<{ readonly requested: boolean }>(() => ({
  requested: false,
}));
