import { oneOf } from "#/content/resolve";
import steps from "#/content/steps.json";

/*
 * The two things that distinguish airship from "an AI that edits your code".
 * Each is a claim the README and packages/ actually back.
 *
 * There were three. "Frames are real viewports, not screenshots" was its own
 * entry and is now the second half of the proxy card, because the two are one
 * mechanism stated twice: the proxy is what makes a frame a same-origin iframe,
 * and a same-origin iframe at a device width is what makes it a real viewport
 * rather than a picture of one. Splitting them made the page count to three
 * where the product only does two things.
 */

/** The illustrations components/figures can draw. */
export const STEP_FIGURES = ["proxy", "source"] as const;

export type StepFigure = (typeof STEP_FIGURES)[number];

export interface Step {
  body: string;
  /**
   * Which figure the card draws. A key rather than a component, so steps.json
   * stays free of code — and validated here, because JSON widens it to `string`
   * and an unknown value would otherwise render a card with an empty top half.
   */
  figure: StepFigure;
  id: string;
  title: string;
}

export const STEPS: readonly Step[] = steps.steps.map((step) => ({
  body: step.body,
  figure: oneOf(STEP_FIGURES, step.figure, `figure on step "${step.id}"`),
  id: step.id,
  title: step.title,
}));

export const STEPS_SECTION = {
  desc: steps.desc,
  heading: steps.heading,
};
