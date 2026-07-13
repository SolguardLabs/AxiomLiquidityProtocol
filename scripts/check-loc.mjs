import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = join(root, "src");

function listFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(full));
        } else if (entry.name.endsWith(".ts")) {
            files.push(full);
        }
    }
    return files;
}

let lines = 0;
for (const file of listFiles(src)) {
    const text = readFileSync(file, "utf8");
    lines += text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

console.log(lines);
