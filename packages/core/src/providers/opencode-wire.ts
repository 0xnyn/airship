/**
 * The OpenCode wire shapes airship actually consumes.
 *
 * These are declared here rather than imported from `@opencode-ai/sdk` because
 * the SDK's generated `Event` union is demonstrably behind its own server. On
 * opencode 1.18.13 a single real turn produced 313 events, of which 237 were
 * `message.part.delta` — an event the SDK's union does not contain at all. It
 * also omits `server.heartbeat`, and it declares `permission.updated` where the
 * server emits `permission.asked` with an entirely different payload.
 *
 * Trusting the generated union would therefore mean dropping the streaming
 * channel and deadlocking on every permission request, with the type-checker
 * reporting no problem whatsoever. Declaring the narrow slice we consume keeps
 * the reducer honest about what really arrives, keeps it testable from plain
 * literals, and means an SDK regeneration cannot silently change behaviour.
 *
 * The SDK is still used for every *call*; only the event and part shapes are
 * restated here.
 */

/** Tool call state, as it advances `pending → running → completed | error`. */
export interface OcToolState {
  error?: string;
  input?: Record<string, unknown>;
  /** `bash` reports `exit`/`output` here; `edit` reports a unified `diff`. */
  metadata?: Record<string, unknown>;
  output?: string;
  raw?: string;
  status: "pending" | "running" | "completed" | "error";
  title?: string;
}

export interface OcToolPart {
  callID?: string;
  id: string;
  messageID: string;
  sessionID: string;
  state: OcToolState;
  /** The opencode tool id: `bash`, `edit`, `write`, `read`, … */
  tool: string;
  type: "tool";
}

export interface OcTextPart {
  id: string;
  messageID: string;
  sessionID: string;
  synthetic?: boolean;
  text?: string;
  type: "text";
}

export interface OcReasoningPart {
  id: string;
  messageID: string;
  sessionID: string;
  text?: string;
  type: "reasoning";
}

/** Absolute paths, emitted once a step has written files. */
export interface OcPatchPart {
  files?: string[];
  hash?: string;
  id: string;
  messageID: string;
  sessionID: string;
  type: "patch";
}

export interface OcStepFinishPart {
  cost?: number;
  id: string;
  messageID: string;
  reason?: string;
  sessionID: string;
  tokens?: OcTokens;
  type: "step-finish";
}

export interface OcOtherPart {
  id: string;
  messageID: string;
  sessionID: string;
  type: "step-start" | "snapshot" | "agent" | "retry" | "compaction" | "file";
}

export type OcPart =
  | OcOtherPart
  | OcPatchPart
  | OcReasoningPart
  | OcStepFinishPart
  | OcTextPart
  | OcToolPart;

export interface OcTokens {
  cache?: { read?: number; write?: number };
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

export interface OcMessageError {
  data?: { message?: string; retries?: number };
  name?: string;
}

export interface OcMessageInfo {
  cost?: number;
  error?: OcMessageError;
  id: string;
  role: "assistant" | "user";
  sessionID: string;
  /** Populated only when opencode's own extractor succeeds — often it does not. */
  structured?: unknown;
  tokens?: OcTokens;
}

export interface OcTodo {
  content?: string;
  id?: string;
  status?: string;
}

/**
 * A live permission request. The turn blocks until it is answered — an
 * unanswered request hangs the prompt indefinitely, verified against the real
 * server.
 */
export interface OcPermissionAsked {
  id: string;
  metadata?: Record<string, unknown>;
  /** The tool being gated: `bash`, `edit`, `webfetch`, … */
  permission: string;
  sessionID: string;
}

/**
 * Every member carries a literal `type`, deliberately.
 *
 * A catch-all `{ type: string }` arm would widen the discriminant and silently
 * defeat narrowing on every other arm, leaving `properties` typed as `{}`
 * throughout the reducer while still compiling. Events outside this union do
 * arrive — opencode emits a good many airship has no use for — and they fall to
 * the reducer's `default`, which is the correct handling for them anyway.
 */
export type OcEvent =
  | { properties: { file?: string }; type: "file.edited" }
  | {
      properties: {
        delta?: string;
        field?: string;
        messageID?: string;
        partID?: string;
        sessionID?: string;
      };
      type: "message.part.delta";
    }
  | { properties: { info: OcMessageInfo }; type: "message.updated" }
  | {
      properties: { part: OcPart; sessionID?: string };
      type: "message.part.updated";
    }
  | {
      properties: { sessionID?: string; diff?: Array<{ file?: string }> };
      type: "session.diff";
    }
  | {
      properties: { sessionID?: string; error?: OcMessageError };
      type: "session.error";
    }
  | {
      properties: { sessionID?: string; status?: { type?: string } };
      type: "session.status";
    }
  | {
      properties: { sessionID?: string; todos?: OcTodo[] };
      type: "todo.updated";
    }
  | { properties: { sessionID?: string }; type: "session.idle" }
  | { properties: { info?: { id?: string } }; type: "session.updated" }
  | { properties: OcPermissionAsked; type: "permission.asked" }
  | {
      properties: { permissionID?: string; sessionID?: string };
      type: "permission.replied";
    }
  | {
      properties: { event?: string; file?: string };
      type: "file.watcher.updated";
    }
  | { properties: Record<string, never>; type: "server.connected" }
  | { properties: Record<string, never>; type: "server.heartbeat" };
