import { basename } from "node:path";
import type {
  AgonModFactory,
  CommandResult,
  Dispose,
  InvocationContext,
  Json,
  ModServices,
  Registrar,
} from "@kernlang/agon-mod-api";
import {
  acquireTurnLease,
  advanceReadCursor,
  appendEvent,
  claimRoomLock,
  claimTask,
  closeRoom,
  createRoom,
  createRoomWaker,
  detectTrigger,
  drainRoom,
  evaluateStop,
  expiredLocksHeldBy,
  foldTasks,
  getReadCursor,
  isRoomClosed,
  listPresence,
  listRoomLocks,
  listRooms,
  listUnreadStates,
  parseMentions,
  pickNextTask,
  postTask,
  postTaskResult,
  postTaskStop,
  readActiveLease,
  readEvents,
  recordPresence,
  releaseRoomLock,
  releaseTurnLease,
  removePresence,
  roomDir,
  roomExists,
  shouldStopWork,
  slugifyRoomId,
} from "./runtime/index.js";
import type {
  AutoConfig,
  AutoState,
  RoomActor,
  RoomEvent,
  TailCursor,
  WorkConfig,
  WorkState,
} from "./runtime/index.js";

const json = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;
const text = (value: Json | undefined): string =>
  typeof value === "string" ? value : "";
