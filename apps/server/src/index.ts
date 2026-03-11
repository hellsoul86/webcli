import { readEnv } from "./env.js";
import { createApp } from "./app.js";
import { FakeRuntime } from "./fake-runtime.js";

const env = readEnv();
const runtimeOverride =
  process.env.WEBCLI_FAKE_RUNTIME === "1" ? new FakeRuntime(process.cwd()) : undefined;
const { app } = await createApp(env, runtimeOverride ? { runtime: runtimeOverride } : undefined);

await app.listen({
  host: env.host,
  port: env.port,
});
