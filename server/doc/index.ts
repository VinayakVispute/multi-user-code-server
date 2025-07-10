import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import { clerkClient, clerkMiddleware } from "@clerk/express";
import { allocateMachine } from "../src/utils/allocateMachine";
import redis from "../src/lib/redis";

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

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.post(
  "/api/machines/allocate",
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
          message: "Unauthorized",
          error: "Unauthorized",
          success: false,
          status: "error",
        });
        return;
      }
      const allocatedMachineResponse = await allocateMachine(userId);

      if (allocatedMachineResponse.success) {
        res.status(200).json({
          message: allocatedMachineResponse.message,
          data: allocatedMachineResponse.data,
          success: true,
          status: allocatedMachineResponse.status,
        });
      } else {
        res.status(500).json({
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
      res.status(401).json({
        error: "Unauthorized",
        message: "Missing user or instanceId in request",
      });
      return;
    }

    const instanceKey = `inst:${instanceId}`;

    const user = await redis.get(instanceKey);

    if (!user) {
      console.error("Ping request for unknown instanceId:", instanceId);
      res.status(404).json({
        error: "Not Found",
        message: "Instance not found",
      });
      return;
    }

    const wsKey = `ws:${user}`;

    await redis
      .multi()
      .hmset(wsKey, {
        lastSeen: now.toString(),
        state: "RUNNING",
      })
      .zadd("ws:pings", now, user)
      .exec();

    console.log(
      `Ping received from user: ${user} and with instanceId: ${instanceId}`
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

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
