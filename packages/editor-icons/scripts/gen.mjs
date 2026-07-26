// Generates src/generated/icons.ts from the canonical ICONS.md front-matter.
// ICONS.md (this package's root) is the single source of truth; this keeps the
// TypeScript icon registry in lock-step with it. Run automatically before every
// build, mirroring @airship/editor-tokens' scripts/gen.mjs.
//
// The corpus is an imported UI set: mostly 24x24, filled
// paths, two-tone via fill-opacity. This script normalises it into something an
// overlay can inline safely — see ICONS.md's "What the generator normalises".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../ICONS.md");
const assetsRoot = resolve(here, "../assets");
const outPath = resolve(here, "../src/generated/icons.ts");

/**
 * Where one manifest entry's file lives.
 *
 * Paths are relative to `assets/ui`, the imported set, except for the
 * handful under `local/` — the marks that set does not carry (the brand mark,
 * the panel toggles, and the agent logos). They sit in the same manifest and go
 * through the same normalisation deliberately: authored separately they drifted
 * to a 16-unit inset against the set's 12.8, and nothing caught it.
 */
const assetPath = (rel) =>
  rel.startsWith("local/")
    ? resolve(assetsRoot, rel)
    : resolve(assetsRoot, "ui", rel);

/** Every manifest path is lowercase kebab, directories included. */
const ASSET_PATH = /^([a-z0-9]+(-[a-z0-9]+)*\/)*[a-z0-9]+(-[a-z0-9]+)*\.svg$/;

if (!existsSync(specPath)) {
  throw new Error(`gen: cannot find canonical manifest at ${specPath}`);
}

const raw = readFileSync(specPath, "utf8");
const match = raw.match(/^---\n([\s\S]*?)\n---/);
if (!match) {
  throw new Error("gen: ICONS.md is missing its YAML front-matter block");
}

const front = parse(match[1]);
const manifest = front?.icons;
if (!manifest) {
  throw new Error("gen: ICONS.md front-matter has no `icons:` section");
}
const budgetKb = Number(front.budget_kb) || Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Paint values that mean "the icon's own colour" and become `currentColor`.
 * `white` is NOT here: the 18 files that use it paint <clipPath>/<mask> rects,
 * which must stay opaque or the icon disappears. Neither is `#F24822`, which is
 * a semantic red on the one error glyph that carries it.
 */
const INK = new Set(["#1b1f24", "#007be5", "black"]);

/** The `<svg>` root and the pieces of it this script reads. */
const SVG_OPEN_TAG = /<svg\b([^>]*)>/i;
const SVG_TAG_NAME = /<svg\b/i;
const VIEWBOX_ATTR = /viewBox\s*=\s*"([^"]*)"/i;
/** A viewBox separates its four numbers with spaces, commas, or both. */
const VIEWBOX_SEPARATOR = /[\s,]+/;
/** Elements whose contents are definitions rather than painted geometry. */
const DEFS_TAG =
  /^(defs|clipPath|mask|linearGradient|radialGradient|pattern|filter)$/i;
/** A trailing `.` or run of zeros left behind by `toFixed`. */
const TRAILING_ZEROS = /\.?0+$/;

/** Round every number in an attribute value to 2 dp. ~26% smaller, no change. */
function roundNumbers(value) {
  return value.replace(/-?\d*\.\d+/g, (n) => {
    const r = Number.parseFloat(n);
    // `toFixed` then strip the trailing zeros it adds: 6.20 -> 6.2, 6.00 -> 6.
    const fixed = r.toFixed(2).replace(TRAILING_ZEROS, "");
    return fixed === "" || fixed === "-" ? "0" : fixed;
  });
}

/** Attributes whose values are geometry and therefore worth rounding. */
const GEOMETRY_ATTRS = new Set([
  "d",
  "points",
  "transform",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "offset",
  "stroke-width",
  "stroke-dasharray",
]);

/**
 * The tone a glyph's subject paints at.
 *
 * The set's two-tone grammar is 0.9 for the subject and 0.3 for the context it
 * sits in — the Constraints and Auto Layout glyphs draw their frame at 0.3 and
 * the meaningful part at 0.9. But it was only applied to some of the corpus:
 * 146 icons had at least one element carrying no opacity at all, so they painted
 * at 100% beside neighbours at 90%. That is the same "one of these looks heavier
 * than the others" problem as the size drift, one property over.
 *
 * So an element that names `currentColor` and states no opacity gets the subject
 * tone. Explicit values are never touched, which is what keeps the 0.3 context
 * paths intact rather than flattening the two-tone into mush.
 */
