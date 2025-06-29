let pingInterval: any;

const BASE_URL = "https://unbiased-carefully-marmot.ngrok-free.app";

function startHeartbeat() {
  if (pingInterval) return; // already running

  pingInterval = setInterval(() => {
    console.log("Sending heartbeat ping to");
    console.log(BASE_URL + "/ping");
    fetch(`${BASE_URL}/ping`, {
      method: "POST",
      credentials: "include",
    }).catch(console.error);
  }, 1000); // every 30 seconds
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

startHeartbeat();
