// Regression checks against production code. Run from the repository root with Node 24.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as domain from "../../opencode/packages/desktop/src/main/google-calendar-domain.ts";

const root = process.cwd();
const require = createRequire(path.join(root, "opencode/package.json"));
const ts = require("typescript");

// Execute the production declarations, with explicit boundary substitutes.
function declarations(file, names, context = {}) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Map();
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      names.includes(node.name.text)
    ) {
      found.set(node.name.text, node.getText(source).replace(/^export\s+/, ""));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text)
    ) {
      found.set(node.name.text, `const ${node.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.size, names.length, `Missing declarations in ${file}`);
  const code = ts.transpileModule(
    [...found.values()].join("\n") + "\n;({" + names.join(",") + "})",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  return vm.runInNewContext(code, {
    Error,
    console,
    Buffer,
    URL,
    Headers,
    AbortSignal,
    ...context,
  });
}

const noteState = {
  directory: "/test",
  path: "notes/test.md",
  title: "Test",
  baseTitle: "Test",
  body: "sent draft",
  baseBody: "old",
  projectIds: [],
  baseProjectIds: [],
  tags: "",
  baseTags: "",
  revision: "v1",
};
let finishSave;
let captured;
const notes = declarations(
  "opencode/packages/app/src/pages/notes.tsx",
  ["applyDocument", "save"],
  {
    state: noteState,
    setState: (key, value) =>
      typeof key === "string"
        ? (noteState[key] = value)
        : Object.assign(noteState, key),
    dirty: () => true,
    loadedNote: { loading: false },
    client: () => ({}),
    language: { t: (s) => s },
    report: (e) => {
      throw e;
    },
    updateSummary: () => {},
    writeNote: (_, input) => {
      captured = input;
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    },
  },
);
const saving = notes.save();
noteState.body = "newer unsaved typing";
noteState.title = "New title";
noteState.tags = "later";
noteState.projectIds = ["project_B"];
finishSave({
  body: captured.body,
  info: { title: "Test", tags: [], projectIds: [] },
  revision: "v2",
});
await saving;
assert.equal(noteState.body, "newer unsaved typing");
assert.equal(noteState.baseBody, "sent draft");
assert.equal(noteState.title, "New title");
assert.equal(noteState.tags, "later");
assert.deepEqual([...noteState.projectIds], ["project_B"]);
assert.equal(noteState.revision, "v2");
console.log(
  "PASS: note saves preserve typing and metadata edits made during the request",
);

// Load the whole desktop service, replacing only Electron, storage, and provider I/O.
const googleFile = "opencode/packages/desktop/src/main/google-calendar.ts";
const source = ts.createSourceFile(
  googleFile,
  fs.readFileSync(path.join(root, googleFile), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const serviceCode = ts.transpileModule(
  source.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source))
    .join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const store = new Map();
let fetch;
const exports = {};
vm.runInNewContext(serviceCode, {
  ...domain,
  exports,
  Error,
  Buffer,
  Headers,
  URL,
  URLSearchParams,
  AbortSignal,
  process,
  randomUUID,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  },
  net: { fetch: (...args) => fetch(...args) },
  getStore: () => ({
    get: (key) => structuredClone(store.get(key)),
    set: (key, value) => store.set(key, structuredClone(value)),
    clear: () => store.clear(),
  }),
});
function reset() {
  store.clear();
  store.set("clientId", "test.apps.googleusercontent.com");
  store.set("clientSecret", Buffer.from("test-secret").toString("base64"));
  store.set("refreshToken", Buffer.from("test-refresh").toString("base64"));
  store.set("access", "write");
  return exports.createGoogleCalendarService();
}
const json = (value, status = 200) => Response.json(value, { status });
const event = {
  providerId: "event",
  calendarId: "primary",
  etag: "local-v1",
  title: "Local edit",
  date: "2026-09-08",
  allDay: true,
  participantCount: 0,
};
let patches = 0;
let deletes = 0;
fetch = async (url, init) => {
  if (url.includes("oauth2.googleapis.com/token"))
    return json({ access_token: "test" });
  if (init?.method === "PATCH") {
    patches++;
    assert.equal(new Headers(init.headers).get("If-Match"), "remote-v2");
  }
  if (init?.method === "DELETE") deletes++;
  return json({
    id: "event",
    etag: "remote-v2",
    summary: "Remote edit",
    start: { date: "2026-09-08" },
    end: { date: "2026-09-09" },
  });
};
let service = reset();
for (const kind of ["update", "delete"]) {
  assert.equal(
    (await service.write({ kind, idempotencyKey: kind, event })).state,
    "conflict",
  );
}
assert.equal(patches + deletes, 0);
assert.equal(
  (
    await service.write({
      kind: "update",
      idempotencyKey: "fresh",
      event: { ...event, etag: "remote-v2" },
    })
  ).state,
  "synced",
);
assert.equal(patches, 1);
console.log(
  "PASS: stale Calendar edits/deletes stop before mutation; matching versions use If-Match",
);

const task = {
  providerId: "pending:local",
  taskListId: "@default",
  taskListTitle: "Default",
  title: "Task",
  updatedAt: "2026-09-08T00:00:00Z",
};
const input = { kind: "create", idempotencyKey: "task-key", task };
let posts = 0;
let offline = false;
let lost = true;
fetch = async (url, init) => {
  if (url.includes("oauth2.googleapis.com/token")) {
    if (offline) throw new Error("Offline before sending");
    return json({ access_token: "test" });
  }
  if (url.endsWith("/lists/@default"))
    return json({ id: "real-list", title: "My tasks" });
  if (init?.method === "POST") {
    posts++;
    assert.ok(url.endsWith("/lists/real-list/tasks"));
    if (lost) throw new Error("Lost response after provider committed");
    return json({ id: "real-task", title: "Task", updated: task.updatedAt });
  }
  if (url.includes("/users/@me/lists"))
    return json({ items: [{ id: "real-list", title: "My tasks" }] });
  if (url.includes("/lists/real-list/tasks"))
    return json({
      items: lost
        ? []
        : [{ id: "real-task", title: "Task", updated: task.updatedAt }],
    });
  return json({ items: [] });
};
service = reset();
assert.equal(
  (await service.writeTask(input)).errorCode,
  "google_task_create_uncertain",
);
assert.equal(
  (await exports.createGoogleCalendarService().writeTask(input)).errorCode,
  "google_task_create_uncertain",
);
assert.equal(
  (await service.sync()).connection.errorCode,
  "google_task_create_uncertain",
);
assert.equal(posts, 1);
// Crash/restart with an in-flight create persisted before the response arrived.
store.set(
  "taskOutbox",
  store.get("taskOutbox").map((item) => ({ ...item, state: "pending" })),
);
assert.equal((await service.sync()).taskWrites[0].state, "failed");
assert.equal(posts, 1);
console.log(
  "PASS: lost task-create responses and crash recovery never replay the POST",
);

service = reset();
posts = 0;
offline = true;
assert.equal((await service.writeTask(input)).state, "offline");
assert.equal(store.get("taskOutbox")[0].attempted, false);
offline = false;
lost = false;
const synced = await service.sync();
assert.equal(posts, 1);
assert.equal(synced.taskWrites[0].idempotencyKey, input.idempotencyKey);
assert.equal(synced.taskWrites[0].state, "synced");
assert.equal(synced.taskWrites[0].task.taskListId, "real-list");
assert.equal(synced.taskWrites[0].task.providerId, "real-task");
await service.writeTask(input);
assert.equal(posts, 1);
console.log(
  "PASS: pre-send failures retry safely; sync returns settled task identities",
);

for (const kind of ["outbox", "taskOutbox"]) {
  service = reset();
  const operations = Array.from({ length: 100 }, (_, id) => ({
    id: String(id),
    state: "offline",
    input: { idempotencyKey: `old-${id}` },
  }));
  store.set(kind, operations);
  await assert.rejects(
    () =>
      kind === "outbox"
        ? service.write({ kind: "create", idempotencyKey: "overflow", event })
        : service.writeTask(input),
    /google_outbox_full/,
  );
  assert.deepEqual(store.get(kind), operations);
}
const unfinished = { state: "offline", id: "keep" };
const trimmed = domain.retainGoogleOutbox([
  unfinished,
  ...Array.from({ length: 100 }, (_, id) => ({ state: "succeeded", id })),
]);
assert.equal(trimmed.length, 100);
assert.equal(trimmed[0], unfinished);
assert.equal(trimmed[1].id, 1);
console.log(
  "PASS: full queues reject new writes and prune only completed history",
);

let destination;
const shortcuts = declarations(
  "opencode/packages/app/src/pages/projects.tsx",
  ["openNotes", "openCalendar"],
  {
    URLSearchParams,
    project: { id: "project_B" },
    state: { brainDirectory: "/workspace B" },
    navigate: (url) => (destination = new URL(url, "https://example.invalid")),
  },
);
for (const name of ["openNotes", "openCalendar"]) {
  shortcuts[name]();
  assert.equal(destination.searchParams.get("directory"), "/workspace B");
  assert.equal(destination.searchParams.get("project"), "project_B");
}
console.log(
  "PASS: project shortcuts carry the brain workspace with the project filter",
);

for (const page of ["notes", "calendar"]) {
  const file = `opencode/packages/app/src/pages/${page}.tsx`;
  const tree = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let callback;
  function visit(node) {
    if (
      !callback &&
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "createEffect"
    )
      callback = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback);
  for (const [requested, expected] of [
    ["/workspace B", "/workspace B"],
    ["/unregistered", "/workspace A"],
  ]) {
    const state = { directory: "" };
    const available = () => [
      { worktree: "/workspace A" },
      { worktree: "/workspace B" },
    ];
    const code = ts.transpileModule(`(${callback})()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      state,
      projects: available,
      workspaces: available,
      search: { directory: requested },
      layout: { home: { selection: () => ({ directory: "/workspace A" }) } },
      setState: (key, value) => (state[key] = value),
    });
    assert.equal(state.directory, expected);
  }
}
console.log(
  "PASS: Notes and Calendar select the requested registered workspace and reject unregistered paths",
);