const SUBJECT_TONE = "0.9";

/**
 * Give an element the subject tone if it paints and has not chosen one.
 *
 * Applied per element rather than on the refit `<g>`: opacity inherited from a
 * group *multiplies* with the child's own, so a group at 0.9 would drag the
 * 0.3 context paths down to 0.27 and quietly re-tune every two-tone glyph.
 */
function applySubjectTone(attrs) {
  let out = attrs;
  for (const channel of ["fill", "stroke"]) {
    const paints = new RegExp(`\\b${channel}="currentColor"`).test(out);
    const stated = new RegExp(`\\b${channel}-opacity=`).test(out);
    if (paints && !stated) {
      out += ` ${channel}-opacity="${SUBJECT_TONE}"`;
    }
  }
  return out;
}

/**
 * Rewrite one element's attributes.
 *
 * `inDefs` is the whole reason this walks tags rather than running a global
 * regex: inside <defs> the fills are structural (a mask's white rect is what
 * makes the mask show anything), so paint there must be left exactly as-is.
 */
function rewriteAttrs(attrs, { slug, inDefs, ids }) {
  return attrs.replace(
    /([:\w-]+)\s*=\s*"([^"]*)"/g,
    (_whole, name, valueRaw) => {
      const key = name.toLowerCase();
      let value = valueRaw;

      if (key === "xmlns" || key === "xmlns:xlink") {
        return "";
      }
      if (
        (key === "fill" || key === "stroke") &&
        !inDefs &&
        INK.has(value.trim().toLowerCase())
      ) {
        value = "currentColor";
      }
      if (key === "id") {
        ids.add(value);
        value = `ap-${slug}-${value}`;
      }
      if (GEOMETRY_ATTRS.has(key)) {
        value = roundNumbers(value);
      }
      // url(#x), href="#x", xlink:href="#x" — every way an id is referenced.
      if (value.includes("#")) {
        value = value.replace(/url\(#([^)]+)\)/g, (_m, id) => {
          ids.add(id);
          return `url(#ap-${slug}-${id})`;
        });
        if ((key === "href" || key === "xlink:href") && value.startsWith("#")) {
          const id = value.slice(1);
          ids.add(id);
          value = `#ap-${slug}-${id}`;
        }
      }
      return `${name}="${value}"`;
    }
  );
}

/** An icon that paints with a stroke rather than a fill. */
const STROKE_PAINT = /stroke="currentColor"/;

/** A path command letter, as opposed to one of its numeric operands. */
const PATH_COMMAND = /^[MmLlHhVvCcSsQqTtAaZz]$/;
/** Command letters and numbers, exponent notation included. */
const PATH_TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi;

