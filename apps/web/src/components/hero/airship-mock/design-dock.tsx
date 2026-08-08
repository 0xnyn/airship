import { AgentTimeline } from "#/components/hero/airship-mock/agent-timeline";
import { ComposerField } from "#/components/hero/airship-mock/composer-field";
import { DiffCard } from "#/components/hero/airship-mock/diff-card";
import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";
import {
  NumField,
  PaintRow,
  Segmented,
  Select,
  SwapValue,
} from "#/components/hero/airship-mock/inspector-controls";
import { InspectorSection } from "#/components/hero/airship-mock/inspector-section";
import { MOCK_PROMPT, MOCK_SELECTION, MOCK_STATUS } from "#/content/mock-page";
import { TWEAKS } from "#/content/timeline";

/*
 * The nine align cells, in the real panel's order: horizontal, vertical, then
 * distribute-and-tidy.
 */
const ALIGN_GROUPS = [
  ["alignLeft", "alignCenterH", "alignRight"],
  ["alignTop", "alignCenterV", "alignBottom"],
  ["distributeH", "distributeV", "tidy"],
] as const;

const TABS = [
  { glyph: "logo", label: "Agent" },
  { glyph: "design", label: "Edit" },
  { glyph: "code", label: "CSS" },
  { glyph: "layers", label: "DOM" },
] as const;

/**
 * One dock, four tabs.
 *
 * ── A deliberate departure from the real editor ──────────────────────────────
 * airship actually runs TWO docks: chat on the left at 340px, inspector on the
 * right at 360px. This mock folds the chat in as an *Agent* tab instead.
 *
 * That is a simplification for the hero specifically, and it is worth being
 * honest about. Two 200px panels flanking a 285px strip of page reads as clutter
 * at this render scale, and it splits attention exactly where the page is trying
 * to make one point. One panel with the agent in front says the same thing more
 * quietly — and the Edit / CSS / DOM tabs beside it still show that a full
 * inspector is part of the product.
 *
 * Everything INSIDE the tabs is transcribed 1:1 as usual. It is the arrangement
 * that is editorial, not the components.
 */
export function DesignDock() {
  return (
    <div className="ap-dock ap-dock-right">
      <div className="ap-head">
        <span className="ap-brand">
          <EditorGlyph name="logo" size={20} />
          <span className="ap-brand-name">Airship</span>
        </span>
        <span className="ap-head-actions">
          <span className="ap-iconbtn">
            <EditorGlyph name="plus" size={16} />
          </span>
          <span className="ap-iconbtn">
            <EditorGlyph name="panelRight" size={16} />
          </span>
        </span>
      </div>

      {/*
        Empty and filled states stack in one relative box and cross-fade, so
        neither ever reflows the dock.
      */}
      <div className="ap-insp-stage">
        <div className="ap-empty ap-insp-empty">
          <EditorGlyph className="ap-empty-art" name="logo" size={48} />
          <span className="ap-empty-title">Ask airship to change anything</span>
          <span className="ap-empty-body">
            Pick an element first to scope it.
          </span>
        </div>

        <div className="ap-insp ap-insp-filled">
          <div className="ap-insp-tabs">
            {TABS.map((tab) => (
              <span
                className={`ap-insp-tab ap-tab-${tab.label.toLowerCase()}`}
                key={tab.label}
              >
                <EditorGlyph name={tab.glyph} size={18} />
                {tab.label}
              </span>
            ))}
          </div>

          {/* Both tab bodies stacked; the timeline decides which is in front. */}
          <div className="ap-tab-stage">
            <div className="ap-tab-body ap-tab-body-agent">
              <div className="ap-transcript">
                <div className="ap-msg-user">{MOCK_PROMPT}</div>

                <div className="ap-msg-assistant">
                  <AgentTimeline />

                  <div className="ap-turn-status">
                    <span className="ap-dot" />
                    {/* Both labels in one grid cell, so the row does not
                        re-wrap when "Applying…" becomes "Done". */}
                    <span className="ap-status-label">
                      <span className="ap-status-working">
                        {MOCK_STATUS.working}
                      </span>
                      <span className="ap-status-done">{MOCK_STATUS.done}</span>
                    </span>
                  </div>

                  <DiffCard />
                </div>
              </div>

              <ComposerField />
            </div>

            <div className="ap-tab-body ap-tab-body-edit">
              <div className="ap-insp-scroll">
                <InspectorSection className="ap-insp-row" label="Source">
                  <span className="ap-src">
                    {MOCK_SELECTION.sourceFile}:{MOCK_SELECTION.sourceLine}
                  </span>
                </InspectorSection>

                <div className="ap-align-row ap-insp-row">
                  {ALIGN_GROUPS.map((group) => (
                    <span className="ap-align-grp" key={group[0]}>
                      {group.map((glyph) => (
                        <span className="ap-align-btn" key={glyph}>
                          <EditorGlyph name={glyph} size={20} />
                        </span>
                      ))}
                    </span>
                  ))}
                </div>

                <InspectorSection className="ap-insp-row" label="Size">
                  <div className="ap-grid">
                    <NumField letter="W" value="122" />
                    <NumField letter="H" value="45" />
                  </div>
                </InspectorSection>

                <InspectorSection className="ap-insp-row" label="Auto layout" />

                <InspectorSection className="ap-insp-row" label="Text" />

                <InspectorSection className="ap-insp-row" label="Appearance">
                  <div className="ap-grid">
                    <NumField glyph="opacity" suffix="%" value="100" />
                    <NumField
                      className="ap-field-radius"
                      glyph="radius"
                      value={
                        <SwapValue
                          from={TWEAKS.radius.from}
                          name="radius"
                          to={TWEAKS.radius.to}
                        />
                      }
                    />
                  </div>
                  <div className="ap-row">
                    <span className="ap-row-label">Blend</span>
                    <Select value="Normal" />
                  </div>
                </InspectorSection>

                <InspectorSection className="ap-insp-row" label="Fill">
                  <div className="ap-rows">
                    <div className="ap-rows-row">
                      <PaintRow
                        alpha="100"
                        hex={
                          <SwapValue
                            from={TWEAKS.fill.from}
                            name="fill"
                            to={TWEAKS.fill.to}
                          />
                        }
                        hexClassName="ap-field-fill"
                        swatchClassName="ap-swatch-fill"
                      />
                      <span className="ap-row-icon">
                        <EditorGlyph name="minus" size={16} />
                      </span>
                    </div>
                  </div>
                </InspectorSection>

                <InspectorSection className="ap-insp-row" label="Stroke">
                  <div className="ap-row">
                    <span className="ap-row-label">Position</span>
                    <Segmented
                      activeIndex={1}
                      options={["In", "Center", "Out"]}
                    />
                  </div>
                </InspectorSection>

                <InspectorSection className="ap-insp-row" label="Effects" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
