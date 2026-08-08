import { CopyButton } from "#/components/ui/copy-button";

/**
 * A command, with everything after a `#` dimmed as a comment.
 *
 * The split is on the first `#` only, because these are shell one-liners where
 * a `#` cannot appear before the comment. That is a real constraint on what can
 * be put in `content/get-started.ts`, and it is the reason this is a split and
 * not a tokenizer: a syntax highlighter for three lines of shell is a library
 * this page does not need to ship.
 */
export function CodeBlock({
  code,
  copyable,
  label,
}: {
  code: string;
  copyable: boolean;
  label: string;
}) {
  const hash = code.indexOf("#");
  const command = hash === -1 ? code : code.slice(0, hash);
  const comment = hash === -1 ? "" : code.slice(hash);

  return (
    <div className="code-block">
      <pre className="code-line">
        <code>
          {command}
          {comment ? <span className="code-comment">{comment}</span> : null}
        </code>
      </pre>
      {copyable ? <CopyButton label={label} value={command.trim()} /> : null}
    </div>
  );
}
