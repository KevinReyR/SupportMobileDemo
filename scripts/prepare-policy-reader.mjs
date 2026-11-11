import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve("public/policy-pdfjs");
mkdirSync(target, { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  cpSync(resolve("node_modules/pdfjs-dist/legacy/build", file), resolve(target, file));
}
for (const dir of ["standard_fonts", "cmaps", "wasm"]) {
  cpSync(resolve("node_modules/pdfjs-dist", dir), resolve(target, dir), { recursive: true });
}
