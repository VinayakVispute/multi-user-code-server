import { SendCommandCommand } from "@aws-sdk/client-ssm";
import logger from "./logger";
import { ssmClient } from "../config/awsConfig";



export async function setupUserEFSDirectory(
    instanceId: string,
    userId: string,
    requestId: string
): Promise<void> {
    const functionName = "setupUserEFSDirectory";
    logger.debug(
        `[${requestId || "system"}] [${functionName}] Setting up EFS directory for user`,
        { instanceId, userId }
    );

    try {
        // Script to create user directory and symlink
        const script = `#!/bin/bash
USER_DIR="/mnt/efs/${userId}"
LINK_DEST="/home/coder/project"
CONFIG_DIR="/home/coder/.config/code-server"

# Create user directory if it doesn't exist
sudo mkdir -p "\${USER_DIR}"
sudo chown coder:coder "\${USER_DIR}"

# Remove existing project directory if it exists
sudo rm -rf "\${LINK_DEST}"

# Create symlink to user's EFS directory
sudo ln -s "\${USER_DIR}" "\${LINK_DEST}"

# Create code-server config directory
sudo mkdir -p "\${CONFIG_DIR}"
sudo chown coder:coder "\${CONFIG_DIR}"

# Write code-server config
cat > "\${CONFIG_DIR}/config.yaml" << EOF
bind-addr: 0.0.0.0:8080
auth: none
user-data-dir: /home/coder/project/.vscode
EOF

sudo chown coder:coder "\${CONFIG_DIR}/config.yaml"

echo "EFS setup completed for user ${userId}"
`;

        const command = new SendCommandCommand({
            InstanceIds: [instanceId],
            DocumentName: "AWS-RunShellScript",
            Parameters: {
                commands: [script],
            },
            TimeoutSeconds: 300,
        });

        const response = await ssmClient.send(command);
        const commandId = response.Command?.CommandId;

        if (!commandId) {
            throw new Error("Failed to get command ID from SSM response");
        }

        logger.info(
            `[${requestId || "system"}] [${functionName}] EFS setup command sent successfully`,
            { instanceId, userId, commandId }
        );

        // Wait a moment for the command to execute
        await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
        logger.error(
            `[${requestId || "system"}] [${functionName}] Failed to setup EFS directory`,
            {
                instanceId,
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
            }
        );
        throw error;
    }
}

export async function validateEFSMount(
    instanceId: string,
    requestId: string
): Promise<boolean> {
    const functionName = "validateEFSMount";
    logger.debug(
        `[${requestId || "system"}] [${functionName}] Validating EFS mount`,
        { instanceId }
    );

    try {
        const script = `#!/bin/bash
# Check if EFS is mounted
if mountpoint -q /mnt/efs; then
  echo "EFS_MOUNTED=true"
  exit 0
else
  echo "EFS_MOUNTED=false"
  exit 1
fi
`;

        const command = new SendCommandCommand({
            InstanceIds: [instanceId],
            DocumentName: "AWS-RunShellScript",
            Parameters: {
                commands: [script],
            },
            TimeoutSeconds: 60,
        });

        const response = await ssmClient.send(command);

        logger.info(
            `[${requestId || "system"}] [${functionName}] EFS mount validation completed`,
            { instanceId, commandId: response.Command?.CommandId }
        );

        return true;
    } catch (error) {
        logger.error(
            `[${requestId || "system"}] [${functionName}] EFS mount validation failed`,
            {
                instanceId,
                error: error instanceof Error ? error.message : "Unknown error",
            }
        );
        return false;
    }
}