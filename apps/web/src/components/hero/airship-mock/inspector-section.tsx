import type { ReactNode } from "react";
import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";

/**
 * One collapsible section of the inspector.
 *
 * The header puts its title first and its chevron last, so every arrow in the
 * panel lines up in a single column down the right edge however long the title
 * is. That is a deliberate choice in the real panel and it is the detail that
 * makes a stack of twelve sections read as one control rather than twelve.
 *
 * A section with no `children` renders header-only — which is also what the real
 * panel does for SOURCE and FILTERS, and what keeps this mock legible: at the
 * hero's render scale, twelve expanded sections would be grey noise.
 */
export function InspectorSection({
  children,
  className,
  label,
}: {
  children?: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={className ? `ap-sect ${className}` : "ap-sect"}>
      <div className="ap-sect-head">
        {label}
        <EditorGlyph
          className="ap-sect-chev"
          name={children ? "chevronUp" : "chevronDown"}
          size={16}
        />
      </div>
      {children ? <div className="ap-sect-body">{children}</div> : null}
    </div>
  );
}
