/** tscircuit desktop: the right-panel tab with the files and links for having a board made. */
export interface OrderSurface {
  id: "order";
  kind: "order";
  /** The file the user chose to order. Unset to order what the Circuit tab shows, or to ask. */
  relativePath?: string;
}

export const orderSurface = (relativePath?: string): OrderSurface =>
  relativePath === undefined
    ? { id: "order", kind: "order" }
    : { id: "order", kind: "order", relativePath };
