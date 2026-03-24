import { resolve } from "node:path";

export type AppEnv = {
  host: string;
  port: number;
  codexCommand: string;
  dataDir: string;
  dbPath: string;
  webDistDir: string;
};

export function readEnv(): AppEnv {
  const dataDir = resolve(
    process.cwd(),
    process.env.WEBCLI_DATA_DIR ?? "apps/server/data",
  );

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.WEBCLI_PORT ?? process.env.PORT ?? "4000", 10),
    codexCommand: process.env.CODEX_COMMAND ?? "codex",
    dataDir,
    dbPath: resolve(dataDir, "webcli.sqlite"),
    webDistDir: resolve(process.cwd(), "apps/web/dist"),
  };
}