const integer = (value: Json | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const extras = (input: Record<string, Json>): string[] =>
  Array.isArray(input._) ? input._.map(String) : [];
const positionalText = (input: Record<string, Json>): string =>
  text(input.text).trim() || extras(input).slice(2).join(" ").trim();

function buildActor(input: Record<string, Json>): RoomActor {
  const callsign = String(
      input.callsign ?? input.as ?? input.engine ?? "me",
    ).toLowerCase(),
    engine = typeof input.engine === "string" ? input.engine : undefined,
    cli = engine ?? "mcp";
  return {
    actorId: `${cli}:${callsign}`,
    callsign,
    kind: "external-cli",
    engineId: engine,
    cli,
    humanOwner: process.env.USER ?? "local",
  };
}

async function requireWrite(services: ModServices, resource: string): Promise<void> {
  if ((await services.permissions.check("fs.write", resource)) !== "allow") {
    throw new TypeError("Permission denied: fs.write is required");
  }
}

async function dispatchRoomReply(
  services: ModServices,
  engineId: string,
  prompt: string,
  context: InvocationContext,
  timeoutSeconds: number,
): Promise<{ stdout: string; exitCode: number; timedOut: boolean }> {
  const raw = (await services.engines.dispatch(engineId, prompt, context, {
    timeoutSeconds,
    mode: "exec",
  })) as Record<string, Json>;
  return {
    stdout: text(raw.stdout).trim(),
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : 0,
    timedOut: raw.timedOut === true,
  };
}

export async function roomAction(
  raw: Json,
  context: InvocationContext,
  services: ModServices,
): Promise<Json> {
  const input = raw as Record<string, Json>,
    action = String(input.action ?? ""),
    name = String(input.room ?? input.name ?? ""),
    id = slugifyRoomId(name),
    actor = buildActor(input),
    repoHint = basename(context.cwd || process.cwd()),
    since = Math.max(0, integer(input.since, 0)),
    limit = Math.max(0, integer(input.limit, 50));
  if (action === "list") {
    return json(listRooms());
  }
  if (!name.trim()) throw new TypeError("room is required");
  const mutating = new Set(["create", "join", "post", "auto", "lock", "release", "task", "work", "stop", "leave", "close"]);
  if (mutating.has(action)) await requireWrite(services, roomDir(id));
  if (action === "create") return json(createRoom(name));
  if (action === "join") {
    if (roomExists(id) && isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    createRoom(name);
    recordPresence(id, actor, 0, false);
    const event = appendEvent(id, { kind: "join", actor, body: "", mentions: [], replyTo: null, repoHint });
    return json({
      joined: id,
      as: actor.callsign,
      event,
      transcript: readEvents(id, 0, 20),
    });
  }
  if (!roomExists(id)) throw new TypeError(`no room "${id}"`);
  if (action === "post") {
    if (isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    const body = positionalText(input);
    if (!body) throw new TypeError("text is required");
    const event = appendEvent(id, {
      kind: "post",
      actor,
      body,
      mentions: parseMentions(body),
      replyTo: null,
      repoHint,
    });
    recordPresence(id, actor, event.seq, false);
    return json({ posted: id, seq: event.seq, mentions: event.mentions, event, staleLocks: expiredLocksHeldBy(id, actor.callsign) });
  }
  if (action === "read") {
    const explicitIdentity = Boolean(input.as || input.engine || input.callsign);
    if (input.unread === true && !explicitIdentity) throw new TypeError("unread requires as, callsign, or engine");
    const cursor = getReadCursor(id, actor.callsign);
    const fromSeq = input.unread === true ? Math.max(since, cursor) : since;
    const events = readEvents(id, fromSeq, input.unread === true ? 0 : limit);
    let cursorAdvanced = false;
    if (explicitIdentity && input.peek !== true && events.length > 0 && events[0].seq <= cursor + 1) {
      advanceReadCursor(id, actor, events.at(-1)!.seq);
      cursorAdvanced = true;
    }
    return json({ room: id, events, cursorAdvanced, lastReadSeq: getReadCursor(id, actor.callsign) });
  }
  if (action === "who") {
    const unread = new Map(listUnreadStates(id).map((entry) => [entry.callsign, entry]));
    const members = listPresence(id).map((entry) => ({ ...entry, ...(unread.get(entry.callsign) ?? {}) }));
    return json({
      room: id,
      members,
      present: members,
      locks: listRoomLocks(id),
      tasks: foldTasks(readEvents(id, 0, 0), Date.now()),
    });
  }
  if (action === "lock") {
    if (isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    const resource = text(input.resource).trim() || extras(input).slice(2).join(" ").trim();
    const result = claimRoomLock(id, actor, resource, Math.max(1, integer(input.ttl ?? input.ttlMinutes, 30)) * 60_000, repoHint, input.steal === true);
    if (!result.ok) throw new TypeError(result.reason ?? "lock failed");
    if (result.event) recordPresence(id, actor, result.event.seq, false);
    return json({ locked: result.event?.lock, event: result.event });
  }
  if (action === "release") {
    const resource = text(input.resource).trim() || extras(input).slice(2).join(" ").trim();
    const result = releaseRoomLock(id, actor, resource, repoHint);
    if (!result.ok) throw new TypeError(result.reason ?? "release failed");
    if (result.event) recordPresence(id, actor, result.event.seq, false);
    return json({ released: resource, event: result.event });
  }
  if (action === "task") {
    if (isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    const spec = positionalText(input);
    if (!spec) throw new TypeError("task spec is required");
    const target = text(input.for).trim().toLowerCase() || null;
    const event = postTask(id, actor, spec, target, repoHint);
    recordPresence(id, actor, event.seq, false);
    return json({ task: event.task, event });
  }
  if (action === "stop") {
    const event = postTaskStop(id, actor, positionalText(input) || "work stop requested", repoHint);
    return json({ stopped: id, event });
  }
  if (action === "leave") {
    const event = appendEvent(id, { kind: "leave", actor, body: "", mentions: [], replyTo: null, repoHint });
    removePresence(id, actor.callsign);
    return json({ left: id, event });
  }
  if (action === "close") {
    const event = appendEvent(id, { kind: "room-closed", actor, body: "", mentions: [], replyTo: null, repoHint });
    closeRoom(id);
    return json({ closed: id, event });
  }
  if (action === "tail") {
    let cursor: TailCursor = { offset: 0, partial: "" };
    const initial = drainRoom(id, cursor);
    cursor = initial.cursor;
    const events = initial.events.filter((event) => event.seq > since).slice(-50);
    const waker = createRoomWaker(id, Math.max(250, integer(input["poll-ms"], 5000)), (message) => void services.logger.warn(message));
    try {
      while (!context.signal.aborted) {
        const reason = await waker.wait();
        if (reason === "close" || context.signal.aborted) break;
        const drained = drainRoom(id, cursor);
        cursor = drained.cursor;
        events.push(...drained.events);
      }
    } finally {
      waker.close();
    }
    return json({ room: id, events, stopped: context.signal.aborted ? "aborted" : "closed" });
  }
  if (action === "auto") {
    const dryRun = input["dry-run"] === true;
    if (!dryRun && !actor.engineId) throw new TypeError("auto requires engine or dry-run");
    if (isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    const active = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
    if (!dryRun && active.length && !active.includes(actor.engineId!)) throw new TypeError(`unknown or inactive engine "${actor.engineId}"`);
    const timeoutSeconds = 120;
    const config: AutoConfig = {
      callsign: actor.callsign,
      openFloor: input["open-floor"] === true,
      quietMs: Math.max(0, integer(input["quiet-ms"], 4000)),
      maxTurns: Math.min(100, Math.max(1, integer(input["max-turns"], 3))),
      maxWallMs: Math.min(1440, Math.max(1, integer(input["max-minutes"], 10))) * 60_000,
      stopPhrase: text(input["stop-phrase"]),
      untilHuman: input["until-human"] === true,
    };
    const leaseTtlMs = Math.max(Math.max(5, integer(input["lease-ttl"], 60)), timeoutSeconds + 15) * 1000;
    const waker = createRoomWaker(id, Math.max(250, integer(input["poll-ms"], 5000)), (message) => void services.logger.warn(message));
    let cursor: TailCursor = { offset: 0, partial: "" };
    let all: RoomEvent[] = [];
    const state: AutoState = { turns: 0, startedAtMs: Date.now(), lastSelfSeq: 0 };
    let lastHandledSeq = 0;
    const posted: RoomEvent[] = [];
    recordPresence(id, actor, 0, true);
    appendEvent(id, { kind: "join", actor, body: "", mentions: [], replyTo: null, repoHint, auto: true });
    try {
      while (!context.signal.aborted) {
        const drained = drainRoom(id, cursor);
        cursor = drained.cursor;
        all = drained.reset ? [...drained.events] : [...all, ...drained.events];
        if (isRoomClosed(id)) break;
        const stop = evaluateStop(state, config, all);
        if (stop.stop) break;
        const trigger = detectTrigger(all, actor.callsign, config.openFloor, config.quietMs);
        if (!trigger.trigger || trigger.triggerSeq <= lastHandledSeq) { await waker.wait(); continue; }
        const lease = acquireTurnLease(id, actor.callsign, trigger.triggerSeq, leaseTtlMs);
        if (!lease) { await waker.wait(); continue; }
        try {
          const transcript = all.filter((event) => event.kind === "post").slice(-20).map((event) => `${event.actor.callsign}: ${event.body}`).join("\n");
          const reply = dryRun
            ? `(dry-run) ${actor.callsign} acks #${trigger.triggerSeq}`
            : (await dispatchRoomReply(services, actor.engineId!, `You are "${actor.callsign}" in a multi-agent chat room. Reply concisely (1-3 sentences) to the latest message; do not repeat earlier points. Transcript:\n${transcript}`, context, timeoutSeconds)).stdout;
          const held = readActiveLease(id);
          if (reply && held?.leaseId === lease.leaseId) {
            const event = appendEvent(id, { kind: "post", actor, body: reply, mentions: parseMentions(reply), replyTo: null, repoHint, auto: true });
            recordPresence(id, actor, event.seq, true);
            state.lastSelfSeq = event.seq;
            posted.push(event);
          }
        } finally {
          releaseTurnLease(id, lease.leaseId);
        }
        lastHandledSeq = trigger.triggerSeq;
        state.turns += 1;
      }
    } finally {
      waker.close();
      appendEvent(id, { kind: "leave", actor, body: "", mentions: [], replyTo: null, repoHint, auto: true });
      removePresence(id, actor.callsign);
    }
    return json({ room: id, turns: state.turns, posted, stopped: context.signal.aborted ? "aborted" : "condition" });
  }
  if (action === "work") {
    const dryRun = input["dry-run"] === true;
    if (!dryRun && !actor.engineId) throw new TypeError("work requires engine or dry-run");
    if (isRoomClosed(id)) throw new TypeError(`room "${id}" is closed`);
    const active = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
    if (!dryRun && active.length && !active.includes(actor.engineId!)) throw new TypeError(`unknown or inactive engine "${actor.engineId}"`);
    const taskTimeoutSeconds = Math.min(3600, Math.max(10, integer(input["task-timeout"], 600)));
    const config: WorkConfig = {
      callsign: actor.callsign,
      maxWallMs: Math.min(1440, Math.max(1, integer(input["max-minutes"], 10))) * 60_000,
      leaseTtlMs: Math.max(10, integer(input["lease-ttl"], 60)) * 1000,
      taskTimeoutMs: taskTimeoutSeconds * 1000,
    };
    const waker = createRoomWaker(id, Math.max(250, integer(input["poll-ms"], 5000)), (message) => void services.logger.warn(message));
    let cursor: TailCursor = { offset: 0, partial: "" };
    let all: RoomEvent[] = [];
    recordPresence(id, actor, 0, true);
    const joined = appendEvent(id, { kind: "join", actor, body: "", mentions: [], replyTo: null, repoHint, auto: true });
    const state: WorkState = { startedAtMs: Date.now(), tasksHandled: 0, joinSeq: joined.seq };
    const completed: RoomEvent[] = [];
    try {
      while (!context.signal.aborted) {
        const drained = drainRoom(id, cursor);
        cursor = drained.cursor;
        all = drained.reset ? [...drained.events] : [...all, ...drained.events];
        if (isRoomClosed(id) || shouldStopWork(state, config, all).stop) break;
        const next = pickNextTask(foldTasks(all, Date.now()), actor.callsign);
        if (!next) { await waker.wait(); continue; }
        const claim = claimTask(id, actor, next.taskId, config.leaseTtlMs, repoHint);
        if (!claim.ok) { await waker.wait(); continue; }
        let reply = "";
        let ok = true;
        let exitCode = 0;
        try {
          if (dryRun) reply = `(dry-run) ${actor.callsign} completed ${next.taskId}`;
          else {
            const recent = all.filter((event) => event.kind === "post").slice(-8).map((event) => `${event.actor.callsign}: ${event.body}`).join("\n");
            const result = await dispatchRoomReply(services, actor.engineId!, `You are worker "${actor.callsign}" in an agon room. Complete this task and report concisely what you did.\n\nTASK ${next.taskId}:\n${next.spec}${recent ? `\n\nRecent room context:\n${recent}` : ""}`, context, taskTimeoutSeconds);
            reply = result.stdout;
            exitCode = result.exitCode;
            ok = exitCode === 0 && !result.timedOut && reply.length > 0;
            if (result.timedOut && !reply) reply = `(engine timed out after ${taskTimeoutSeconds}s)`;
          }
        } catch (error) {
          ok = false;
          exitCode = 1;
          reply = `error: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (!reply) { ok = false; reply = "(no output)"; }
        const result = postTaskResult(id, actor, next.taskId, reply, ok, exitCode, repoHint);
        if (result.event) {
          recordPresence(id, actor, result.event.seq, true);
          completed.push(result.event);
        }
        state.tasksHandled += 1;
      }
    } finally {
      waker.close();
      appendEvent(id, { kind: "leave", actor, body: "", mentions: [], replyTo: null, repoHint, auto: true });
      removePresence(id, actor.callsign);
    }
    return json({ room: id, tasksHandled: state.tasksHandled, completed, stopped: context.signal.aborted ? "aborted" : "condition" });
  }
  throw new TypeError(`unknown room action "${action}"`);
}
const schema = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    action: { type: "string" },
    room: { type: "string" },
    name: { type: "string" },
    callsign: { type: "string" },
    as: { type: "string" },
    engine: { type: "string" },
    text: { type: "string" },
    since: { type: "number" },
    limit: { type: "number" },
    resource: { type: "string" },
    ttlMinutes: { type: "number" },
    steal: { type: "boolean" },
  },
}) as Readonly<Record<string, Json>>;
const cliSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string" },
    room: { type: "string" },
    as: { type: "string" },
    text: { type: "string" },
    name: { type: "string" },
    engine: { type: "string" },
    since: { type: "string", default: "0" },
    limit: { type: "string", default: "50" },
    "max-turns": { type: "string", default: "3" },
    "max-minutes": { type: "string", default: "10" },
    "open-floor": { type: "boolean" },
    "until-human": { type: "boolean" },
    "stop-phrase": { type: "string" },
    "quiet-ms": { type: "string", default: "4000" },
    "poll-ms": { type: "string", default: "5000" },
    "lease-ttl": { type: "string", default: "60" },
    "dry-run": { type: "boolean" },
    json: { type: "boolean" },
    unread: { type: "boolean" },
    peek: { type: "boolean" },
    resource: { type: "string" },
    ttl: { type: "string", default: "30" },
    steal: { type: "boolean" },
    for: { type: "string" },
    "task-timeout": { type: "string", default: "600" },
  },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ["action", "room"],
  aliases: { text: "m", name: "n", resource: "r" },
});
const ids = [
  ["mcpTools:0022", "join"],
  ["mcpTools:0023", "leave"],
  ["mcpTools:0024", "list"],
  ["mcpTools:0025", "lock"],
  ["mcpTools:0026", "post"],
  ["mcpTools:0027", "read"],
  ["mcpTools:0028", "release"],
  ["mcpTools:0029", "who"],
] as const;
export const createMod: AgonModFactory = (services) =>
  Object.freeze({
    apiVersion: "1" as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(
        registrar.command("cli", {
          id: "cliCommands:0064",
          description: "Shared persistent multi-party rooms",
          inputSchema: cliSchema,
          cli,
          run: async (input, context): Promise<CommandResult> => {
            try {
              const result = await roomAction(input, context, services),
                receiptId = await services.receipts.record("room-action", {
                  action: (input as any).action,
                  room: (input as any).room ?? null,
                });
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ ...(result as object), receiptId }, null, 2)}\n`,
                result: json({ ...(result as object), receiptId }),
              };
            } catch (error) {
              return {
                exitCode: 1,
                stderr: `${error instanceof Error ? error.message : String(error)}\n`,
              };
            }
          },
        }),
      );
      for (const [id, action] of ids)
        disposers.push(
          registrar.tool("mcp", {
            id,
            description: `Room ${action}`,
            inputSchema: schema,
            effect: ["read", "who", "list"].includes(action) ? "read" : "write",
            run: (input, context) =>
              roomAction({ ...(input as object), action }, context, services),
          }),
        );
      disposers.push(
        registrar.resultType({
          id: "resultAndEnvelopeTypes:0109",
          schema: { type: "object", additionalProperties: true },
          readableVersions: ">=1",
          render: async (payload) => ({
            text: JSON.stringify(payload, null, 2),
          }),
        }),
      );
      return async () => {
        for (const dispose of [...disposers].reverse()) await dispose();
      };
    },
  });
export default createMod;