/** Evaluate one axis of a cubic at `t`. */
function cubicAt(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/**
 * The `t` values in (0,1) where one axis of a cubic turns around.
 *
 * The derivative is the quadratic `3(At² + Bt + C)`; the leading term vanishes
 * whenever the four coordinates are in arithmetic progression, which is common
 * enough in machine-drawn artwork to be worth the explicit linear branch.
 */
function cubicRoots(a, b, c, d) {
  const A = -a + 3 * b - 3 * c + d;
  const B = 2 * (a - 2 * b + c);
  const C = b - a;
  const out = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) {
      out.push(-C / B);
    }
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      out.push((-B + root) / (2 * A), (-B - root) / (2 * A));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Report a cubic segment's endpoints and its true extrema. */
function seeCubic(x0, y0, x1, y1, x2, y2, x3, y3, see) {
  see(x0, y0);
  see(x3, y3);
  const ts = [...cubicRoots(x0, x1, x2, x3), ...cubicRoots(y0, y1, y2, y3)];
  for (const t of ts) {
    see(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
  }
}

/** Report a quadratic segment's endpoints and its true extrema. */
function seeQuadratic(x0, y0, x1, y1, x2, y2, see) {
  // Degree-elevate to a cubic rather than repeat the root-finding.
  seeCubic(
    x0,
    y0,
    x0 + (2 / 3) * (x1 - x0),
    y0 + (2 / 3) * (y1 - y0),
    x2 + (2 / 3) * (x1 - x2),
    y2 + (2 / 3) * (y1 - y2),
    x2,
    y2,
    see
  );
}

/** Signed angle between two vectors, per SVG's arc-conversion appendix. */
function vectorAngle(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(Math.min(1, Math.max(-1, dot / len)));
}

/**
 * Report an elliptical arc's endpoints and any axis extreme it actually sweeps
 * through.
 *
 * Endpoint-to-centre conversion is SVG 1.1 appendix F.6.5 verbatim, including
 * the radius correction for arcs whose endpoints are further apart than the
 * given radii can reach. The source exporter never emits arcs, but the marks drawn
 * by hand for this set do, and a rounded corner clipped out of the box would
 * scale the whole glyph wrong.
 */
function seeArc(x1, y1, rxIn, ryIn, rotDeg, largeArc, sweep, x2, y2, see) {
  see(x1, y1);
  see(x2, y2);
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cosP * dx + sinP * dy;
  const yp = -sinP * dx + cosP * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co =
    (largeArc === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator / den || 0));
  const cxp = (co * (rx * yp)) / ry;
  const cyp = (-co * (ry * xp)) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const theta = vectorAngle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let sweepAngle = vectorAngle(
    (xp - cxp) / rx,
    (yp - cyp) / ry,
    (-xp - cxp) / rx,
    (-yp - cyp) / ry
  );
  if (!sweep && sweepAngle > 0) {
    sweepAngle -= 2 * Math.PI;
  } else if (sweep && sweepAngle < 0) {
    sweepAngle += 2 * Math.PI;
  }
  const TWO_PI = 2 * Math.PI;
  const sweeps = (t) => {
    let delta = (t - theta) % TWO_PI;
    if (sweepAngle >= 0) {
      if (delta < 0) {
        delta += TWO_PI;
      }
      return delta <= sweepAngle + 1e-9;
    }
    if (delta > 0) {
      delta -= TWO_PI;
    }
    return delta >= sweepAngle - 1e-9;
  };
  // Where dx/dθ and dy/dθ vanish, plus their antipodes.
  const bases = [
    Math.atan2(-ry * sinP, rx * cosP),
    Math.atan2(ry * cosP, rx * sinP),
  ];
  for (const base of bases) {
    for (let k = -2; k <= 2; k += 1) {
      const t = base + k * Math.PI;
      if (sweeps(t)) {
        see(
          cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
          cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP
        );
      }
    }
  }
}

/** Coordinate pairs made absolute against the current point. */
function absolutise(state, args, rel) {
  return args.map((n, k) =>
    rel ? n + (k % 2 === 0 ? state.cx : state.cy) : n
  );
}

/**
 * One entry per path command: how many operands it takes, and what it draws.
 *
 * A table rather than a chain of branches because the walker's only real job is
 * operand bookkeeping — arity, the relative-versus-absolute offset, and which
 * coordinates become the new current point. Each handler is then just the
 * geometry it owns, and adding a command is adding a row.
 */
const PATH_OPS = {
  A: {
    // rx ry rotation large-arc-flag sweep-flag x y — only the last pair is a
    // coordinate, which is why this one does its own offsetting.
    arity: 7,
    run(state, args, rel) {
      const [rx, ry, rotation, largeArc, sweep, rawX, rawY] = args;
      const x = rel ? state.cx + rawX : rawX;
      const y = rel ? state.cy + rawY : rawY;
      seeArc(
        state.cx,
        state.cy,
        rx,
        ry,
        rotation,
        largeArc !== 0,
        sweep !== 0,
        x,
        y,
        state.see
      );
      state.cx = x;
      state.cy = y;
    },
  },
  C: {
    arity: 6,
    run(state, args, rel) {
      const [x1, y1, x2, y2, x, y] = absolutise(state, args, rel);
      seeCubic(state.cx, state.cy, x1, y1, x2, y2, x, y, state.see);
      state.ctrlX = x2;
      state.ctrlY = y2;
      state.cx = x;
      state.cy = y;
    },
  },
  H: {
    arity: 1,
    run(state, [x], rel) {
      state.cx = rel ? state.cx + x : x;
      state.see(state.cx, state.cy);
    },
  },
  L: {
    arity: 2,
    run(state, [x, y], rel) {
      state.cx = rel ? state.cx + x : x;
      state.cy = rel ? state.cy + y : y;
      state.see(state.cx, state.cy);
    },
  },
  M: {
    arity: 2,
    run(state, [x, y], rel) {
      state.cx = rel ? state.cx + x : x;
      state.cy = rel ? state.cy + y : y;
      state.sx = state.cx;
      state.sy = state.cy;
      state.see(state.cx, state.cy);
    },
  },
  Q: {
    arity: 4,
    run(state, args, rel) {
      const [x1, y1, x, y] = absolutise(state, args, rel);
      seeQuadratic(state.cx, state.cy, x1, y1, x, y, state.see);
      state.ctrlX = x1;
      state.ctrlY = y1;
      state.cx = x;
      state.cy = y;
    },
  },
  S: {
    arity: 4,
    run(state, args, rel) {
      const [x2, y2, x, y] = absolutise(state, args, rel);
      // The first control point is the previous curve's trailing one, mirrored
      // through the current point — or the current point itself if the command
      // before this was not a cubic.
      const smooth = state.prev === "C" || state.prev === "S";
      const x1 = smooth ? 2 * state.cx - state.ctrlX : state.cx;
      const y1 = smooth ? 2 * state.cy - state.ctrlY : state.cy;
      seeCubic(state.cx, state.cy, x1, y1, x2, y2, x, y, state.see);
      state.ctrlX = x2;
      state.ctrlY = y2;
      state.cx = x;
      state.cy = y;
    },
  },
  T: {
    arity: 2,
    run(state, args, rel) {
      const [x, y] = absolutise(state, args, rel);
      const smooth = state.prev === "Q" || state.prev === "T";
      const x1 = smooth ? 2 * state.cx - state.ctrlX : state.cx;
      const y1 = smooth ? 2 * state.cy - state.ctrlY : state.cy;
      seeQuadratic(state.cx, state.cy, x1, y1, x, y, state.see);
      state.ctrlX = x1;
      state.ctrlY = y1;
      state.cx = x;
      state.cy = y;
    },
  },
  V: {
    arity: 1,
    run(state, [y], rel) {
      state.cy = rel ? state.cy + y : y;
      state.see(state.cx, state.cy);
    },
  },
  Z: {
    arity: 0,
    run(state) {
      state.cx = state.sx;
      state.cy = state.sy;
    },
  },
};

/**
 * Walk one `d` attribute, reporting every point the outline actually reaches.
 *
 * The whole command set, absolute and relative, because this now measures every
 * glyph in the set rather than the ~12% of odd-sized exports it used to — and
 * because the hand-drawn marks use arcs and relative commands that the source
 * exporter does not.
 */
function walkPath(d, see) {
  const toks = d.match(PATH_TOKEN) ?? [];
  const state = {
    ctrlX: 0,
    ctrlY: 0,
    cx: 0,
    cy: 0,
    prev: "",
    see,
    sx: 0,
    sy: 0,
  };
  let i = 0;
  let cmd = "";
  while (i < toks.length) {
    if (PATH_COMMAND.test(toks[i])) {
      cmd = toks[i];
      i += 1;
    } else if (!cmd) {
      i += 1;
      continue;
    }
    const upper = cmd.toUpperCase();
    const op = PATH_OPS[upper];
    if (!op) {
      i += 1;
      continue;
    }
    const args = toks.slice(i, i + op.arity).map(Number);
    i += op.arity;
    op.run(state, args, cmd !== upper);
    state.prev = upper;
    if (upper === "M") {
      // Extra coordinate pairs after a moveto are implicit linetos.
      cmd = cmd === "M" ? "L" : "l";
    } else if (upper === "Z") {
      // Z takes no operands, so leaving it current would spin on a stray
      // number. A closepath is always followed by a command in valid data.
      cmd = "";
    }
  }
}

/** Every `name="value"` pair on one element. */
const ATTR_PAIR = /([:\w-]+)\s*=\s*"([^"]*)"/g;
/** `translate(…)`/`scale(…)` and their operands, in source order. */
const TRANSFORM_FN = /(translate|scale)\(([^)]*)\)/g;
/** Signed decimals, for a transform's operand list. */
const TRANSFORM_ARG = /-?[\d.]+(?:e[-+]?\d+)?/gi;
/** One element, opening or closing, with its attributes. */
const TAG = /<(\/?)([\w:-]+)((?:\s+[^>]*?)?)(\/?)>/g;

