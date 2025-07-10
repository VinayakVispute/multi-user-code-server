import e from "cors";
import { CleanupResult } from "../types";
import {
  getASGInstancesInfo,
  getCurrentASGCapacity,
  protectActiveInstances,
  safelyTerminateInstance,
  updateASGCapacity,
} from "./aws";
import {
  cleanupUserData,
  getActiveUserCount,
  getIdleUsers,
  getUserWorkspace,
  getWarmPoolSize,
  removeFromWarmPool,
} from "./redis";
import { WARM_SPARE_COUNT } from "../config/awsConfig";

export async function cleanupIdleMachines(): Promise<CleanupResult> {
  const result: CleanupResult = {
    terminatedInstances: [],
    cleanedUsers: [],
    errors: [],
  };

  try {
    console.log("Starting idle machine cleanup...");

    // Get idle users from Redis
    const idleUsers = await getIdleUsers();

    if (idleUsers.length === 0) {
      console.log("No idle users found");
      return result;
    }

    console.log(
      `Found ${idleUsers.length} idle users: ${idleUsers.join(", ")}`
    );

    // Process each idle user
    for (const userId of idleUsers) {
      try {
        const workspace = await getUserWorkspace(userId);

        if (!workspace || !workspace.instanceId) {
          console.warn(`No workspace found for idle user: ${userId}`);
          continue;
        }

        const instanceId = workspace.instanceId;
        console.log(
          `Terminating instance ${instanceId} for idle user ${userId}`
        );

        // Remove from warm pool if it's there
        await removeFromWarmPool(instanceId);

        // Safely terminate the instance (decrements ASG capacity)
        await safelyTerminateInstance(instanceId);

        // Clean up Redis data
        await cleanupUserData(userId, instanceId);

        result.terminatedInstances.push(instanceId);
        result.cleanedUsers.push(userId);

        console.log(
          `Successfully cleaned up user ${userId}, instance ${instanceId}`
        );
      } catch (error) {
        const errorMsg = `Failed to cleanup user ${userId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    console.log(
      `Cleanup completed. Terminated: ${result.terminatedInstances.length}, Cleaned: ${result.cleanedUsers.length}, Errors: ${result.errors.length}`
    );
  } catch (error) {
    const errorMsg = `Cleanup process failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    console.error(errorMsg);
    result.errors.push(errorMsg);
  }

  return result;
}

export async function safeScaleDown(targetCapacity: number): Promise<void> {
  try {
    console.log(`Starting safe scale down to ${targetCapacity}...`);

    const currentCapacity = await getCurrentASGCapacity();

    if (targetCapacity >= currentCapacity) {
      console.log("No scale down needed");
      return;
    }

    // Get all instances and identify active ones
    const instancesInfo = await getASGInstancesInfo();
    const activeInstances = instancesInfo
      .filter((instance) => instance.isActive)
      .map((instance) => instance.instanceId);

    // Protect active instances
    if (activeInstances.length > 0) {
      await protectActiveInstances(activeInstances);
      console.log(`Protected ${activeInstances.length} active instances`);
    }

    // Scale down - ASG will only terminate unprotected instances
    await updateASGCapacity(targetCapacity);

    console.log(`Scaled down from ${currentCapacity} to ${targetCapacity}`);
  } catch (error) {
    console.error("Failed to scale down safely:", error);
    throw error;
  }
}

export async function ensureOptimalWarmSpares(): Promise<void> {
  try {
    const activeUsers = await getActiveUserCount();
    const warmPoolSize = await getWarmPoolSize();
    const currentCapacity = await getCurrentASGCapacity();
    const targetCapacity = activeUsers + WARM_SPARE_COUNT;

    console.log(
      `Capacity check - Active: ${activeUsers}, Warm: ${warmPoolSize}, Current: ${currentCapacity}, Target: ${targetCapacity}`
    );

    if (currentCapacity < targetCapacity) {
      // Scale up
      await updateASGCapacity(targetCapacity);
      console.log(`Scaled up to ${targetCapacity}`);
    } else if (
      currentCapacity > targetCapacity &&
      warmPoolSize > WARM_SPARE_COUNT
    ) {
      // Too many warm spares, scale down safely
      await safeScaleDown(targetCapacity);
      console.log(`Scaled down to ${targetCapacity}`);
    }
  } catch (error) {
    console.error("Failed to ensure optimal warm spares:", error);
    throw error;
  }
}

/**
 * Start periodic cleanup process
 */
export function startCleanupProcess(): NodeJS.Timeout {
  console.log("Starting periodic cleanup process...");

  const cleanupInterval = setInterval(async () => {
    try {
      // Clean up idle machines
      await cleanupIdleMachines();

      // Ensure optimal capacity
      await ensureOptimalWarmSpares();
    } catch (error) {
      console.error("Periodic cleanup error:", error);
    }
  }, 60000); // Run every minute

  return cleanupInterval;
}

/**
 * Stop cleanup process
 */
export function stopCleanupProcess(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  console.log("Stopped cleanup process");
}
