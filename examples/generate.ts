// Writes the demo cohort used in the README from the same scenario the tests use.
import { writeFileSync } from "node:fs";
import { scenario } from "../test/helpers.js";

const s = scenario();
writeFileSync(new URL("./cohort.json", import.meta.url), JSON.stringify(s.cohort, null, 1) + "\n");
writeFileSync(new URL("./labels.json", import.meta.url), JSON.stringify(s.labels, null, 2) + "\n");
