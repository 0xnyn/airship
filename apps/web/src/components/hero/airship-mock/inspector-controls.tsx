import type { ReactNode } from "react";
import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";
import type { GlyphName } from "#/content/editor-glyphs";

/*
 * The four control primitives the inspector is built from.
 *
 * All static: this is a picture of a panel, not a panel. Nothing here takes an
 * onChange, and the values that appear to change during the loop are driven by
 * CSS on `.ap-ctl-value`, not by state — which is what lets the whole animation
 * survive `animation-play-state: paused` and `prefers-reduced-motion` without a
 * single line of JavaScript.
 */

/**
 * A number field. Borderless until touched; the glyph is also the scrub handle,
 * which is why it is 20px and sits inside the field rather than beside it.
 *
 * `letter` renders a mono character (W, H, X, Y) where the real panel has no
 * pictogram for the property — the letter IS the icon there.
 */
export function NumField({
  className,
  glyph,
  letter,
  suffix,
  value,
  valueClassName,
}: {
  className?: string;
  glyph?: GlyphName;
  letter?: string;
  suffix?: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className={className ? `ap-ctl-num ${className}` : "ap-ctl-num"}>
      <span className="ap-ctl-glyph">
        {glyph ? <EditorGlyph name={glyph} size={20} /> : null}
        {letter ? <span className="ap-ctl-glyph-txt">{letter}</span> : null}
      </span>
      <span
        className={
          valueClassName ? `ap-ctl-value ${valueClassName}` : "ap-ctl-value"
        }
      >
        {value}
      </span>
      {suffix ? <span className="ap-ctl-suffix">{suffix}</span> : null}
    </div>
  );
}

/**
 * A value that changes during the loop, rendered as both states at once.
 *
 * CSS cannot rewrite text, so the two readings are stacked in a single grid cell
 * and cross-faded. The grid — rather than absolute positioning — is what makes
 * the field size to the WIDER of the two ("9999", not "6"), so the panel does
 * not reflow at the moment the value changes. That reflow is exactly the sort of
 * thing that reads as a glitch rather than as an edit.
 */
export function SwapValue({
  from,
  name,
  to,
}: {
  from: string;
  name: string;
  to: string;
}) {
  return (
    <span className="ap-swap">
      <span className={`ap-swap-from ap-swap-from-${name}`}>{from}</span>
      <span className={`ap-swap-to ap-swap-to-${name}`}>{to}</span>
    </span>
  );
}

/** A dropdown. Bordered at rest — it opens something, so it looks like it does. */
export function Select({ value }: { value: string }) {
  return (
    <span className="ap-select">
      {value}
      <EditorGlyph name="chevronDown" size={16} />
    </span>
  );
}

/**
 * A segmented control. Text options stay pills; an all-icon group becomes square
 * 24px cells, because a row of icon pills reads as five separate buttons.
 */
export function Segmented({
  activeIndex,
  icons,
  options,
}: {
  activeIndex: number;
  icons?: readonly GlyphName[];
  options?: readonly string[];
}) {
  const cell = (index: number) =>
    index === activeIndex ? "ap-ctl-seg-btn ap-ctl-seg-on" : "ap-ctl-seg-btn";

  // Two branches rather than one loop with a ternary inside. A shared loop needs
  // `item as GlyphName` to satisfy the union, which discards exactly the check
  // that makes the glyph names safe in the first place.
  if (icons) {
    return (
      <span className="ap-ctl-seg ap-ctl-seg-icon">
        {icons.map((name, index) => (
          <span className={cell(index)} key={name}>
            <EditorGlyph name={name} size={16} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="ap-ctl-seg">
      {(options ?? []).map((label, index) => (
        <span className={cell(index)} key={label}>
          {label}
        </span>
      ))}
    </span>
  );
}

/** A colour swatch over a conic checkerboard, plus its hex and alpha fields. */
export function PaintRow({
  alpha,
  hex,
  hexClassName,
  swatchClassName,
}: {
  alpha: string;
  hex: ReactNode;
  hexClassName?: string;
  swatchClassName?: string;
}) {
  return (
    <span className="ap-paint-row">
      <span
        className={
          swatchClassName ? `ap-ctl-swatch ${swatchClassName}` : "ap-ctl-swatch"
        }
      />
      <NumField
        className={
          hexClassName ? `ap-paint-hex ${hexClassName}` : "ap-paint-hex"
        }
        value={hex}
      />
      <NumField className="ap-paint-pct" suffix="%" value={alpha} />
    </span>
  );
}
