import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env");

if (!process.env.OPENAI_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
