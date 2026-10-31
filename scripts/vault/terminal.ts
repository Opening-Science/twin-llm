import { createInterface } from "node:readline";

/**
 * Prompts of the vault CLIs. On a terminal a passphrase is read without echo;
 * when stdin is a pipe (a scripted run on a throwaway install), lines are
 * read from it in order. Nothing typed is ever printed or logged.
 */

export type Terminal = Readonly<{
  say: (text: string) => void;
  line: (prompt: string) => Promise<string>;
  secret: (prompt: string) => Promise<string>;
  close: () => void;
}>;

const readHidden = (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let typed = "";
    const finish = (error: Error | null) => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stdout.write("\n");
      if (error === null) resolve(typed);
      else reject(error);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(null);
        if (char === "\u0003") return finish(new Error("cancelled"));
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    input.on("data", onData);
  });

export const openTerminal = (): Terminal => {
  if (process.stdin.isTTY) {
    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    return {
      say: (text) => process.stdout.write(`${text}\n`),
      line: ask,
      secret: readHidden,
      close: () => undefined,
    };
  }
  const rl = createInterface({ input: process.stdin });
  const queued: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let ended = false;
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });
  rl.on("close", () => {
    ended = true;
    for (const next of waiting.splice(0)) next("");
  });
  const nextLine = (prompt: string): Promise<string> => {
    process.stdout.write(`${prompt}\n`);
    const line = queued.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve("");
    return new Promise((resolve) => waiting.push(resolve));
  };
  return {
    say: (text) => process.stdout.write(`${text}\n`),
    line: nextLine,
    secret: nextLine,
    close: () => rl.close(),
  };
};
