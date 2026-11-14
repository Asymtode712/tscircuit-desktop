import { CircuitBoard, ShoppingCart } from "lucide-react";

export function CircuitTabIcon() {
  return <CircuitBoard className="size-3 shrink-0" />;
}

export function OrderTabIcon() {
  return <ShoppingCart className="size-3 shrink-0" />;
}

/**
 * The tscircuit entries for the right panel's add-tab menus. Returns nothing
 * where the panel has no thread to open them for.
 */
export function tscircuitSurfaceActions(
  onAddTab: ((kind: "circuit" | "order") => void) | undefined,
) {
  if (!onAddTab) return [];
  return [
    {
      label: "Circuit",
      description: "Preview the project's tscircuit board.",
      icon: CircuitBoard,
      shortcut: "C",
      available: true,
      disabledReason: "",
      onClick: () => onAddTab("circuit"),
    },
    {
      label: "Order",
      description: "Get the files to have the board made.",
      icon: ShoppingCart,
      shortcut: "O",
      available: true,
      disabledReason: "",
      onClick: () => onAddTab("order"),
    },
  ];
}