/**
 * An element's attributes as a plain object, lower-cased.
 *
 * Parsed once per element rather than probed with a `new RegExp` per lookup —
 * this runs for every tag of every icon on every build.
 */
function attrsOf(text) {
  const out = {};
  for (const m of text.matchAll(ATTR_PAIR)) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** One attribute as a number, or `fallback` when absent or unparseable. */
function num(attrs, name, fallback = Number.NaN) {
  const v = attrs[name];
  if (v === undefined) {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** `outer ∘ inner` — the transform mapping a point through both. */
function composeTransform(outer, inner) {
  return {
    ax: outer.ax * inner.ax,
    ay: outer.ay * inner.ay,
    tx: outer.ax * inner.tx + outer.tx,
    ty: outer.ay * inner.ty + outer.ty,
  };
}

/**
 * One element's `transform` as `{ ax, ay, tx, ty }`.
 *
 * Functions compose right-to-left — `translate(a) scale(b)` scales first — so
 * the list folds in source order with each new function on the inside. Only
 * `translate` and `scale` ever appear, so a transform is four numbers and
 * composition stays closed; no matrix type is needed.
 */
function parseTransform(attrs) {
  let out = { ax: 1, ay: 1, tx: 0, ty: 0 };
  const spec = attrs.transform;
  if (!spec) {
    return out;
  }
  for (const m of spec.matchAll(TRANSFORM_FN)) {
    const args = (m[2].match(TRANSFORM_ARG) ?? []).map(Number);
    const fn =
      m[1] === "translate"
        ? { ax: 1, ay: 1, tx: args[0] ?? 0, ty: args[1] ?? 0 }
        : { ax: args[0] ?? 1, ay: args[1] ?? args[0] ?? 1, tx: 0, ty: 0 };
    out = composeTransform(out, fn);
  }
  return out;
}

/** Report one leaf shape's extreme points, in its own coordinate space. */
function seeShape(tag, attrs, see) {
  if (tag === "path") {
    if (attrs.d) {
      walkPath(attrs.d, see);
    }
    return;
  }
  if (tag === "rect") {
    const w = num(attrs, "width");
    const h = num(attrs, "height");
    if (Number.isFinite(w) && Number.isFinite(h)) {
      const x = num(attrs, "x", 0);
      const y = num(attrs, "y", 0);
      see(x, y);
      see(x + w, y + h);
    }
    return;
  }
  if (tag === "circle" || tag === "ellipse") {
    const rx = tag === "circle" ? num(attrs, "r") : num(attrs, "rx");
    const ry = tag === "circle" ? num(attrs, "r") : num(attrs, "ry");
    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      const cx = num(attrs, "cx", 0);
      const cy = num(attrs, "cy", 0);
      see(cx - rx, cy - ry);
      see(cx + rx, cy + ry);
    }
  }
}

/** Elements whose geometry defines something rather than painting it. */
function isStructural(tag) {
  return tag === "defs" || tag === "clippath" || tag === "mask";
}

/** Unwind one closing tag. */
function closeTag(tag, ctx) {
  if (isStructural(tag)) {
    ctx.skipDepth = Math.max(0, ctx.skipDepth - 1);
  } else if (tag === "g" && ctx.stack.length > 1) {
    ctx.stack.pop();
  }
}

/** Fold one tag into the measuring walk. */
function applyTag(m, ctx) {
  const [, slash, tagRaw, attrText, selfClose] = m;
  const tag = tagRaw.toLowerCase();
  if (slash) {
    closeTag(tag, ctx);
    return;
  }
  if (isStructural(tag)) {
    ctx.skipDepth += selfClose ? 0 : 1;
    return;
  }
  if (tag === "g") {
    // Pushed even inside a skipped subtree, so the pops stay balanced.
    if (!selfClose) {
      ctx.stack.push(
        composeTransform(ctx.top(), parseTransform(attrsOf(attrText)))
      );
    }
    return;
  }
  if (ctx.skipDepth === 0) {
    seeShape(tag, attrsOf(attrText), ctx.see);
  }
}

/**
 * The artwork's exact bounding box, in the source file's own coordinates.
 *
 * Two things this gets right that a coordinate-pair scan does not, and both
 * matter now that the box scales *every* glyph rather than the odd-sized few:
 *
 * - Curves contribute their extrema, not their control points. A control point
 *   can sit well outside the ink it shapes, and `H`/`V` operands are single
 *   numbers that a pair-wise scan drops entirely — 297 of the 346 glyphs use
 *   them, and a pure `M6.5 11.5H17.5` measured 0×0.
 * - `<defs>`, `<clipPath>` and `<mask>` are excluded. Their geometry is
 *   structural: a mask's white rect is full-bleed by construction, and the
 *   `toolbar/move.svg` mask alone spans 17 of its 24 units.
 *
 * Stroke width is deliberately *not* added here; `centrelineTarget` accounts
 * for it once, at the point where the scale is chosen.
 *
 * `<g transform>` is honoured, which is what lets the same function measure an
 * icon this script has already refit — the verification pass at the end reads
 * the emitted markup rather than trusting the transform it just wrote.
 */
function artworkBox(body) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const stack = [{ ax: 1, ay: 1, tx: 0, ty: 0 }];
  const top = () => stack.at(-1);
  const see = (x, y) => {
    const t = top();
    const px = t.ax * x + t.tx;
    const py = t.ay * y + t.ty;
    if (Number.isFinite(px) && Number.isFinite(py)) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  };

  const ctx = { see, skipDepth: 0, stack, top };
  TAG.lastIndex = 0;
  let m = TAG.exec(body);
  while (m) {
    applyTag(m, ctx);
    m = TAG.exec(body);
  }

  if (!Number.isFinite(minX)) {
    return null;
  }
  return { h: maxY - minY, w: maxX - minX, x: minX, y: minY };
}

/**
 * The reference box, and the optical size the artwork occupies inside it.
 *
 * The set insets its glyphs heavily and that inset *is* its visual rhythm,
 * but it is a rhythm the corpus only keeps on average. Measured properly the
 * artwork spans anywhere from 7 to 24 of the 24 units — a median of 13.0 and a
 * p90 of 16.0 — so "already 24×24" was never the same thing as "already at the
 * reference size". Icons drawn from both ends of that spread landed side by side
 * in the bottom bar at a 2.6× difference in painted ink.
 *
 * So every glyph is measured and mapped onto this one number, and
 * `icon(name, "md")` now means one optical size everywhere. The cost is that
 * artwork which happened to sit on the pixel grid no longer does; the set is
 * filled silhouettes rather than hairlines, which is what makes that affordable.
 */
const REF_BOX = 24;
const REF_ARTWORK = 12.8;

/**
 * Stroke weight on the reference box, in user units.
 *
 * The 26 stroked glyphs declare no `stroke-width`, so they inherit 1 unit — and
 * the refit `<g>` then scales it along with the geometry. Left alone that makes
 * stroke weight a function of how big the source artwork happened to be drawn:
 * `chev-down` came out at 3.02 units against its neighbours' 1.0. Pinning the
 * width on the group and dividing by the scale cancels the transform exactly, so
 * every stroked glyph paints the same weight as every other.
 */
const STROKE_REF = 1.5;

/** `translate(tx ty) scale(s)` centring a glyph's artwork at `target` units. */
function fitTransform(art, target) {
  const scale = target / Math.max(art.w, art.h);
  const r3 = (n) => Number(n.toFixed(3));
  const tx = r3(REF_BOX / 2 - scale * (art.x + art.w / 2));
  const ty = r3(REF_BOX / 2 - scale * (art.y + art.h / 2));
  return { scale, transform: `translate(${tx} ${ty}) scale(${r3(scale)})` };
}

/**
 * The span a glyph's *centrelines* must occupy for its painted extent to be
 * `REF_ARTWORK`.
 *
 * A fill's edge is its path; a stroke's edge is half a stroke-width outside its
 * path on either side. Measuring both as their geometry and scaling both to the
 * same number would leave every stroked glyph a full stroke bigger than the
 * filled ones beside it — which is the same class of mismatch this whole pass
 * exists to remove, just one level down.
 */
function centrelineTarget(stroked) {
  return stroked ? REF_ARTWORK - STROKE_REF : REF_ARTWORK;
}

/**
 * Normalise one SVG file into `{ box, body }`.
 *
 * Deliberately a tag-level rewrite rather than a real XML parse: the corpus is
 * machine-generated by the source exporter and uniformly well-formed, and pulling
 * in a DOM implementation for a build script that only ever touches attributes
 * would be the more fragile choice.
 */
function normalise(slug, source, file) {
  const rootMatch = source.match(SVG_OPEN_TAG);
  if (!rootMatch) {
    throw new Error(`gen: ${file} has no <svg> root`);
  }
  const viewBox = rootMatch[1].match(VIEWBOX_ATTR);
  if (!viewBox) {
    // A shared default would silently squash the ~40 non-24 icons in this set.
    throw new Error(
      `gen: ${file} has no viewBox — cannot infer a safe default`
    );
  }
  const nums = viewBox[1].trim().split(VIEWBOX_SEPARATOR).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`gen: ${file} has an unparseable viewBox "${viewBox[1]}"`);
  }
  const [minX, minY] = nums;
  if (minX !== 0 || minY !== 0) {
    throw new Error(`gen: ${file} has a non-zero viewBox origin — unsupported`);
  }

  const open = source.indexOf(">", source.search(SVG_TAG_NAME)) + 1;
  const close = source.lastIndexOf("</svg>");
  let body = source.slice(open, close);

  const ids = new Set();
  let defsDepth = 0;
  body = body.replace(
    /<(\/?)([\w:-]+)((?:\s+[^>]*?)?)(\/?)>/g,
    (_whole, slash, tag, attrs, selfClose) => {
      const isDefs = DEFS_TAG.test(tag);
      if (slash) {
        if (isDefs) {
          defsDepth = Math.max(0, defsDepth - 1);
        }
        return `</${tag}>`;
      }
      // A <clipPath> element's own attributes (its id) are rewritten as normal;
      // only its *children* count as "in defs" for paint purposes.
      const next = rewriteAttrs(attrs, { ids, inDefs: defsDepth > 0, slug });
      const toned = defsDepth > 0 ? next : applySubjectTone(next);
      if (isDefs && !selfClose) {
        defsDepth += 1;
      }
      const clean = toned.replace(/\s+/g, " ").trim();
      return `<${tag}${clean ? ` ${clean}` : ""}${selfClose ? "/" : ""}>`;
    }
  );

  body = body.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

  // Warn on paint we chose not to touch, so a future set change is visible.
  const exotic = [...body.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,8})"/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((c) => c !== "#fff" && c !== "#ffffff");
  if (exotic.length) {
    warnings.push(
      `${slug}: kept literal paint ${[...new Set(exotic)].join(", ")}`
    );
  }

  // Everything lands on one box at one optical size — including the glyphs that
  // were already 24×24, which is the whole point. `w`/`h` are not consulted:
  // the source viewBox says where the artwork was drawn, never how big it is.
  const art = artworkBox(body);
  if (!art) {
    throw new Error(
      `gen: ${file} has no measurable artwork, ` +
        "so it cannot be brought onto the 24 box"
    );
  }
  const span = Math.max(art.w, art.h);
  if (!(span > 0)) {
    // A single point, or geometry the walker could not read. Scaling by
    // `REF_ARTWORK / 0` would emit an `Infinity` transform and erase the glyph.
    throw new Error(
      `gen: ${file} measures ${art.w}×${art.h} — degenerate artwork cannot be ` +
        "scaled onto the reference"
    );
  }
  // Only stroked glyphs need the width pinned; adding it unconditionally would
  // put a dead attribute on every filled icon in the set.
  const stroked = STROKE_PAINT.test(body);
  const { scale, transform } = fitTransform(art, centrelineTarget(stroked));
  const strokeAttr = stroked
    ? ` stroke-width="${Number((STROKE_REF / scale).toFixed(3))}"`
    : "";
  return {
    body: `<g transform="${transform}"${strokeAttr}>${body}</g>`,
    box: REF_BOX,
    ids: ids.size,
    refit: true,
    span,
    stroked,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const warnings = [];
const icons = [];
const missing = [];

for (const [slug, relPath] of Object.entries(manifest)) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`gen: slug "${slug}" is not kebab-case`);
  }
  // The asset paths are held to the same grammar as the slugs. This is not
  // cosmetic: dev is a case-insensitive filesystem, so `existsSync` below
  // happily resolves `General/X.svg` against `general/x.svg` and a stale
  // manifest entry survives every check until CI checks out on Linux. This
  // assert is the only thing that catches it here.
  if (!ASSET_PATH.test(relPath)) {
    throw new Error(`gen: asset path "${relPath}" is not lowercase kebab-case`);
  }
  const file = assetPath(relPath);
  if (!existsSync(file)) {
    missing.push(`${slug} -> ${relPath}`);
    continue;
  }
  icons.push([slug, normalise(slug, readFileSync(file, "utf8"), relPath)]);
}

