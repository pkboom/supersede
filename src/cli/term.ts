const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap =
  (code: number) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
};

export function heading(s: string, width = 72): void {
  console.log(`\n${c.bold(s)}\n${c.dim("─".repeat(Math.min(s.length, width)))}`);
}
