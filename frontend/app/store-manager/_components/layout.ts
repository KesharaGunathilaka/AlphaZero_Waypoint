/** Size and grid classes for the store manager screens, which run on desktop and on phone. */
export function storeLayout(phone: boolean) {
  return {
    h1: phone ? "text-xl font-bold" : "text-[22px] font-bold",
    card: phone ? "rounded-xl border border-wp-border bg-wp-surface" : "rounded-lg border border-wp-border bg-wp-surface",
    radius: phone ? "rounded-xl" : "rounded-lg",
    button: phone ? "min-h-11 text-base" : "min-h-8",
    rowHeight: phone ? "min-h-[52px]" : "min-h-10",
    inputHeight: phone ? "h-11" : "h-8",
    cols2: phone ? "grid-cols-1" : "grid-cols-2",
    colsMain: phone ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
    colsReceipt: phone ? "grid-cols-2" : "grid-cols-4",
    colsLine: phone ? "grid-cols-[1.4fr_.6fr_.8fr_1.2fr]" : "grid-cols-[2fr_1fr_1fr_2fr]",
  };
}

export type StoreLayout = ReturnType<typeof storeLayout>;
