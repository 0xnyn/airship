/**
 * Media — `<img>`, `<video>`, and raster background images.
 *
 * The one section that writes HTML *attributes* as well as CSS. `object-fit` is
 * a style; `alt` is not, and pretending otherwise would send the agent looking
 * for a stylesheet rule that can never exist. The two go through different
 * paths — `ctx.onChange` for declarations, `ctx.onAttr` for attributes — and
 * land in different arrays on the wire.
 */
import { cls, el } from "../../dom";
import { createTextField } from "../controls/num-field";
import { createSegmented } from "../controls/segmented";
import { createSelect } from "../controls/select";
import type { Descriptor, EnumOption } from "../descriptors";
import {
  hasBackgroundImage,
  isImage,
  isRasterImage,
  isVideo,
} from "../element-kind";
import { readValue } from "../style-model";
import type { SectionContext } from "./context";
import { enumDescriptor, labelled } from "./row";

const POSITIONS: EnumOption[] = [
  { label: "Center", value: "50% 50%" },
  { label: "Top", value: "50% 0%" },
  { label: "Bottom", value: "50% 100%" },
  { label: "Left", value: "0% 50%" },
  { label: "Right", value: "100% 50%" },
  { label: "Top left", value: "0% 0%" },
  { label: "Top right", value: "100% 0%" },
  { label: "Bottom left", value: "0% 100%" },
  { label: "Bottom right", value: "100% 100%" },
];

const OBJECT_FIT = enumDescriptor(
  "objectFit",
  "object-fit",
  "Fit",
  [
    { label: "Fill", value: "fill" },
    { label: "Contain", value: "contain" },
    { label: "Cover", value: "cover" },
    { label: "None", value: "none" },
    { label: "Scale down", value: "scale-down" },
  ],
  "fill"
);

const BG_SIZE = enumDescriptor(
  "backgroundSize",
  "background-size",
  "Size",
  [
    { label: "Auto", value: "auto" },
    { label: "Cover", value: "cover" },
    { label: "Contain", value: "contain" },
    { label: "Stretch", value: "100% 100%" },
  ],
  "auto"
);

const BG_REPEAT = enumDescriptor(
  "backgroundRepeat",
  "background-repeat",
  "Repeat",
  [
    { label: "No repeat", value: "no-repeat" },
    { label: "Repeat", value: "repeat" },
    { label: "Repeat X", value: "repeat-x" },
    { label: "Repeat Y", value: "repeat-y" },
    { label: "Space", value: "space" },
    { label: "Round", value: "round" },
  ],
  "repeat"
);

const BG_ATTACHMENT = enumDescriptor(
  "backgroundAttachment",
  "background-attachment",
  "Attachment",
  [
    { label: "Scroll", value: "scroll" },
    { label: "Fixed", value: "fixed" },
    { label: "Local", value: "local" },
  ],
  "scroll"
);

const BG_CLIP = enumDescriptor(
  "backgroundClip",
  "background-clip",
  "Clip",
  [
    { label: "Border box", value: "border-box" },
    { label: "Padding box", value: "padding-box" },
    { label: "Content box", value: "content-box" },
    { label: "Text", value: "text" },
  ],
  "border-box"
);

/** Attribute toggles are yes/no, but the word differs — Show/Hide reads better
 * for `controls` than Yes/No does. */
function boolOptions(on: string, off: string): EnumOption[] {
  return [
    { label: on, value: "on" },
    { label: off, value: "off" },
  ];
}

function attrDescriptor(
  key: string,
  label: string,
  values: EnumOption[]
): Descriptor {
  return {
    controlType: "segmented",
    // A pseudo-property: this control writes an attribute, not a declaration,
    // and must never match a real CSS property on re-seed.
    cssProperty: `--attr-${key}`,
    defaultValue: "off",
    enumValues: values,
    group: "appearance",
    key,
    label,
    span: "full",
  };
}

