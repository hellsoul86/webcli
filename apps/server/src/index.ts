import { readEnv } from "./env.js";
import { createApp } from "./app.js";

const env = readEnv();
const { app } = await createApp(env);

await app.listen({
  host: env.host,
  port: env.port,
});

