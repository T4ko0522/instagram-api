import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function log(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

export async function saveResults(
  data: unknown,
  filename: string
): Promise<string> {
  const dir = join(process.cwd(), "output");
  await mkdir(dir, { recursive: true });
  const filepath = join(dir, filename);
  await writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");
  log(`Results saved to ${filepath}`);
  return filepath;
}
