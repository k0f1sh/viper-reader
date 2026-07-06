import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../../..", ".env");
  dotenv.config({ path: envPath });
}
