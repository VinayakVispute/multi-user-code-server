let pingInterval: ReturnType<typeof setInterval> | undefined;

async function sendHeartbeat() {
  try {
    const response = await fetch(`/api/ping`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
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

      if (data.success) {
        console.log(
          `✅ Heartbeat successful - Instance: ${data.instanceId}, Router status: ${data.routerResponse}`
        );
      } else {
        console.warn("⚠️ Heartbeat response indicates failure");
      }
    } catch (parseError) {
      console.warn("⚠️ Failed to parse heartbeat response as JSON");
    }
  } catch (networkError) {
    console.error("🌐 Network error during heartbeat:", networkError);

    // Handle specific error cases
    if (networkError instanceof Error && networkError.name === "AbortError") {
      console.error("⏱️ Heartbeat request timed out");
    }
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
