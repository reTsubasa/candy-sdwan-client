import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanner = path.resolve(fileURLToPath(import.meta.url));
const ignored = new Set(["node_modules", ".git"]);
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----[\s\S]*-----END CERTIFICATE-----/i
];
const productionMarkers = /(?:prod(?:uction)?[-_ ]?(?:key|secret|credential)|live[-_ ]?credential)/i;
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full);
  }
}

walk(root);
for (const file of files) {
  if (file === scanner) continue;
  const content = fs.readFileSync(file, "utf8");
  if (forbidden.some((pattern) => pattern.test(content))) {
    throw new Error(`credential material found in ${path.relative(root, file)}`);
  }
  if (productionMarkers.test(content)) {
    throw new Error(`production credential marker found in ${path.relative(root, file)}`);
  }
}

console.log(`PASS test-key isolation: scanned ${files.length} repository files; fixtures contain public/test data only`);
