import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import { clerkClient, clerkMiddleware } from "@clerk/express";
import {
  getUserFromInstance,
  updateUserPing,
  getUserWorkspace,
} from "./utils/redisUtils";
import { allocateMachine, getSystemStatus } from "./utils/machineManager";
import { webhookHandler } from "./utils/webhook";
import logger from "./utils/logger";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId?: string;
        sessionId?: string;
        orgId?: string;
      };
    }
  }
}

const app = express();
dotenv.config();

const PORT = process.env.PORT || 3000;

app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
    debug: true,
  })
);

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://your-production-domain.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);

app.use(
  express.json({
    type: ["application/json", "text/plain"],
  })
);

app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req: Request, res: Response) => {
  const functionName = "healthCheck";
  const requestId = logger.getRequestId(req);

  logger.debug(`[${requestId}] [${functionName}] Health check requested`);

  const healthData = {
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
  };

  logger.info(`[${requestId}] [${functionName}] Health check successful`, {
    uptime: healthData.uptime,
  });

  res.status(200).json(healthData);
});

app.get("/api/status", async (req: Request, res: Response): Promise<void> => {
  const functionName = "getStatus";
  const requestId = logger.getRequestId(req);

  logger.debug(`[${requestId}] [${functionName}] System status requested`);

  try {
    const status = await getSystemStatus(requestId);

    logger.info(
      `[${requestId}] [${functionName}] System status retrieved successfully`,
      {
        activeUsers: status.activeUsers,
        warmSpares: status.warmSpares,
        totalInstances: status.totalInstances,
        asgCapacity: status.asgCapacity,
      }
    );

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error(
      `[${requestId}] [${functionName}] Failed to get system status`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );

    res.status(500).json({
      success: false,
      error: "Failed to get system status",
    });
  }
});

app.post(
  `/api/v1/machines/allocate`,
  async (req: Request, res: Response): Promise<void> => {
    const functionName = "allocateMachine";
    const requestId = logger.getRequestId(req);

    logger.info(
      `[${requestId}] [${functionName}] Machine allocation requested`
    );

    try {
      const { userId } = req.auth || {};

      if (!userId) {
        logger.error(
          `[${requestId}] [${functionName}] Unauthorized request - no userId`
        );
        res.status(401).json({
          message: "Unauthorized",
          error: "User not authenticated",
          success: false,
          status: "error",
        });
        return;
      }

      logger.debug(
        `[${requestId}] [${functionName}] Fetching user from Clerk`,
        { userId }
      );
      const user = await clerkClient.users.getUser(userId);

      if (!user) {
        logger.error(
          `[${requestId}] [${functionName}] User not found in Clerk`,
          { userId }
        );
        res.status(404).json({
          message: "User not found",
          error: "User not found in authentication system",
          success: false,
          status: "error",
        });
        return;
      }

      const userEmail = user.emailAddresses[0]?.emailAddress || "No email";
      logger.debug(`[${requestId}] [${functionName}] User authenticated`, {
        userId,
        userEmail,
      });

      const allocatedMachineResponse = await allocateMachine(userId, requestId);

      if (allocatedMachineResponse.success) {
        logger.info(
          `[${requestId}] [${functionName}] Machine allocated successfully`,
          {
            userId,
            instanceId: allocatedMachineResponse.data?.instanceId,
            publicUrl: allocatedMachineResponse.data?.publicUrl,
          }
        );

        res.status(200).json({
          message: allocatedMachineResponse.message,
          data: allocatedMachineResponse.data,
          success: true,
          status: allocatedMachineResponse.status,
        });
        return;
      } else {
        const statusCode =
          allocatedMachineResponse.status === "processing" ? 202 : 500;

        logger.warn(
          `[${requestId}] [${functionName}] Machine allocation failed`,
          {
            userId,
            status: allocatedMachineResponse.status,
            error: allocatedMachineResponse.error,
          }
        );

        res.status(statusCode).json({
          message: allocatedMachineResponse.message,
          error: allocatedMachineResponse.error,
          success: false,
          status: allocatedMachineResponse.status,
        });
      }
    } catch (err) {
      logger.error(`[${requestId}] [${functionName}] Internal server error`, {
        error: err instanceof Error ? err.message : "Unknown error",
      });

      res.status(500).json({
        message: "Internal Server Error",
        error: "Failed to allocate machine",
        success: false,
        status: "error",
      });
    }
  }
);

