import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import { clerkClient, clerkMiddleware } from "@clerk/express";
import { allocateMachine } from "../doc/allocateMachine";
import { getUserFromInstance, updateUserPing } from "./utils/redis";
import { getSystemStatus } from "./utils/machineManager";

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
      "https://your-production-domain.com", // Add your production domain when deployed
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});
// System status endpoint (admin only - add proper auth)
app.get("/api/status", async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Add admin authentication check here
    const status = await getSystemStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Status endpoint error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get system status",
    });
  }
});

app.post(
  `/api/v1/machines/allocate`,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.auth || {};

      if (!userId) {
        res.status(401).json({
          message: "Unauthorized",
          error: "User not authenticated",
          success: false,
          status: "error",
        });
        return;
      }

      const user = await clerkClient.users.getUser(userId);

      if (!user) {
        res.status(404).json({
          message: "User not found",
          error: "User not found in authentication system",
          success: false,
          status: "error",
        });
        return;
      }

      console.log(
        `Allocating machine for user: ${userId} (${user.emailAddresses[0]?.emailAddress})`
      );

      const allocatedMachineResponse = await allocateMachine(userId);

      if (allocatedMachineResponse.success) {
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
        res.status(statusCode).json({
          message: allocatedMachineResponse.message,
          error: allocatedMachineResponse.error,
          success: false,
          status: allocatedMachineResponse.status,
        });
      }
    } catch (err) {
      console.error("Error allocating machine:", err);
      res.status(500).json({
        message: "Internal Server Error",
        error: "Failed to allocate machine",
        success: false,
        status: "error",
      });
    }
  }
);

app.post("/ping", async (req: Request, res: Response): Promise<void> => {
  try {
    const { instanceId } = req.body;
    const now = Date.now();

    if (!instanceId) {
      console.error("Ping request missing user or instanceId");
      res.status(400).json({
        error: "Bad Request",
        message: "Missing instanceId in request",
      });
      return;
    }

    const userId = await getUserFromInstance(instanceId);

    if (!userId) {
      console.error("Ping request for unknown instanceId:", instanceId);
      res.status(404).json({
        error: "Not Found",
        message: "Instance not found",
      });
      return;
    }

    await updateUserPing(userId, instanceId);

    console.log(
      `Ping received from user: ${userId} and with instanceId: ${instanceId}`
    );
    res.status(200).json({
      success: true,
      message: "Pong",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Ping endpoint error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Ping service error",
    });
  }
});

// Error handling middleware
app.use(
  (err: Error, req: Request, res: Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
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
  res.status(404).json({
    success: false,
    error: "Not Found",
    message: "Endpoint not found",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
