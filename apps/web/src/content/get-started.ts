import getStarted from "#/content/get-started.json";
import { fill } from "#/content/resolve";

export interface GetStartedStep {
  code: string;
  /** Shown top-right of the code block; omit when there is nothing to copy. */
  copyable: boolean;
  id: string;
  /** Rendered under the block, 13px, secondary. */
  note?: string;
  title: string;
}

export const GET_STARTED: readonly GetStartedStep[] = getStarted.steps.map(
  (step) => ({
    code: fill(step.code),
    copyable: step.copyable,
    id: step.id,
    note: step.note,
    title: step.title,
  })
);

export const GET_STARTED_SECTION = {
  compat: fill(getStarted.compat),
  desc: getStarted.desc,
  heading: getStarted.heading,
};
