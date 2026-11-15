import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "generated/prisma/client";
import { env } from "../config/env";

// Neon's copy-paste URL carries channel_binding=require, which the node-postgres driver does not support.
const url = new URL(env.DATABASE_URL);
url.searchParams.delete("channel_binding");

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString(), max: env.SIM_LAZY ? 3 : 10 }),
});
