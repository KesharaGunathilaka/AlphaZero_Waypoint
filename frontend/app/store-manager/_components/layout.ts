/**
 * Size and grid classes for the store manager screens, which run on desktop and on phone.
 * Mobile first: the plain classes are the phone layout, the `md`/`lg` ones widen it for desktop.
 */
export const storeLayout = {
  h1: "text-xl font-bold md:text-[22px]",
  card: "rounded-xl border border-wp-border bg-wp-surface md:rounded-lg",
  radius: "rounded-xl md:rounded-lg",
  button: "min-h-11 text-base md:min-h-8 md:text-xs",
  rowHeight: "min-h-[52px] md:min-h-10",
  inputHeight: "h-11 md:h-8",
  cols2: "grid-cols-1 md:grid-cols-2",
  colsMain: "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
  colsReceipt: "grid-cols-2 md:grid-cols-4",
  colsLine: "grid-cols-[1.4fr_.6fr_.8fr_1.2fr] md:grid-cols-[2fr_1fr_1fr_2fr]",
};
