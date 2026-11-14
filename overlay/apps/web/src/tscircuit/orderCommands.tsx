import type { ScopedThreadRef } from "@t3tools/contracts";
import { ShoppingCart } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { openOrderPane } from "./orderActions";

/** `/order` in the composer's command menu. The composer runs it with `openOrderPane`. */
export const ORDER_SLASH_COMMAND_ITEM = {
  id: "slash:order",
  type: "slash-command",
  command: "order",
  label: "/order",
  description: "Get the files and a price to have a board made",
} as const;

/** "Order board" in the command palette. */
export const orderPaletteItem = (threadRef: ScopedThreadRef): CommandPaletteActionItem => ({
  kind: "action",
  value: "action:order-board",
  searchTerms: [
    "order",
    "order board",
    "manufacture",
    "fabrication",
    "gerbers",
    "bom",
    "pick and place",
    "jlcpcb",
    "circuithub",
  ],
  title: "Order board",
  icon: <ShoppingCart className={ITEM_ICON_CLASS} />,
  run: async () => {
    openOrderPane(threadRef);
  },
});
