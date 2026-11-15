import { bootstrap } from "./bootstrap";
import { prisma } from "./db/prisma";

bootstrap()
  .then(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error("bootstrap failed", error);
    process.exit(1);
  });
