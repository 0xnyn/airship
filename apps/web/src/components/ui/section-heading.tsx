/**
 * A section's heading and its one line of framing.
 *
 * Always an `<h2>`: every section on this page is a peer of every other, under
 * the single `<h1>` in the hero. Rendering the level as a prop would invite a
 * hierarchy this page does not have.
 */
export function SectionHeading({
  desc,
  title,
}: {
  desc?: string;
  title: string;
}) {
  return (
    <>
      <h2 className="section-heading">{title}</h2>
      {desc ? <p className="section-desc">{desc}</p> : null}
    </>
  );
}
