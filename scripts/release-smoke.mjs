import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const match = (path, expression, label) => {
  const value = read(path).match(expression)?.[1];
  if (!value) throw new Error(`missing ${label} in ${path}`);
  return value;
};
const equal = (label, values) => {
  if (new Set(values).size !== 1)
    throw new Error(`${label} mismatch: ${values.join(", ")}`);
};

const rootPackage = json("package.json");
const appPackage = json("app/package.json");
const tauri = json("app/src-tauri/tauri.conf.json");
const cargoVersion = match(
  "Cargo.toml",
  /^\s*version\s*=\s*"([^"]+)"/m,
  "workspace version",
);
equal("application version", [
  rootPackage.version,
  appPackage.version,
  tauri.version,
  cargoVersion,
]);

equal("MCP protocol", [
  match(
    "app/src-tauri/src/mcp.rs",
    /MCP_PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/,
    "app MCP protocol",
  ),
  match(
    "mcp/src/protocol.rs",
    /PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/,
    "sidecar MCP protocol",
  ),
]);

if (!tauri.bundle.active) throw new Error("Tauri bundling is disabled");
for (const icon of tauri.bundle.icon) {
  if (!statSync(resolve(root, "app/src-tauri", icon)).isFile())
    throw new Error(`missing bundle icon: ${icon}`);
}

console.log(
  `release smoke ok: app ${cargoVersion}, MCP ${match(
    "app/src-tauri/src/mcp.rs",
    /MCP_PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/,
    "app MCP protocol",
  )}, ${tauri.bundle.icon.length} icons`,
);
