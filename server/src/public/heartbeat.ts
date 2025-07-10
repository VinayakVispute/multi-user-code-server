const meta = (window as any).HEARTBEAT || {};
const BASE_URL = "";
let pingInterval: ReturnType<typeof setInterval> | undefined;

async function sendHeartbeat() {
  console.log(meta);
  const payload = {
    ts: Date.now(),
    user: meta.u,
    instanceId: meta.id,
  };

  console.log(payload);

  if (!payload.user || !payload.instanceId) {
    console.warn("⚠️ Heartbeat: Missing user or instanceId in meta");
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}/heartbeat`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `🚨 Heartbeat failed: ${response.status} ${response.statusText}`
      );

      if (response.status === 401 || response.status === 403) {
        console.warn("🔒 Unauthorized: redirecting to login");
        return;
      }

      return;
    }

    try {
      const data = await response.json();
      console.log("✅ Heartbeat successful:", data);
    } catch (parseError) {
      console.warn("⚠️ Failed to parse heartbeat response as JSON");
    }
  } catch (networkError) {
    console.error("🌐 Network error during heartbeat:", networkError);
  }
}

function startHeartbeat() {
  if (pingInterval) return;

  console.log("⏱️ Heartbeat started");
  pingInterval = setInterval(sendHeartbeat, 30_000);
  sendHeartbeat(); // send immediately
}

function stopHeartbeat() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = undefined;
    console.log("⛔ Heartbeat stopped");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startHeartbeat();
  } else {
    stopHeartbeat();
  }
});

if (document.visibilityState === "visible") {
  startHeartbeat();
}

window.addEventListener("load", () => {
  startHeartbeat();
});
