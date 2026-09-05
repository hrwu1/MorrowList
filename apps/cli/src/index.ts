import { EXIT, printError } from "./formatters/output.js";
import { createProgram } from "./program.js";

/** `morrow`: the executable. Everything it can do is assembled in `program.ts`. */
try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  // Commander already reported usage errors; anything reaching here is unexpected.
  printError(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.usage);
}