export function renderMedia(ctx: SectionContext, node: Element): HTMLElement {
  const body = el("div", { class: cls("sect-body") });
  const image = isImage(node);
  const video = isVideo(node);

  if (image || video) {
    body.append(ctx.fieldCell(OBJECT_FIT, node));
    // Preset *plus* a field: `object-position: 20% 30%` matched no option, so any
    // interaction with the bare select snapped it to one of the nine.
    body.append(positionRow(ctx, node, "object-position", "Position"));
  }

  // `<img>` only, not every IMAGE_TAG: `<canvas>` has no alt/loading/decoding,
  // and on `<picture>` they belong to the inner `<img>`.
  if (isRasterImage(node)) {
    /*
     * The source attributes, which this section could not edit at all.
     *
     * `alt`, `loading` and `decoding` were the whole of it — so the one thing a designer
     * most often wants to change about an image, *which image it is*, had to be done in
     * the source. `srcset` and `sizes` come with it, because changing `src` without them
     * on a responsive image silently leaves the old art direction in place.
     */
    body.append(textAttr(ctx, node, "src", "Source"));
    body.append(textAttr(ctx, node, "srcset", "Srcset"));
    body.append(textAttr(ctx, node, "sizes", "Sizes"));
    body.append(textAttr(ctx, node, "alt", "Alt text"));
    body.append(
      attrToggle(ctx, node, "loading", "Loading", [
        { label: "Lazy", value: "lazy" },
        { label: "Eager", value: "eager" },
      ])
    );
    body.append(
      attrToggle(ctx, node, "decoding", "Decoding", [
        { label: "Auto", value: "auto" },
        { label: "Async", value: "async" },
        { label: "Sync", value: "sync" },
      ])
    );
  }

  if (video) {
    for (const [name, label, words] of [
      ["autoplay", "Autoplay", boolOptions("Yes", "No")],
      ["loop", "Loop", boolOptions("Yes", "No")],
      ["muted", "Muted", boolOptions("Yes", "No")],
      ["controls", "Controls", boolOptions("Show", "Hide")],
      ["playsinline", "Inline", boolOptions("Yes", "No")],
    ] as const) {
      body.append(booleanAttr(ctx, node, name, label, words));
    }
    // `src` for the same reason `<img>` has it — a `<video>` had a poster and no way to
    // change what it played.
    body.append(textAttr(ctx, node, "src", "Source"));
    body.append(textAttr(ctx, node, "poster", "Poster"));
  }

  if (hasBackgroundImage(node)) {
    body.append(el("div", { class: cls("sect-sub-head"), text: "Background" }));
    body.append(ctx.fieldCell(BG_SIZE, node));
    body.append(positionRow(ctx, node, "background-position", "Position"));
    for (const descriptor of [BG_REPEAT, BG_ATTACHMENT, BG_CLIP]) {
      body.append(ctx.fieldCell(descriptor, node));
    }
  }

  return ctx.section("media", video ? "Video" : "Image", body);
}

function textAttr(
  ctx: SectionContext,
  node: Element,
  attribute: string,
  label: string
): HTMLElement {
  const field = createTextField({
    label,
    placeholder: attribute === "alt" ? "Describe the image" : "",
  });
  const reflect = (): void => {
    field.input.value = node.getAttribute(attribute) ?? "";
  };
  reflect();
  let skipBlur = false;
  const commit = (): void => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    const value = field.input.value.trim();
    if (value === (node.getAttribute(attribute) ?? "")) {
      // Unchanged. Blur fires either way, and re-committing writes an attribute
      // edit — and a composer chip — for something the user only tabbed through.
      return;
    }
    ctx.onAttr(node, attribute, value === "" ? null : value);
  };
  field.input.addEventListener("blur", commit);
  field.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
      field.input.blur();
    } else if (e.key === "Escape") {
      /*
       * Every other field family in the panel reverts on Escape; this one had no
       * handler at all, so the key fell through to the registry and closed
       * whatever was open instead of undoing the typing. `skipBlur` is needed
       * because `blur()` would otherwise commit the value Escape just discarded —
       * the same guard `createNumField` and the CSS pane's rows already carry.
       */
      e.stopPropagation();
      reflect();
      skipBlur = true;
      field.input.blur();
    }
  });
  // Re-read on every refresh: an undo, or an agent edit that HMR brought back,
  // changes the attribute under a field that would otherwise keep showing — and
  // on the next blur re-commit — the old text.
  ctx.register({
    element: field.element,
    resync: reflect,
    setValue: () => undefined,
    virtual: true,
  });
  return labelled(label, field.element);
}

