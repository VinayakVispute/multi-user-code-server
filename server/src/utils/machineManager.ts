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
  removeInstanceProtection,
  safelyTerminateInstance,
  tagInstance,
  updateASGCapacity,
} from "./aws";
import {
  addToWarmPool,
  getActiveUserCount,
  getUserWorkspace,
  getWarmPoolSize,
  popWarmSpare,
  setUserWorkspace,
} from "./redis";

export async function ensureCapacity(): Promise<void> {
  console.log(`🔧 [MachineManager] Ensuring adequate capacity`);
  try {
    const activeUsers = await getActiveUserCount();
    const desired = Math.min(activeUsers + WARM_SPARE_COUNT, MAX_MACHINES);
    const current = await getCurrentASGCapacity();

    console.log(`📊 [MachineManager] Capacity analysis:`, {
      activeUsers,
      warmSpareTarget: WARM_SPARE_COUNT,
      maxMachines: MAX_MACHINES,
      currentCapacity: current,
      desiredCapacity: desired,
    });

    if (desired > current) {
      console.log(`📈 [MachineManager] Scaling up: ${current} → ${desired}`);
      await updateASGCapacity(desired);
      console.log(
        `✅ [MachineManager] ASG capacity updated: ${current} → ${desired}`
      );
    } else {
      console.log(
        `✅ [MachineManager] Capacity is adequate (${current}/${desired})`
      );
    }
  } catch (error) {
    console.error(`❌ [MachineManager] Failed to ensure capacity:`, error);
    throw error;
  }
}

export async function allocateMachine(
  userId: string
): Promise<SuccessResponse | ErrorResponse> {
  console.log(
    `🚀 [MachineManager] Starting machine allocation for user: ${userId}`
  );
  let shouldRollback = false;
  let instanceId: string | null = null;

  try {
    const now = Date.now();

    // Check for existing workspace
    console.log(`🔍 [MachineManager] Checking for existing workspace`);
    const existingWorkspace = await getUserWorkspace(userId);

    if (
      existingWorkspace?.state === INSTANCE_STATE.RUNNING &&
      existingWorkspace?.publicIp
    ) {
      console.log(
        `✅ [MachineManager] User ${userId} already has running machine: ${existingWorkspace.instanceId}`
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

    // Try to get a warm spare
    console.log(`🎯 [MachineManager] Attempting to get warm spare`);
    instanceId = await popWarmSpare();

    if (!instanceId) {
      console.warn(
        `⚠️  [MachineManager] No warm spare available for user: ${userId}`
      );
      console.log(`🔧 [MachineManager] Triggering capacity increase`);
      // Trigger capacity increase and ask user to retry
      await ensureCapacity();
      return {
        success: false,
        message: "No available machines. Please try again in a moment.",
        status: "processing",
        error: "No warm spare available",
      };
    }

    console.log(`✅ [MachineManager] Got warm spare: ${instanceId}`);
    console.log(`🔍 [MachineManager] Getting public IP for instance`);
    const publicIp = await getInstanceIP(instanceId);

    if (!publicIp) {
      console.error(
        `❌ [MachineManager] Failed to retrieve public IP for instance ${instanceId}`
      );
      throw new Error("Instance has no public IP and was terminated");
    }

    console.log(`✅ [MachineManager] Got public IP: ${publicIp}`);

    // From here, if anything fails, we need to rollback

    shouldRollback = true;

    // Tag instance as owned by user
    console.log(`🏷️  [MachineManager] Tagging instance as owned by user`);
    await tagInstance(instanceId, userId);

    // Protect instance from ASG scale-in
    console.log(`🛡️  [MachineManager] Protecting instance from scale-in`);
    await protectActiveInstances([instanceId]);

    // Store allocation in Redis
    console.log(`💾 [MachineManager] Storing allocation in Redis`);
    const workspace: WorkspaceInfo = {
      instanceId,
      publicIp,
      lastSeen: now.toString(),
      state: INSTANCE_STATE.RUNNING,
      ts: now.toString(),
    };

    await setUserWorkspace(userId, workspace);

    // Ensure we maintain adequate capacity
    console.log(
      `🔧 [MachineManager] Ensuring adequate capacity after allocation`
    );
    await ensureCapacity();

    console.log(
      `🎉 [MachineManager] Successfully allocated machine ${instanceId} to user ${userId}`
    );

    return {
      success: true,
      message: "Machine allocated successfully",
      status: "success",
      data: { instanceId, publicUrl: publicIp },
    };
  } catch (error) {
    console.error(
      `❌ [MachineManager] Allocation failed for user ${userId}:`,
      error
    );

    // Simple rollback: only if instance passed IP validation
    if (instanceId && shouldRollback) {
      console.log(`🔄 [MachineManager] Rolling back instance ${instanceId}`);

      // Remove protection (ignore errors)
      try {
        await removeInstanceProtection([instanceId]);
      } catch (e) {
        console.warn(`Failed to remove protection: ${e}`);
      }

      // Re-tag as unassigned (ignore errors)
      try {
        await tagInstance(instanceId, "UNASSIGNED");
      } catch (e) {
        console.warn(`Failed to re-tag: ${e}`);
      }

      // Return to warm pool (most important step)
      try {
        await addToWarmPool(instanceId);
        console.log(`✅ [MachineManager] Returned ${instanceId} to warm pool`);
      } catch (e) {
        console.error(
          `CRITICAL: Failed to return ${instanceId} to warm pool: ${e}`
        );
      }
    }

    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown allocation error",
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
  console.log(`📊 [MachineManager] Getting system status`);
  try {
    console.log(`📡 [MachineManager] Fetching system metrics`);
    const [activeUsers, warmSpares, asgCapacity, instancesInfo] =
      await Promise.all([
        getActiveUserCount(),
        getWarmPoolSize(),
        getCurrentASGCapacity(),
        getASGInstancesInfo(),
      ]);

    const status = {
      activeUsers,
      warmSpares,
      totalInstances: instancesInfo.length,
      asgCapacity,
      instanceDetails: instancesInfo,
    };

    console.log(`✅ [MachineManager] System status retrieved:`, {
      activeUsers: status.activeUsers,
      warmSpares: status.warmSpares,
      totalInstances: status.totalInstances,
      asgCapacity: status.asgCapacity,
    });

    return status;
  } catch (error) {
    console.error(`❌ [MachineManager] Failed to get system status:`, error);
    throw error;
  }
}
