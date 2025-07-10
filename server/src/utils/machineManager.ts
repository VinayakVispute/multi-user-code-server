import { MAX_MACHINES, WARM_SPARE_COUNT } from "../config/awsConfig";
import { INSTANCE_STATE } from "../enum";
import {
  CleanupResult,
  ErrorResponse,
  SuccessResponse,
  WorkspaceInfo,
} from "../types";
import {
  getASGInstancesInfo,
  getCurrentASGCapacity,
  getInstanceIP,
  protectActiveInstances,
  safelyTerminateInstance,
  tagInstance,
  updateASGCapacity,
} from "./aws";
import {
  cleanupUserData,
  getActiveUserCount,
  getIdleUsers,
  getUserWorkspace,
  getWarmPoolSize,
  popWarmSpare,
  removeFromWarmPool,
  setUserWorkspace,
} from "./redis";

export async function ensureCapacity(): Promise<void> {
  try {
    const activeUsers = await getActiveUserCount();
    const desired = Math.min(activeUsers + WARM_SPARE_COUNT, MAX_MACHINES);
    const current = await getCurrentASGCapacity();

    if (desired > current) {
      await updateASGCapacity(desired);
      console.log(`[scale-up] ASG capacity: ${current} → ${desired}`);
    }
  } catch (error) {
    console.error("Failed to ensure capacity:", error);
    throw error;
  }
}

export async function allocateMachine(
  userId: string
): Promise<SuccessResponse | ErrorResponse> {
  try {
    const now = Date.now();

    const existingWorkspace = await getUserWorkspace(userId);

    if (
      existingWorkspace?.state === INSTANCE_STATE.RUNNING &&
      existingWorkspace?.publicIp
    ) {
      console.log(
        `User ${userId} already has running machine: ${existingWorkspace.instanceId}`
      );
      return {
        success: true,
        message: "Machine already allocated",
        status: "success",
        data: {
          instanceId: existingWorkspace.instanceId,
          publicUrl: existingWorkspace.publicIp,
        },
      };
    }

    const instanceId = await popWarmSpare();

    if (!instanceId) {
      console.warn("No warm spare available for user:", userId);
      // Trigger capacity increase and ask user to retry
      await ensureCapacity();
      return {
        success: false,
        message: "No available machines. Please try again in a moment.",
        status: "processing",
        error: "No warm spare available",
      };
    }
    const publicIp = await getInstanceIP(instanceId);

    if (!publicIp) {
      console.error(`Failed to retrieve public IP for instance ${instanceId}`);
      return {
        success: false,
        message: "Failed to retrieve machine IP",
        status: "error",
        error: "Public IP not found for instance",
      };
    }

    // Tag instance as owned by user
    await tagInstance(instanceId, userId);

    // Protect instance from ASG scale-in
    await protectActiveInstances([instanceId]);

    // Store allocation in Redis
    const workspace: WorkspaceInfo = {
      instanceId,
      publicIp,
      lastSeen: now.toString(),
      state: INSTANCE_STATE.RUNNING,
      ts: now.toString(),
    };

    await setUserWorkspace(userId, workspace);

    // Ensure we maintain adequate capacity
    await ensureCapacity();

    console.log(`Allocated machine ${instanceId} to user ${userId}`);

    return {
      success: true,
      message: "Machine allocated successfully",
      status: "success",
      data: { instanceId, publicUrl: publicIp },
    };
  } catch (error) {
    console.error(`Failed to allocate machine for user ${userId}:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getSystemStatus(): Promise<{
  activeUsers: number;
  warmSpares: number;
  totalInstances: number;
  asgCapacity: number;
  instanceDetails: any[];
}> {
  try {
    const [activeUsers, warmSpares, asgCapacity, instancesInfo] =
      await Promise.all([
        getActiveUserCount(),
        getWarmPoolSize(),
        getCurrentASGCapacity(),
        getASGInstancesInfo(),
      ]);

    return {
      activeUsers,
      warmSpares,
      totalInstances: instancesInfo.length,
      asgCapacity,
      instanceDetails: instancesInfo,
    };
  } catch (error) {
    console.error("Failed to get system status:", error);
    throw error;
  }
}
