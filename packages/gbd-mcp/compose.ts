import type { GbdInput } from "./input";

export const composeGbdQuestion = (input: GbdInput): string =>
  `IHME GBD population estimate: measure=${input.measure}; cause=${input.cause}; location=${input.location}; year=${input.year}; sex=${input.sex}; age=${input.age}.`;
