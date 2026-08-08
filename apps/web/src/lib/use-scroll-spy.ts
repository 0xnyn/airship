import { useEffect, useState } from "react";

/**
 * The id of the section currently being read, for the table of contents.
 *
 * `rootMargin: "-20% 0px -60% 0px"` shrinks the observer's viewport to a band
 * across the upper-middle of the screen. Without it, a tall section and a short
 * one are both "intersecting" for most of a scroll and the indicator flickers
 * between them; with it, exactly the section under that band is active, which is
 * the one a reader is actually looking at.
 *
 * @param ids Section ids to watch, in document order.
 */
export function useScrollSpy(ids: readonly string[]): string {
  const [active, setActive] = useState("");

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => {
      observer.disconnect();
    };
    // `ids` is a module-level constant tuple at every call site; joining it keeps
    // the effect from re-subscribing on every render without disabling the rule.
  }, [ids]);

  return active;
}
