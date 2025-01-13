import { prisma } from "./db";

(async () => {
  const logs = await prisma.log.findMany();
  for (const log of logs) {
    console.log(log.createdAt, log.message.toString());
  }
})();