if (missing.length) {
  throw new Error(
    `gen: ${missing.length} manifest entries point at files that do not exist:\n  ${missing.join("\n  ")}`
  );
}

icons.sort(([a], [b]) => a.localeCompare(b));

const banner =
  "// AUTO-GENERATED from /packages/editor-icons/ICONS.md + assets/ui by scripts/gen.mjs.\n" +
  "// Do not edit by hand — edit ICONS.md and run `pnpm --filter @airship/editor-icons gen`.\n\n";

const entries = icons
  .map(([slug, { box, body }]) => {
    // Bodies contain double quotes and no backticks or ${, so a template
    // literal is the one quoting style that needs no escaping at all.
    return `  "${slug}": { box: ${box}, body: \`${body}\` },`;
  })
  .join("\n");

const out = `${banner}export interface EditorIcon {
  /**
   * The reference viewBox, always ${REF_BOX}. Stored rather than assumed so the
   * renderer has no constant of its own to keep in step, and so changing
   * \`REF_BOX\` is a one-line change here rather than a hunt across packages.
   *
   * It used to be \`number | readonly [number, number]\`, back when odd-ratio
   * exports kept their own aspect and the renderer derived a width from it.
   * Nothing has a non-square box any more — every glyph is refit — so that
   * union only ever widened the type.
   */
  box: ${REF_BOX};
  /**
   * Inner markup: paint normalised to \`currentColor\`, element ids namespaced
   * per icon, coordinates rounded to 2dp. \`fill-opacity\` is preserved — the
   * 0.9/0.3 two-tone is the set's most recognisable property.
   */
  body: string;
}

export const EDITOR_ICONS = {
${entries}
} as const satisfies Record<string, EditorIcon>;

export type EditorIconName = keyof typeof EDITOR_ICONS;
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const markup = icons.reduce((n, [, i]) => n + i.body.length, 0);
const gz = gzipSync(Buffer.from(icons.map(([, i]) => i.body).join(""))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const byPrefix = new Map();
for (const [slug, icon] of icons) {
  const key = slug.includes("-") ? `${slug.split("-")[0]}-*` : "(root)";
  byPrefix.set(key, (byPrefix.get(key) ?? 0) + icon.body.length);
}
const top = [...byPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

console.log(`gen: wrote ${outPath}`);
console.log(
  `gen: ${icons.length} icons, ${kb(markup)} markup (${kb(gz)} gzipped)`
);
console.log(
  `gen: largest groups — ${top.map(([k, v]) => `${k} ${kb(v)}`).join(", ")}`
);
const withIds = icons.filter(([, i]) => i.ids > 0);
if (withIds.length) {
  console.log(
    `gen: namespaced ids in ${withIds.length} icons (${withIds.map(([s]) => s).join(", ")})`
  );
}
// How far the corpus had drifted, reported as the spread that was corrected —
// the interesting number now that every glyph is refit by construction.
const spans = icons.map(([, i]) => i.span).sort((a, b) => a - b);
const at = (p) => spans[Math.floor(p * (spans.length - 1))];
console.log(
  `gen: refit all ${icons.length} icons onto the ${REF_BOX} box at ` +
    `${REF_ARTWORK} units — source spans ran ${spans[0].toFixed(1)}..` +
    `${spans.at(-1).toFixed(1)} (median ${at(0.5).toFixed(1)})`
);
const strokedIcons = icons.filter(([, i]) => i.body.includes("stroke-width="));
if (strokedIcons.length) {
  console.log(
    `gen: pinned stroke weight to ${STROKE_REF} units on ${strokedIcons.length} stroked icons`
  );
}
for (const w of warnings) {
  console.warn(`gen: warning — ${w}`);
}

/*
 * Prove the refit actually landed, by measuring the emitted markup rather than
 * trusting the transform we just wrote. This is the guard that would have caught
 * the original drift: "already 24×24" was taken as "already at the reference
 * size" for 300 glyphs, and nothing ever checked.
 */
const EPSILON = 0.01;
const offReference = [];
for (const [slug, icon] of icons) {
  const art = artworkBox(icon.body);
  // Painted extent, not geometry: a stroke reaches half its width past the path
  // it follows, which is exactly what `centrelineTarget` set the scale to allow.
  const painted = art
    ? Math.max(art.w, art.h) + (icon.stroked ? STROKE_REF : 0)
    : Number.NaN;
  if (!(Math.abs(painted - REF_ARTWORK) <= EPSILON)) {
    offReference.push(
      `${slug} (${Number.isFinite(painted) ? painted.toFixed(2) : "unmeasurable"})`
    );
  }
}
if (offReference.length) {
  throw new Error(
    `gen: ${offReference.length} icons did not land on the ${REF_ARTWORK}-unit ` +
      `reference: ${offReference.join(", ")}`
  );
}

if (markup / 1024 > budgetKb) {
  throw new Error(
    `gen: ${kb(markup)} of icon markup exceeds budget_kb: ${budgetKb}. ` +
      "Either drop icons from ICONS.md or raise the budget deliberately — " +
      "these are cold-start bytes on every page load."
  );
}