app.get(
  `/api/v1/machines/status`,
  async (req: Request, res: Response): Promise<void> => {
    const functionName = "getMachineStatus";
    const requestId = logger.getRequestId(req);

    logger.debug(`[${requestId}] [${functionName}] Machine status requested`);

    try {
      const { userId } = req.auth || {};

      if (!userId) {
        logger.error(
          `[${requestId}] [${functionName}] Unauthorized request - no userId`
        );
        res.status(401).json({
          message: "Unauthorized",
          error: "User not authenticated",
          success: false,
          status: "error",
        });
        return;
      }

      logger.debug(
        `[${requestId}] [${functionName}] Getting workspace for user`,
        { userId }
      );
      const workspace = await getUserWorkspace(userId, requestId);

      if (workspace) {
        logger.info(
          `[${requestId}] [${functionName}] Workspace found for user`,
          {
            userId,
            instanceId: workspace.instanceId,
            state: workspace.state,
            publicIp: workspace.publicIp,
          }
        );

        res.status(200).json({
          success: true,
          data: {
            instanceId: workspace.instanceId,
            publicUrl: workspace.publicIp,
            state: workspace.state,
            lastSeen: workspace.lastSeen,
            ts: workspace.ts,
          },
        });
      } else {
        logger.debug(
          `[${requestId}] [${functionName}] No workspace found for user`,
          { userId }
        );
        res.status(404).json({
          success: false,
          message: "No active workspace found",
        });
      }
    } catch (error) {
      logger.error(
        `[${requestId}] [${functionName}] Failed to get workspace status`,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );

      res.status(500).json({
        success: false,
        error: "Failed to get workspace status",
      });
    }
  }
);

app.post("/ping", async (req: Request, res: Response): Promise<void> => {
  const functionName = "ping";
  const requestId = logger.getRequestId(req);

  logger.debug(`[${requestId}] [${functionName}] Ping received`, {
    body: req.body,
  });

  try {
    const { instanceId } = req.body;
    const now = Date.now();

    if (!instanceId) {
      logger.error(
        `[${requestId}] [${functionName}] Missing instanceId in ping request`
      );
      res.status(400).json({
        error: "Bad Request",
        message: "Missing instanceId in request",
      });
      return;
    }

    logger.debug(
      `[${requestId}] [${functionName}] Looking up user for instance`,
      { instanceId }
    );
    const userId = await getUserFromInstance(instanceId, requestId);

    if (!userId) {
      logger.warn(`[${requestId}] [${functionName}] Instance not found`, {
        instanceId,
      });
      res.status(404).json({
        error: "Not Found",
        message: "Instance not found",
      });
      return;
    }

    logger.debug(`[${requestId}] [${functionName}] Updating user ping`, {
      userId,
      instanceId,
    });
    await updateUserPing(userId, instanceId, requestId);

    logger.info(`[${requestId}] [${functionName}] Ping successful`, {
      userId,
      instanceId,
      timestamp: now,
    });
    res.status(200).json({
      success: true,
      message: "Pong",
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error(`[${requestId}] [${functionName}] Ping service error`, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    res.status(500).json({
      error: "Internal Server Error",
      message: "Ping service error",
    });
  }
});

app.post("/webhook/asg", webhookHandler);

app.use(
  (err: Error, req: Request, res: Response, next: express.NextFunction) => {
    const functionName = "errorHandler";
    const requestId = logger.getRequestId(req);

    logger.error(`[${requestId}] [${functionName}] Unhandled error`, {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });

    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
);

app.use((req: Request, res: Response) => {
  const functionName = "notFoundHandler";
  const requestId = logger.getRequestId(req);

  logger.warn(`[${requestId}] [${functionName}] Endpoint not found`, {
    url: req.url,
    method: req.method,
  });

  res.status(404).json({
    success: false,
    error: "Not Found",
    message: "Endpoint not found",
  });
});

app.listen(PORT, () => {
  logger.info(`[system] [serverStart] Server started successfully`, {
    port: PORT,
    env: process.env.NODE_ENV,
  });
});
