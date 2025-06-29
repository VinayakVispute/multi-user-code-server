import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import { clerkClient, clerkMiddleware } from "@clerk/express";
import { allocateMachine } from "./utils/allocateMachine";

// Extend Express Request type to include Clerk auth
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
    origin: "*", // or use '*' for all origins
    // methods: ["GET", "POST"],
    credentials: true, // if you're using cookies
  })
);

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Auth validation endpoint for nginx auth_request
app.get(
  "/auth/validate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.auth || {};

      if (!userId) {
        console.log("Auth validation failed: No userId found");
        res.status(401).json({
          error: "Unauthorized",
          message: "No valid session found",
        });
        return;
      }

      // Optionally verify the user exists in Clerk
      const user = await clerkClient.users.getUser(userId);
      if (!user) {
        console.log("Auth validation failed: User not found in Clerk");
        res.status(401).json({
          error: "Unauthorized",
          message: "User not found",
        });
        return;
      }

      // Set headers that nginx can use
      res.set({
        "X-User-ID": userId,
        "X-User-Email": user.primaryEmailAddress?.emailAddress || "",
        "X-User-Name": `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      });

      console.log(`Auth validation successful for user: ${userId}`);
      res.status(200).json({
        success: true,
        userId: userId,
        message: "Authentication successful",
      });
    } catch (error) {
      console.error("Auth validation error:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Authentication service error",
      });
    }
  }
);

app.post("/api/machines/allocate", async (req: Request, res: Response) => {
  const { userId } = req.auth || {};

  if (!userId) {
    res.status(401).json({
      message: "Unauthorized",
      error: "Unauthorized",
      success: false,
      status: "error",
    });
    return;
  }

  const user = await clerkClient.users.getUser(userId);

  if (!user) {
    res.status(404).json({
      message: "User not found",
      error: "UserNotFound",
      success: false,
      status: "error",
    });
    return;
  }

  // const response = await allocateMachine(user.id );

  // if (!response.success) {
  //   console.error("Error allocating machine:", response.error);
  //   res.status(500).json({
  //     message: response.message,
  //     error: response.error,
  //     success: false,
  //     status: "error",
  //   });
  //   return;
  // }

  // res.status(200).json({
  //   success: true,
  //   status: "success",
  //   message: response.message,
  //   data: {
  //     instanceId: response.data?.publicUrl || null,
  //   },
  // });
  res.redirect(302, "https://ec2-44-202-24-187.compute-1.amazonaws.com");
  return;
});

app.post("/ping", async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.auth || {};

    if (!userId) {
      console.log("Ping failed: No userId found");
      res.status(401).json({
        error: "Unauthorized",
        message: "No valid session found",
      });
      return;
    }

    // Update Redis with user's last seen timestamp
    // TODO: Add Redis update for user activity tracking
    // await redis.zadd("ws:pings", Date.now(), userId);
    // await redis.hset(`ws:${userId}`, "lastSeen", Date.now());

    console.log(`Ping received from user: ${userId}`);
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
