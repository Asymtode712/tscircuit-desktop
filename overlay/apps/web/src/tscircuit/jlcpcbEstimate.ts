/**
 * tscircuit desktop: what JLCPCB would charge for a board, as the viewer frame
 * worked it out with @tscircuit/circuit-json-to-jlcpcb-quote.
 */
import { isRecord, type OrderResponsePayload } from "./orderRequest";

interface EstimateRow {
  readonly label: string;
  readonly total: number;
  /** What the row covers or why it is there, when the quote says. */
  readonly note: string | null;
}

export interface JlcpcbEstimate {
  /** Bare boards ordered: JLCPCB's smallest order. */
  readonly boards: number;
  /** How many of them get their parts soldered on. 0 for a board with no parts. */
  readonly assembledBoards: number;
  /** Everything in `rows`: the boards, assembly, parts, shipping and taxes. */
  readonly total: number;
  readonly lowTotal: number;
  readonly highTotal: number;
  readonly rows: ReadonlyArray<EstimateRow>;
  /** Parts JLCPCB could not be asked for, which the total leaves out. */
  readonly unpricedDesignators: ReadonlyArray<string>;
  /** Where the shipping and taxes are worked out for. */
  readonly destinationNote: string | null;
}

const MAX_ROWS = 40;
const MAX_DESIGNATORS = 200;
const MAX_TEXT_LENGTH = 400;

const amount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, MAX_TEXT_LENGTH) : null;

function readRow(value: unknown): EstimateRow | null {
  if (!isRecord(value)) return null;
  const label = text(value.label);
  const total = amount(value.total);
  return label === null || total === null ? null : { label, total, note: text(value.note) };
}

/**
 * The estimate in the viewer's answer. Null when it is not in the shape this
 * build knows, as it would be after a change in the quote package.
 */
export function readJlcpcbEstimate(payload: OrderResponsePayload): JlcpcbEstimate | null {
  const quote = payload.quote;
  if (!isRecord(quote) || !isRecord(quote.order) || !isRecord(quote.summary)) return null;
  const grandTotal = quote.summary.grandTotal;
  if (!isRecord(grandTotal) || !Array.isArray(quote.summary.rows)) return null;
  const boards = amount(quote.order.quantity);
  const total = amount(grandTotal.total);
  const rows = quote.summary.rows.slice(0, MAX_ROWS).map(readRow);
  if (boards === null || boards < 1 || total === null || rows.length === 0) return null;
  if (!rows.every((row) => row !== null)) return null;
  const excluded = Array.isArray(quote.excluded_designators) ? quote.excluded_designators : [];
  return {
    boards,
    assembledBoards: amount(quote.order.assembledQuantity) ?? 0,
    total,
    lowTotal: amount(grandTotal.lowTotal) ?? total,
    highTotal: amount(grandTotal.highTotal) ?? total,
    rows,
    unpricedDesignators: excluded
      .slice(0, MAX_DESIGNATORS)
      .flatMap((designator) => text(designator) ?? []),
    destinationNote: text(quote.destination_note),
  };
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatUsd = (value: number): string => usd.format(value);

/** The price beside the link: to the dollar, because the shipping in it is itself an estimate. */
export const formatEstimateTotal = (estimate: JlcpcbEstimate): string =>
  `~${wholeUsd.format(estimate.total)}`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The order the estimate is for, such as "5 boards, 2 of them assembled". */
export const describeEstimateOrder = (estimate: JlcpcbEstimate): string =>
  estimate.assembledBoards === 0
    ? `${count(estimate.boards, "bare board", "bare boards")}`
    : `${count(estimate.boards, "board", "boards")}, ${estimate.assembledBoards} of them assembled`;
