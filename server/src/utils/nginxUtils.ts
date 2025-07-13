export function generateSubdomain(
  username: string,
  instanceId: string
): string {
  const shortId = instanceId.split("-")[1].substring(0, 6);
  const cleanUserId = username
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .substring(0, 8);
  return `${cleanUserId}-${shortId}`;
}

export async function createWorkspaceNginxConfig(
  subdomain: string,
  instanceIp: string
): Promise<void> {
  const configContent = `
  server {
      listen 443 ssl;
      server_name ${subdomain}.workspaces.codeclause.tech;
      
      ssl_certificate /etc/letsencrypt/live/workspaces.codeclause.tech/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/workspaces.codeclause.tech/privkey.pem;
      include /etc/letsencrypt/options-ssl-nginx.conf;
      ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
      
      location / {
          proxy_pass http://${instanceIp}:8080;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          
          # WebSocket support for code-server
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          
          # Timeouts
          proxy_connect_timeout 60s;
          proxy_send_timeout 60s;
          proxy_read_timeout 60s;
      }
  }
  `;

  const fs = require("fs").promises;
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);

  // Write config file
  await fs.writeFile(`/etc/nginx/sites-available/${subdomain}`, configContent);

  // Enable site
  await execAsync(
    `ln -sf /etc/nginx/sites-available/${subdomain} /etc/nginx/sites-enabled/`
  );

  // Reload nginx
  await execAsync("sudo nginx -t && sudo systemctl reload nginx");

  console.log(
    `✅ Created workspace config for ${subdomain}.workspaces.codeclause.tech`
  );
}