/** An attribute whose presence is the value (`autoplay`, `muted`). */
function booleanAttr(
  ctx: SectionContext,
  node: Element,
  attribute: string,
  label: string,
  values: EnumOption[]
): HTMLElement {
  const descriptor = attrDescriptor(attribute, label, values);
  const control = createSegmented(
    descriptor,
    node.hasAttribute(attribute) ? "on" : "off",
    () => {
      // No-op: `onSelect` owns the write.
    },
    {
      derive: () => (node.hasAttribute(attribute) ? "on" : "off"),
      onSelect: (value) =>
        ctx.onAttr(node, attribute, value === "on" ? "" : null),
      properties: [descriptor.cssProperty],
    }
  );
  ctx.register(control);
  return labelled(label, control.element);
}

/** An attribute with a value from a fixed set (`loading`, `decoding`). */
/**
 * A 9-preset position, plus a field for anything that is not one of the nine.
 *
 * The presets alone were a lossy control: `object-position: 20% 30%` matches no option,
 * so `createSelect` fell back to showing the raw string and *any* interaction snapped it
 * to a preset — a value the user could see but not keep. The field is the escape hatch,
 * and the presets stay because nine names are faster than typing two percentages.
 */
function positionRow(
  ctx: SectionContext,
  node: Element,
  property: string,
  label: string
): HTMLElement {
  const current = readValue(node, property).trim();
  const isPreset = POSITIONS.some((option) => option.value === current);
  const select = createSelect(
    enumDescriptor(property, property, label, POSITIONS, "50% 50%"),
    isPreset ? current : "",
    (_p, value) => {
      ctx.onChange(property, value);
      ctx.refresh();
    }
  );
  ctx.register({
    ...select,
    properties: [property],
    resync: () => {
      const next = readValue(node, property).trim();
      select.setValue(
        property,
        POSITIONS.some((o) => o.value === next) ? next : ""
      );
    },
    virtual: true,
  });

  const field = createTextField({
    label: `${label} — custom`,
    placeholder: "20% 30%",
  });
  field.input.value = isPreset ? "" : current;
  const commit = (): void => {
    const value = field.input.value.trim();
    if (value && value !== readValue(node, property).trim()) {
      ctx.onChange(property, value);
    }
  };
  field.input.addEventListener("blur", commit);
  field.input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      field.input.blur();
    } else if ((e as KeyboardEvent).key === "Escape") {
      e.stopPropagation();
      field.input.value = isPreset ? "" : current;
      field.input.blur();
    }
  });
  ctx.register({
    element: field.element,
    resync: () => {
      const next = readValue(node, property).trim();
      field.input.value = POSITIONS.some((o) => o.value === next) ? "" : next;
    },
    setValue: () => undefined,
    virtual: true,
  });

  return labelled(
    label,
    el("div", { class: cls("group") }, [select.element, field.element])
  );
}

function attrToggle(
  ctx: SectionContext,
  node: Element,
  attribute: string,
  label: string,
  values: EnumOption[]
): HTMLElement {
  const descriptor = attrDescriptor(attribute, label, values);
  /*
   * The element's own value, or nothing.
   *
   * Not `values[0].value`: falling back to the first option made an `<img>` with
   * no `loading` attribute display **Lazy**, which is the opposite of the HTML
   * default and a claim about the markup that the markup does not make. An
   * unmatched value leaves the select showing no option, which is the honest
   * reading of "not set".
   */
  const control = createSelect(
    descriptor,
    node.getAttribute(attribute) ?? "",
    (_property, value) => ctx.onAttr(node, attribute, value)
  );
  // `--attr-*` is panel state, not CSS — see `ControlHandle.virtual`. Re-seeding
  // read `""` for it and blanked the dropdown on the first arrow key. `resync`
  // is how it still follows an external change to the attribute.
  ctx.register({
    ...control,
    resync: () =>
      control.setValue(
        descriptor.cssProperty,
        node.getAttribute(attribute) ?? ""
      ),
    virtual: true,
  });
  return labelled(label, control.element);
}
