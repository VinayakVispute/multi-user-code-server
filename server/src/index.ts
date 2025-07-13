import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import { clerkClient, clerkMiddleware } from "@clerk/express";
import {
  getUserFromInstance,
  updateUserPing,
  getUserWorkspace,
} from "./utils/redis";
import { allocateMachine, getSystemStatus } from "./utils/machineManager";
import { webhookHandler } from "./utils/webhook";

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

console.log("🚀 Starting Code Server Manager...");

app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
    debug: true,
  })
);

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`📥 [${timestamp}] ${req.method} ${req.path}`);
  console.log(`🔗 User-Agent: ${req.get("User-Agent") || "Unknown"}`);
  console.log(`🌐 IP: ${req.ip || req.connection.remoteAddress}`);

  if (req.auth?.userId) {
    console.log(`👤 Authenticated User: ${req.auth.userId}`);
  }

  // Log response time when request completes
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `📤 [${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });

  next();
});

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://your-production-domain.com", // Add your production domain when deployed
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

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  console.log("💓 Health check requested");
  res.status(200).json({
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

// System status endpoint (admin only - add proper auth)
app.get("/api/status", async (req: Request, res: Response): Promise<void> => {
  console.log("📊 System status requested");
  try {
    // TODO: Add admin authentication check here
    const status = await getSystemStatus();
    console.log("✅ System status retrieved successfully:", {
      activeUsers: status.activeUsers,
      warmSpares: status.warmSpares,
      totalInstances: status.totalInstances,
      asgCapacity: status.asgCapacity,
    });
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("❌ Status endpoint error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get system status",
    });
  }
});

app.post(
  `/api/v1/machines/allocate`,
  async (req: Request, res: Response): Promise<void> => {
    console.log("🖥️  Machine allocation requested");
    try {
      const { userId } = req.auth || {};

      if (!userId) {
        console.warn("⚠️  Unauthorized allocation attempt - no userId");
        res.status(401).json({
          message: "Unauthorized",
          error: "User not authenticated",
          success: false,
          status: "error",
        });
        return;
      }

      console.log(`👤 Fetching user details for: ${userId}`);
      const user = await clerkClient.users.getUser(userId);

      if (!user) {
        console.error(`❌ User not found in Clerk: ${userId}`);
        res.status(404).json({
          message: "User not found",
          error: "User not found in authentication system",
          success: false,
          status: "error",
        });
        return;
      }

      const userEmail = user.emailAddresses[0]?.emailAddress || "No email";
      console.log(`🚀 Allocating machine for user: ${userId} (${userEmail})`);

      const allocatedMachineResponse = await allocateMachine(userId);

      if (allocatedMachineResponse.success) {
        console.log(`✅ Machine allocated successfully:`, {
          userId,
          instanceId: allocatedMachineResponse.data?.instanceId,
          publicUrl: allocatedMachineResponse.data?.publicUrl,
        });
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
        console.warn(`⚠️  Machine allocation failed for ${userId}:`, {
          status: allocatedMachineResponse.status,
          message: allocatedMachineResponse.message,
          error: allocatedMachineResponse.error,
        });
        res.status(statusCode).json({
          message: allocatedMachineResponse.message,
          error: allocatedMachineResponse.error,
          success: false,
          status: allocatedMachineResponse.status,
        });
      }
    } catch (err) {
      console.error("❌ Critical error in machine allocation:", err);
      res.status(500).json({
        message: "Internal Server Error",
        error: "Failed to allocate machine",
        success: false,
        status: "error",
      });
    }
  }
);

// Get current user's workspace status
app.get(
  `/api/v1/machines/status`,
  async (req: Request, res: Response): Promise<void> => {
    console.log("📋 Workspace status requested");
    try {
      const { userId } = req.auth || {};

      if (!userId) {
        console.warn("⚠️  Unauthorized status request - no userId");
        res.status(401).json({
          message: "Unauthorized",
          error: "User not authenticated",
          success: false,
          status: "error",
        });
        return;
      }

      console.log(`🔍 Fetching workspace status for user: ${userId}`);
      const workspace = await getUserWorkspace(userId);

      if (workspace) {
        console.log(`✅ Workspace found for ${userId}:`, {
          instanceId: workspace.instanceId,
          publicUrl: workspace.publicIp,
          state: workspace.state,
          lastSeen: workspace.lastSeen,
        });
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
        console.log(`ℹ️  No active workspace found for user: ${userId}`);
        res.status(404).json({
          success: false,
          message: "No active workspace found",
        });
      }
    } catch (error) {
      console.error("❌ Error getting workspace status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get workspace status",
      });
    }
  }
);

app.post("/ping", async (req: Request, res: Response): Promise<void> => {
  const timestamp = new Date().toISOString();
  console.log(`💓 [${timestamp}] Ping received`);

  try {
    const { instanceId } = req.body;
    const now = Date.now();

    if (!instanceId) {
      console.error("❌ Ping request missing instanceId");
      console.log("📋 Request body:", JSON.stringify(req.body, null, 2));
      res.status(400).json({
        error: "Bad Request",
        message: "Missing instanceId in request",
      });
      return;
    }

    console.log(`🔍 Looking up user for instance: ${instanceId}`);
    const userId = await getUserFromInstance(instanceId);

    if (!userId) {
      console.error(`❌ Ping request for unknown instanceId: ${instanceId}`);
      res.status(404).json({
        error: "Not Found",
        message: "Instance not found",
      });
      return;
    }

    console.log(
      `📡 Updating ping for user: ${userId}, instance: ${instanceId}`
    );
    await updateUserPing(userId, instanceId);

    console.log(
      `✅ Ping processed successfully - User: ${userId}, Instance: ${instanceId}`
    );
    res.status(200).json({
      success: true,
      message: "Pong",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Ping endpoint error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Ping service error",
    });
  }
});

console.log("🎣 Setting up webhook endpoint: /webhook/asg");
app.post("/webhook/asg", webhookHandler);

// Error handling middleware
app.use(
  (err: Error, req: Request, res: Response, next: express.NextFunction) => {
    console.error("💥 Unhandled error occurred:");
    console.error("🔍 Error details:", err);
    console.error("📋 Request details:", {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
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

// 404 handler
app.use((req: Request, res: Response) => {
  console.warn(`🚫 404 - Endpoint not found: ${req.method} ${req.path}`);
  console.log("🔍 Available endpoints logged above during startup");

  res.status(404).json({
    success: false,
    error: "Not Found",
    message: "Endpoint not found",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
