const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const endpoint = document.getElementById("endpoint");
const detail = document.getElementById("detail");
const eventText = document.getElementById("eventText");
const errorText = document.getElementById("errorText");
const connectButton = document.getElementById("connectButton");
const pingButton = document.getElementById("pingButton");
const pairingCard = document.getElementById("pairingCard");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Bridge operation failed."));
        return;
      }
      resolve(response);
    });
  });
}

function render(state) {
  const status = state?.status || "DISCONNECTED";
  document.body.classList.remove("connected", "connecting", "error-state");
  if (status === "CONNECTED") document.body.classList.add("connected");
  if (status === "CONNECTING") document.body.classList.add("connecting");
  if (status === "ERROR") document.body.classList.add("error-state");

  statusText.textContent = status;
  endpoint.textContent = state?.bridgeUrl || "http://127.0.0.1:43127";
  pingButton.disabled = status !== "CONNECTED";
  connectButton.textContent = status === "CONNECTED" ? "RECONNECT" : "CONNECT";
  pairingCard.hidden = state?.paired === true;

  detail.textContent = status === "CONNECTED"
    ? "双方向通信を利用できます。"
    : status === "CONNECTING"
      ? "Desktop Connectorへ接続しています。"
      : status === "ERROR"
      ? "Desktop Connectorを確認して再接続します。"
      : "Desktop Connectorを検出しています。";
  if (state?.paired === false && status !== "CONNECTED") {
    detail.textContent = "初回接続にはDesktopのPairing codeが必要です。";
  }
  errorText.textContent = state?.lastError || "";

  const event = state?.lastEvent;
  eventText.textContent = event
    ? `${event.event || "event"} · ${event.timestamp || ""}`
    : "まだイベントを受信していません。";
}

async function refresh() {
  try {
    const response = await send({ type: "GET_STATE" });
    render(response.state);
  } catch (error) {
    errorText.textContent = error.message;
  }
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    const response = await send({ type: "CONNECT" });
    render(response.state);
  } catch (error) {
    errorText.textContent = error.message;
    await refresh();
  } finally {
    connectButton.disabled = false;
  }
});

pairButton.addEventListener("click", async () => {
  pairButton.disabled = true;
  errorText.textContent = "";
  try {
    const response = await send({ type: "PAIR", pairingCode: pairingCode.value });
    pairingCode.value = "";
    render(response.state);
  } catch (error) {
    errorText.textContent = error.message;
    await refresh();
  } finally {
    pairButton.disabled = false;
  }
});

pingButton.addEventListener("click", async () => {
  pingButton.disabled = true;
  try {
    const response = await send({ type: "PING" });
    render(response.state);
    detail.textContent = `PONG受信済み · ${response.pong?.timestamp || ""}`;
  } catch (error) {
    errorText.textContent = error.message;
    await refresh();
  } finally {
    pingButton.disabled = document.body.classList.contains("connected") === false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BRIDGE_STATE_CHANGED") render(message.state);
});

void refresh();
