#!/usr/bin/env node

import { cleanError, runCommand } from "../src/client.mjs";

try {
  const result = await runCommand(process.argv[2]);
  console.dir(result, { depth: null });
} catch (error) {
  console.error(cleanError(error));
  process.exitCode = 1;
}
