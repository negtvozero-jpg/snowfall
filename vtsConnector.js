
(function () {
  const WS_URL = "ws://127.0.0.1:8001";
  const API_NAME = "VTubeStudioPublicAPI";
  const API_VERSION = "1.0";
  const PLUGIN_NAME = "Snowfall BETA";
  const PLUGIN_DEVELOPER = "negativoZero";
  const TOKEN_STORAGE_KEY = `VTS_TOKEN_${PLUGIN_NAME.replace(/\s+/g, "_")}_${PLUGIN_DEVELOPER}`;
  const PARAMETER_NAMES = ["FacePositionX", "FacePositionY", "FaceAngleZ","FaceAngleX", "FaceAngleY"];
  

  let vtsSocket = null, vtsToken = null, vtsAuthenticated = false;
  let modelPollTimer = null, reconnectTimeoutId = null, reconnectAttempts = 0;

  const log = (...args) => console.log("[VTS]", ...args);
  const warn = (...args) => console.warn("[VTS]", ...args);
  const err = (...args) => console.error("[VTS]", ...args);

  function sendVTS(msg) {
    if (!vtsSocket || vtsSocket.readyState !== WebSocket.OPEN) return;
    try {
      vtsSocket.send(JSON.stringify(msg));
    } catch (e) {
      err("Erro ao enviar:", e);
    }
  }

  function emitPoseUpdate(list) {
    if (typeof window.onVTSPoseUpdate === "function") {
      try {
        window.onVTSPoseUpdate(list);
      } catch (e) {
        err("Erro em onVTSPoseUpdate:", e);
      }
    }
  }

  function createVTSRequest(messageType, data = {}, requestIdPrefix = "Snowfall") {
    return {
      apiName: API_NAME,
      apiVersion: API_VERSION,
      requestID: `${requestIdPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      messageType,
      data,
    };
  }

  function requestNewToken() {
    log("Pedindo novo token...");
    sendVTS(createVTSRequest("AuthenticationTokenRequest", {
      pluginName: PLUGIN_NAME,
      pluginDeveloper: PLUGIN_DEVELOPER,
    }, "Snowfall_Token"));
  }

  function sendAuthenticationRequest() {
    sendVTS(createVTSRequest("AuthenticationRequest", {
      pluginName: PLUGIN_NAME,
      pluginDeveloper: PLUGIN_DEVELOPER,
      authenticationToken: vtsToken || null,
    }, "Snowfall_Auth"));
  }

  function startModelPoll() {
    if (modelPollTimer) return;
    
    modelPollTimer = setInterval(() => {
      if (!vtsSocket || vtsSocket.readyState !== WebSocket.OPEN || !vtsAuthenticated) return;

      sendVTS(createVTSRequest("CurrentModelRequest", {}, "Snowfall_Model"));
      PARAMETER_NAMES.forEach(param => {
        sendVTS(createVTSRequest("ParameterValueRequest", { name: param }, `Snowfall_${param}`));
      });
    }, 100);
  }

  function stopModelPoll() {
    if (!modelPollTimer) return;
    clearInterval(modelPollTimer);
    modelPollTimer = null;
  }

  function handleMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      err("Mensagem inválida:", ev.data);
      return;
    }

    const { messageType: type, data } = msg;
    
    switch (type) {
      case "APIStateResponse":
        log("APIStateResponse", data);
        break;

      case "APIError":
        warn("APIError:", data.message);
        const msgLow = data.message?.toLowerCase() || "";
        if (msgLow.includes("token") && (msgLow.includes("invalid") || msgLow.includes("revoked"))) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          vtsToken = null;
          requestNewToken();
        }
        break;

      case "AuthenticationTokenResponse":
        if (!data.authenticationToken) {
          warn("TokenResponse vazio:", data.reason);
          return;
        }
        log("Token recebido, autenticando...");
        vtsToken = data.authenticationToken;
        localStorage.setItem(TOKEN_STORAGE_KEY, vtsToken);
        sendAuthenticationRequest();
        break;

      case "AuthenticationResponse":
        if (data.authenticated) {
          vtsAuthenticated = true;
          if (data.authenticationToken) {
            vtsToken = data.authenticationToken;
            localStorage.setItem(TOKEN_STORAGE_KEY, vtsToken);
          }
          log("Autenticado no VTS");
          startModelPoll();
          reconnectAttempts = 0;
        } else {
          vtsAuthenticated = false;
          warn("Auth falhou:", data.reason || "");
          if (data.reason?.toLowerCase().includes("token")) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            vtsToken = null;
            requestNewToken();
          }
        }
        break;

      case "CurrentModelResponse":
        if (!data.modelLoaded || !data.modelPosition) return;
        const mp = data.modelPosition;
        emitPoseUpdate([
          { id: "ModelPositionX", value: mp.positionX ?? 0 },
          { id: "ModelPositionY", value: mp.positionY ?? 0 },
          { id: "ModelScale", value: mp.size ?? 1 },
        ]);
        break;

      case "ParameterValueResponse":
        if (!data.name || !PARAMETER_NAMES.includes(data.name)) return;
        emitPoseUpdate([{ id: data.name, value: data.value ?? 0 }]);
        break;

      default:
        break;
    }
  }

  function connect() {
    if (vtsSocket?.readyState === WebSocket.OPEN || vtsSocket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      vtsToken = vtsToken || localStorage.getItem(TOKEN_STORAGE_KEY);
      log("Conectando ao VTS...");
      
      vtsSocket = new WebSocket(WS_URL);

      vtsSocket.onopen = () => {
        log("Conectado ao VTS");
        vtsToken ? sendAuthenticationRequest() : requestNewToken();
      };

      vtsSocket.onerror = (event) => err("WebSocket ERROR:", event);

      vtsSocket.onclose = () => {
        warn("Conexão fechada. Reconectando...");
        vtsAuthenticated = false;
        stopModelPoll();
        
        const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 60000);
        reconnectTimeoutId = setTimeout(connect, delay);
        reconnectAttempts++;
      };

      vtsSocket.onmessage = handleMessage;
    } catch (e) {
      err("Exceção ao conectar:", e);
      reconnectTimeoutId = setTimeout(connect, 5000);
    }
  }

  window.addEventListener("beforeunload", () => {
    stopModelPoll();
    vtsSocket?.close();
  });

  window.addEventListener("load", connect);

  window.VTSSnowfall = { reconnect: connect };
})();