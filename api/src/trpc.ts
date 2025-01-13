import * as trpcExpress from "@trpc/server/adapters/express";
import { TRPCError, inferAsyncReturnType, initTRPC } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../common/db";
import logger from "../../common/logger";
import { ONE_DAY, ONE_HOUR } from "../../common/utils/date";
import { toToken } from "../../common/methods";
import { observable } from "@trpc/server/observable";
import { EventEmitter } from "events";
import { getTokenValue } from "../../common/datastoreFetcher";
import { web3Client } from "../../common/client";
import jwt from "jsonwebtoken";
import { nsfwPath, tokenDecimals } from "../../common/config";

export const createContext = ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions) => ({
  req,
  res,
  prisma,
});
export type Context = inferAsyncReturnType<typeof createContext>;

export const t = initTRPC.context<Context>().create();

const router = t.router;

const JWT_SECRET = process.env.JWT_SECRET || "secret";

type Pool = Prisma.PoolGetPayload<{}>;
type Token = Prisma.TokenGetPayload<{}>;

// create a global event emitter (could be replaced by redis, etc)
const ee = new EventEmitter();

export const appRouter = router({
  // =========
  // WEBSOCKET
  // =========
  addSwap: t.procedure
    .meta({ openapi: { method: "GET", path: "/add-swap" } })
    .input(z.object({ txHash: z.string() }))
    .output(z.object({}).optional())
    .mutation(async ({ input }) => {
      ee.emit("addSwap", input);
      return input;
    }),
  onAddSwap: t.procedure.subscription(() => {
    // return an `observable` with a callback which is triggered immediately
    return observable<
      Prisma.SwapGetPayload<{
        include: { pool: { include: { token: true } }; user: true };
      }>
    >((emit) => {
      const onAddSwap = async (data: { txHash: string }) => {
        // emit data to client
        const swap = await prisma.swap.findFirst({
          where: { txHash: data.txHash },
          include: { pool: { include: { token: true } }, user: true },
        });
        if (!swap) logger.error("swap not found", data.txHash);
        else emit.next(swap);
      };

      // trigger `onAddSwap()` when `addSwap` is triggered in our event emitter
      ee.on("addSwap", onAddSwap);

      // unsubscribe function when client disconnects or stops subscribing
      return () => {
        ee.off("addSwap", onAddSwap);
      };
    });
  }),
  addToken: t.procedure
    .meta({ openapi: { method: "GET", path: "/add-token" } })
    .input(z.object({ address: z.string() }))
    .output(z.object({}).optional())
    .mutation(async ({ input }) => {
      ee.emit("addToken", input);
      return input;
    }),
  onAddToken: t.procedure.subscription(() => {
    // return an `observable` with a callback which is triggered immediately
    return observable<Prisma.TokenGetPayload<{ include: { dev: true } }>>(
      (emit) => {
        const onAddToken = async (data: { address: string }) => {
          // emit data to client
          const token = await prisma.token.findFirst({
            where: { address: data.address },
            include: { dev: true },
          });
          if (!token) logger.error("token not found", data.address);
          else emit.next(token);
        };

        // trigger `onAddToken()` when `addToken` is triggered in our event emitter
        ee.on("addToken", onAddToken);

        // unsubscribe function when client disconnects or stops subscribing
        return () => {
          ee.off("addToken", onAddToken);
        };
      }
    );
  }),
  wsTest: t.procedure.subscription(() => {
    return observable<{ text: string }>((emit) => {
      const onAdd = () => {
        emit.next({ text: Math.random().toString(6) });
      };

      const interval = setInterval(() => {
        onAdd();
      }, 1000);

      // unsubscribe function when client disconnects or stops subscribing
      return () => {
        clearInterval(interval);
      };
    });
  }),
  markNSFW: t.procedure
    .meta({ openapi: { method: "GET", path: nsfwPath } })
    .input(z.object({ address: z.string() }))
    .output(z.boolean())
    .query(async ({ input }) => {
      const { address } = input;
      const success = await prisma.token
        .update({
          where: { address },
          data: { nsfw: true },
        })
        .then(() => true);
      return success;
    }),
  createToken: t.procedure
    .input(
      z.object({
        createdBy: z.string(), // TODO: unsafe
        address: z.string(),
        name: z.string().min(3).max(100),
        symbol: z.string().min(3).max(8),
        imageURI: z.string().url(),
        telegram: z.string().url().optional(),
        twitter: z.string().url().optional(),
        website: z.string().url().optional(),
        description: z.string().max(300).optional(),
      })
    )
    // TODO
    // .mutation(async ({ input, ctx }) => {
    .query(async ({ input, ctx }) => {
      return ctx.prisma.token.create({
        data: {
          ...input,
          createdBy: undefined,
          dev: {
            connectOrCreate: {
              create: { address: input.createdBy },
              where: { address: input.createdBy },
            },
          },
          decimals: tokenDecimals,
        },
      });
    }),
  getToken: t.procedure
    .input(z.object({ address: z.string() }))
    .query(async ({ input, ctx }) => {
      const { address } = input;
      return ctx.prisma.token.findUniqueOrThrow({
        where: { address },
        include: {
          dev: true,
          comments: true,
          pools: {
            include: {
              swapTxs: {
                take: 1,
                orderBy: { timestamp: "desc" },
                select: {
                  afterReserve0: true,
                  afterPrice: true,
                },
              },
            },
          },
        },
      });
    }),
  searchToken: t.procedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      const { query } = input;
      const tokens = await ctx.prisma.token.findMany({
        where: {
          OR: [
            { address: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { symbol: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { website: { contains: query, mode: "insensitive" } },
            { telegram: { contains: query, mode: "insensitive" } },
            { twitter: { contains: query, mode: "insensitive" } },
          ],
        },
        include: {
          dev: true,
          comments: true,
          pools: {
            include: {
              swapTxs: {
                take: 1,
                orderBy: { timestamp: "desc" },
                select: {
                  afterReserve0: true,
                  afterPrice: true,
                },
              },
            },
          },
        },
      });

      return tokens.map((token) => {
        const latestSwap = token.pools[0].swapTxs[0];
        return {
          ...token,
          latest_swap_reserve0: latestSwap.afterReserve0 || null,
          latest_swap_after_price: latestSwap.afterPrice || null,
        };
      });
    }),
  getTokens: t.procedure.query(async ({ ctx }) => {
    return ctx.prisma.$queryRaw<
      (Pool &
        Token & {
          latest_swap_timestamp: number;
          latest_swap_after_price: number;
          latest_swap_reserve0: string;
          dev: {
            username: string;
            profileImageURI: string;
          };
          comments: {
            id: number;
          }[];
        })[]
    >`
        SELECT
  p.*,
  sub.latest_swap_timestamp,
  sub.latest_swap_after_price,
  sub.latest_swap_reserve0,  
  t.*,
  json_build_object(
    'username', u."username",
    'profileImageURI', u."profileImageURI"
  ) AS dev,
  coalesce(
    json_agg(json_build_object(
      'id', c.id
    )) FILTER (WHERE c.id IS NOT NULL), '[]') AS comments
FROM
  "Pool" p
  LEFT JOIN (
    SELECT
      s1."poolAddress",
      MAX(s1."timestamp") AS latest_swap_timestamp,
      (SELECT s2."afterPrice"
       FROM "Swap" s2
       WHERE s2."poolAddress" = s1."poolAddress"
       ORDER BY s2."timestamp" DESC
       LIMIT 1) AS latest_swap_after_price,
      (SELECT s2."afterReserve0"
       FROM "Swap" s2
       WHERE s2."poolAddress" = s1."poolAddress"
       ORDER BY s2."timestamp" DESC
       LIMIT 1) AS latest_swap_reserve0
    FROM
      "Swap" s1
    GROUP BY
      s1."poolAddress"
  ) sub ON p.address = sub."poolAddress"
  LEFT JOIN "Token" t ON p."tokenAddress" = t."address"
  LEFT JOIN "User" u ON t."createdBy" = u."address"
  LEFT JOIN "Comment" c ON t."address" = c."tokenAddress"
GROUP BY
  p.address, sub.latest_swap_timestamp, sub.latest_swap_after_price, sub.latest_swap_reserve0, t.address, u."username", u."profileImageURI"
ORDER BY
  COALESCE(sub.latest_swap_timestamp, t."createdAt") DESC;
      `;
  }),
  getTokenValue: t.procedure
    .input(z.object({ tokenAddress: z.string(), tokenDecimals: z.number() }))
    .query(async ({ input }) => {
      const { tokenAddress, tokenDecimals } = input;
      if (!tokenAddress) return 0;
      const token = toToken({ address: tokenAddress, decimals: tokenDecimals });
      return getTokenValue(token).catch((err) => {
        logger.error(`${token.address} getTokenValue`, err);
        return 0;
      });
    }),
  getUser: t.procedure
    .input(z.object({ address: z.string() }))
    .query(async ({ input, ctx }) => {
      const { address } = input;
      return ctx.prisma.user.findUnique({
        where: { address },
        include: {
          comments: true,
          swapTxs: {
            include: { pool: { include: { token: true } } },
            orderBy: { timestamp: "desc" },
          },
        },
      });
    }),
  getUsernames: t.procedure
    .input(z.array(z.string()))
    .query(async ({ input, ctx }) => {
      const addresses = input;
      return ctx.prisma.user.findMany({
        where: { address: { in: addresses } },
        select: { address: true, username: true },
      });
    }),
  setUser: t.procedure
    .input(
      z.object({
        address: z.string(),
        username: z
          .string()
          .max(10)
          .regex(/^([A-Za-z0-9_]*)$/)
          .optional(),
        profileImageURI: z.string().url().optional(),
        bio: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const accessToken = ctx.req.headers.authorization?.split(" ")[1] || "";
      if (!accessToken) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "JWT must be provided",
        });
      }

      const { address, profileImageURI, bio } = input;
      const username = input.username || null;

      const x = jwt.verify(accessToken, JWT_SECRET) as {
        address: string;
        test: string;
        iat: number;
      };
      if (x.address !== address) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Wrong JWT",
        });
      }
      const currentInfo = await ctx.prisma.user.findUnique({
        where: { address },
      });

      if (username !== currentInfo?.username) {
        if (
          currentInfo?.lastUsernameChange &&
          currentInfo.lastUsernameChange >= new Date(Date.now() - ONE_DAY)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only change your username once per day",
          });

        if (username) {
          const user = await ctx.prisma.user.findFirst({ where: { username } });
          if (user) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Username already taken",
            });
          }
        }
      }

      return await ctx.prisma.user.upsert({
        where: { address },
        create: {
          address,
          username,
          profileImageURI: profileImageURI ?? "",
          bio: bio ?? "",
          lastUsernameChange: username ? new Date() : undefined,
        },
        update: {
          username,
          profileImageURI: profileImageURI ?? "",
          bio: bio ?? "",
          lastUsernameChange:
            username && username !== currentInfo?.username
              ? new Date()
              : currentInfo?.lastUsernameChange,
        },
      });
    }),
  getLastSwap: t.procedure.query(async ({ ctx }) => {
    return ctx.prisma.swap.findFirst({
      orderBy: { timestamp: "desc" },
      include: { pool: { include: { token: true } }, user: true },
    });
  }),
  getLastCreate: t.procedure.query(async ({ ctx }) => {
    return ctx.prisma.token.findFirst({
      orderBy: { createdAt: "desc" },
      include: { dev: true },
    });
  }),
  getRecentSwaps: t.procedure
    .input(z.object({ poolAddress: z.string(), take: z.number().lte(100) }))
    .query(async ({ input, ctx }) => {
      const { poolAddress, take } = input;
      return ctx.prisma.swap.findMany({
        where: { poolAddress },
        orderBy: { timestamp: "desc" },
        include: { pool: { include: { token: true } }, user: true },
        take,
      });
    }),
  // used for type infering
  getSwap: t.procedure
    .input(z.object({ txHash: z.string() }))
    .query(async ({ input, ctx }) => {
      const { txHash } = input;
      return ctx.prisma.swap.findFirst({
        where: { txHash },
        include: { pool: { include: { token: true } }, user: true },
      });
    }),
  getComments: t.procedure
    .input(z.object({ tokenAddress: z.string() }))
    .query(async ({ input, ctx }) => {
      const { tokenAddress } = input;
      return ctx.prisma.comment.findMany({
        where: { tokenAddress },
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });
    }),
  postComment: t.procedure
    .input(
      z.object({
        tokenAddress: z.string(),
        userAddress: z.string(),
        text: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const accessToken = ctx.req.headers.authorization?.split(" ")[1] || "";
      if (!accessToken) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "JWT must be provided",
        });
      }
      const { tokenAddress, userAddress, text } = input;

      const x = jwt.verify(accessToken, JWT_SECRET) as {
        address: string;
        test: string;
        iat: number;
      };
      if (x.address !== userAddress) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Wrong JWT",
        });
      }
      return ctx.prisma.comment.create({
        data: {
          user: {
            connectOrCreate: {
              create: { address: userAddress },
              where: { address: userAddress },
            },
          },
          message: text,
          token: { connect: { address: tokenAddress } },
        },
      });
    }),
  login: t.procedure
    .input(
      z.object({
        address: z.string(),
        publicKey: z.string(),
        message: z.string(),
        signature: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { address, publicKey, message, signature } = input;
      const isVerified = await web3Client
        .wallet()
        .verifySignature(message, { base58Encoded: signature, publicKey });

      const accessToken = jwt.sign({ address, test: "x" }, JWT_SECRET);
      return {
        accessToken: isVerified ? accessToken : null,
      };
    }),
});

export const expressMiddleware = trpcExpress.createExpressMiddleware({
  router: appRouter,
  createContext,
  responseMeta(opts) {
    const { ctx, errors, type } = opts;
    // checking that no procedures errored
    const allOk = errors.length === 0;

    // checking we're doing a query request
    const isQuery = type === "query";
    if (ctx?.res && allOk && isQuery) {
      return {
        headers: {
          "cache-control": `stale-while-revalidate=${ONE_HOUR / 1000}`,
        },
      };
    }
    return {};
  },
  onError(opts) {
    const { error, path, input } = opts;
    logger.warn(
      "path: " +
        path +
        " msg: " +
        error.message +
        " input:" +
        JSON.stringify(input)
    );
  },
});

// export type definition of API
export type AppRouter = typeof appRouter;
