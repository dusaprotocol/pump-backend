import { Prisma, PrismaClient } from "@prisma/client";
import logger from "./logger";

export const prisma = new PrismaClient({
  log: [],
});

export const handlePrismaError = (err: Error) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return;

    logger.warn(err.message, err.code);
  }
};
