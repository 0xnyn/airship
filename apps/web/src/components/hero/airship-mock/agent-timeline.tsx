import { MOCK_TOOL_CALLS } from "#/content/mock-page";

/**
 * The agent's tool calls, streaming.
 *
 * Rendered in Claude Code's own transcript grammar — a filled marker and a bold
 * tool name for the call, an indented `⎿` elbow for its result — because that is
 * exactly what airship's real overlay renders. Someone who has used the tool
 * should recognise this before they read a word of it.
 *
 * Every row is present in the DOM from the start and revealed by the timeline;
 * nothing is mounted or unmounted, so the transcript's height never jumps
 * mid-stream.
 */
export function AgentTimeline() {
  return (
    <div className="ap-tl">
      {MOCK_TOOL_CALLS.map((call, index) => (
        <div key={call.tool + call.args}>
          <div className={`ap-tl-head ap-tl-head-${index + 1}`}>
            <span className="ap-tl-marker">&#9679;</span>
            <span className="ap-tl-tool">{call.tool}</span>
            <span className="ap-tl-args">{call.args}</span>
          </div>
          <div className={`ap-tl-res ap-tl-res-${index + 1}`}>
            <span className="ap-tl-elbow">&#8971;</span>
            <span>{call.result}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
