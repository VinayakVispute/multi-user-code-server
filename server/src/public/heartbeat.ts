let pingInterval: any;

const BASE_URL = "";

function startHeartbeat() {
  if (pingInterval) return; // already running

  pingInterval = setInterval(async () => {
    try {
      console.log("Sending heartbeat ping to", BASE_URL + "/heartbeat");

      const response = await fetch(`${BASE_URL}/heartbeat`, {
        body: JSON.stringify({ ts: Date.now() }),
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error(
          "Heartbeat failed:",
          response.status,
          response.statusText
        );

        // If unauthorized, redirect to login
        if (response.status === 401 || response.status === 403) {
          console.log("Authentication failed, redirecting to login");
          window.location.href = "/auth/sign-in";
          return;
        }
      } else {
        const data = await response.json();
        console.log("Heartbeat successful:", data);
      }
    } catch (error) {
      console.error("Heartbeat error:", error);
    }
  }, 30000); // every 30 seconds (increased from 1 second)
}

function stopHeartbeat() {
  clearInterval(pingInterval);
  pingInterval = undefined;
}

// Visibility change handler
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startHeartbeat();
  } else {
    stopHeartbeat();
  }
});

// Start immediately if tab is active
if (document.visibilityState === "visible") {
  startHeartbeat();
}

// Also start on page load
window.addEventListener("load", () => {
  startHeartbeat();
});
