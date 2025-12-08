
const VTSState = {
  connected: false,
  modelX: 0, modelY: 0, modelScale: 1, modelRotationZ: 0,
  faceX: 0, faceY: 0, faceAngleZ: 0, faceAngleX: 0, faceAngleY: 0,
};

const RIVE_FILE_URL = "./assets/snowfall.riv";
const FACE_RANGE = 10, MODEL_RANGE = 2;
const FACE_WEIGHT = 1.0, MODEL_WEIGHT = 1.0;
const HEAD_RANGE_X_FRAC = 0.25, HEAD_RANGE_Y_FRAC = 0.25;
const VTS_SHOULDER_STRENGTH = 0.6;
const MAX_TILT_DEG = 90;
const HEAD_TILT_MULTIPLIER = 2.0; 
const HEAD_TILT_FALLBACK_RADIUS = 105; 
const LOGICAL_WIDTH = 1920, LOGICAL_HEIGHT = 1080;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toRad = (deg) => (deg * Math.PI) / 180;

window.onVTSPoseUpdate = function (params) {
  VTSState.connected = true;
  for (const p of params) {
    const v = Number(p.value);
    const val = Number.isFinite(v) ? v : 0;
    switch (p.id) {
      case "ModelPositionX": VTSState.modelX = val; break;
      case "ModelPositionY": VTSState.modelY = val; break;
      case "ModelScale": VTSState.modelScale = val || 1; break;
      case "FacePositionX": VTSState.faceX = val; break;
      case "FacePositionY": VTSState.faceY = val; break;
      case "FaceAngleZ": VTSState.faceAngleZ = val; break;
      case "FaceAngleX": VTSState.faceAngleX = val; break;
      case "FaceAngleY": VTSState.faceAngleY = val; break;
      case "ModelRotationZ": VTSState.modelRotationZ = val; break;
    }
  }
};

function getVTSHeadOffsets() {
  if (!VTSState.connected) return { x: 0, y: 0, scale: 1 };

  const fx = clamp(VTSState.faceX, -FACE_RANGE, FACE_RANGE) / FACE_RANGE;
  const fy = -clamp(VTSState.faceY, -FACE_RANGE, FACE_RANGE) / FACE_RANGE;
  const mx = clamp(VTSState.modelX, -MODEL_RANGE, MODEL_RANGE) / MODEL_RANGE;
  const my = -clamp(VTSState.modelY, -MODEL_RANGE, MODEL_RANGE) / MODEL_RANGE;

  const nx = clamp(fx * FACE_WEIGHT + mx * MODEL_WEIGHT, -1, 1);
  const ny = clamp(fy * FACE_WEIGHT + my * MODEL_WEIGHT, -1, 1);

  const scaleFactor = clamp(VTSState.modelScale || 1, 0.5, 1.5);
  const rangeX = LOGICAL_WIDTH  * HEAD_RANGE_X_FRAC * scaleFactor;
  const rangeY = LOGICAL_HEIGHT * HEAD_RANGE_Y_FRAC * scaleFactor;

  let offsetX = nx * rangeX;
  let offsetY = ny * rangeY;

if (Number.isFinite(VTSState.faceAngleZ)) {
  const ang = clamp(VTSState.faceAngleZ, -MAX_TILT_DEG, MAX_TILT_DEG);
  const rad = toRad(ang);
  const baseRadius =
    (inputs.hitboxRadius && typeof inputs.hitboxRadius.value === "number"
      ? inputs.hitboxRadius.value
      : HEAD_TILT_FALLBACK_RADIUS);
  const radius = baseRadius * HEAD_TILT_MULTIPLIER;
  const dx = Math.sin(rad) * radius;
  const dy = (1 - Math.cos(rad)) * radius;

  offsetX += dx;
  offsetY += dy;
}

  return {
    x: offsetX,
    y: offsetY,
    scale: VTSState.modelScale || 1,
  };
}

function getVTSBodyOffsets() {
  if (!VTSState.connected) return { x: 0, y: 0, scale: 1 };
  const head = getVTSHeadOffsets();
  return { x: head.x * VTS_SHOULDER_STRENGTH, y: head.y * VTS_SHOULDER_STRENGTH, scale: head.scale };
}

let snowCanvas = null, snowCtx = null, snowDprScale = 0.5;

function setupSnowCanvas() {
  snowCanvas = document.getElementById("snow-canvas");
  if (!snowCanvas) {
    console.error("❌ Canvas 'snow-canvas' NÃO ENCONTRADO!");
    return false;
  }
  
  const dpr = (window.devicePixelRatio || 1) * snowDprScale;
  snowCanvas.style.width = `${LOGICAL_WIDTH}px`;
  snowCanvas.style.height = `${LOGICAL_HEIGHT}px`;
  snowCanvas.width = LOGICAL_WIDTH * dpr;
  snowCanvas.height = LOGICAL_HEIGHT * dpr;
  snowCtx = snowCanvas.getContext("2d");
  
  if (snowCtx) {
    snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    console.log("✅ Snow canvas pronto:", {
      dpr: dpr.toFixed(2),
      width: snowCanvas.width,
      height: snowCanvas.height,
      styleWidth: snowCanvas.style.width,
      styleHeight: snowCanvas.style.height
    });
  }
  
  return true;
}

function joystickXYToAngleDeg(x, y) {
  if (x == null || y == null) return 0;
  const dx = x - 5, dy = 5 - y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return 0;
  const rad = Math.atan2(dx, dy);
  let deg = (rad * 180) / Math.PI;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  return deg;
}

let snow = null; 

class SnowEngine {
  constructor(canvas, config = {}) {
    if (!canvas || !canvas.getContext) {
      console.error("❌ Canvas inválido para SnowEngine!");
      return;
    }
    
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = LOGICAL_WIDTH;
    this.height = LOGICAL_HEIGHT;
    this.snowflakes = [];
    this.time = 0;
    this.showDebug = false;
    
    Object.assign(this, {
      density: 50, velocity: 80, direction: 0,
      flakeSizeMin: 2, flakeSizeMax: 6, flakeFeather: 3,
      hitboxEnabled: true, hitboxX: 960, hitboxY: 540, hitboxRadius: 95,
      hitboxStrength: 0.8, hitboxFeather: 60, showHitbox: true,
      rectHitboxEnabled: true, rectHitboxX: 708, rectHitboxY: 796,
      rectHitboxWidth: 470, rectHitboxHeight: 150, rectHitboxCornerRadius: 147,
      rectHitboxStrength: 0.5, showRectHitbox: true,
      momentumTransfer: 1, meltChance: 1, meltSpeed: 2.0,
      hitboxPassThroughChance: 0.07,
      lastHitboxX: 960, lastHitboxY: 540, hitboxVelocityX: 0, hitboxVelocityY: 0,
      lastRectHitboxX: 708, lastRectHitboxY: 796, rectHitboxVelocityX: 0, rectHitboxVelocityY: 0,
      _lastFrameTime: performance.now()
    });
    
    this.updateSettings(config);
    this.regenerateSnowflakes();
    console.log("✅ SnowEngine criado com", this.snowflakes.length, "flocos");
  }

  updateSettings(cfg) {
    for (const key in cfg) {
      if (key in this && cfg[key] !== undefined) {
        if (key === 'hitboxX' || key === 'hitboxY') {
          this[key] = (key === 'hitboxX' ? LOGICAL_WIDTH / 2 : LOGICAL_HEIGHT / 2) + cfg[key];
        } else if (key === 'rectHitboxX' || key === 'rectHitboxY') {
          this[key] = (key === 'rectHitboxX' ? LOGICAL_WIDTH / 2 : LOGICAL_HEIGHT / 2) + cfg[key];
        } else {
          this[key] = cfg[key];
        }
      }
    }
  }

  randomFlakeSize() {
    return this.flakeSizeMin + Math.random() * (Math.max(this.flakeSizeMax, this.flakeSizeMin) - this.flakeSizeMin);
  }

  regenerateSnowflakes() {
    this.snowflakes.length = 0;
    const count = Math.floor(this.density);
    for (let i = 0; i < count; i++) {
      this.snowflakes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: this.randomFlakeSize(),
        speed: 0.8 + Math.random() * 0.4,
        sway: 10 + Math.random() * 20,
        swayOffset: Math.random() * Math.PI * 2,
        velocityX: 0,
        velocityY: 0,
        opacity: 1.0,
        turbulence: 0.5 + Math.random() * 1.5,
        passThrough: Math.random() < this.hitboxPassThroughChance,
      });
    }
  }

  rectSignedDistance(px, py, rectX, rectY, width, height, cornerRadius) {
    const r = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
    const centerX = rectX + width / 2;
    const centerY = rectY + height / 2;
    const dx = px - centerX;
    const dy = py - centerY;
    const halfW = width / 2;
    const halfH = height / 2;
    const topCornerY = -halfH + r;

    let distance, nx, ny;

    if (dx < -halfW + r && dy < topCornerY) {
      const cdx = dx - (-halfW + r);
      const cdy = dy - topCornerY;
      const dist = Math.hypot(cdx, cdy);
      distance = dist - r;
      nx = dist > 1e-4 ? cdx / dist : -1;
      ny = dist > 1e-4 ? cdy / dist : 0;
    } else if (dx > halfW - r && dy < topCornerY) {
      const cdx = dx - (halfW - r);
      const cdy = dy - topCornerY;
      const dist = Math.hypot(cdx, cdy);
      distance = dist - r;
      nx = dist > 1e-4 ? cdx / dist : 1;
      ny = dist > 1e-4 ? cdy / dist : 0;
    } else {
      const distLeft = dx + halfW;
      const distRight = halfW - dx;
      const distTop = dy + halfH;
      const distBottom = halfH - dy;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      distance = -minDist;
      nx = minDist === distLeft ? -1 : minDist === distRight ? 1 : 0;
      ny = minDist === distTop ? -1 : minDist === distBottom ? 1 : 0;
    }

    return { distance, nx, ny };
  }

    _spawnPositionFromDirection() {
    const dirRad = toRad(this.direction || 0);
    let dx = Math.sin(dirRad);
    let dy = Math.cos(dirRad);

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      dx = 0;
      dy = 1;
    }

    let x, y;
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy > 0) {
        x = Math.random() * this.width;
        y = -10;
      } else {
        x = Math.random() * this.width;
        y = this.height + 10;
      }
    } else {
      if (dx > 0) {
        x = -10;
        y = Math.random() * this.height;
      } else {
        x = this.width + 10;
        y = Math.random() * this.height;
      }
    }

    return { x, y };
  }

  update(dt) {
    this.time += dt;

    if (dt > 0) {
      this.hitboxVelocityX = (this.hitboxX - this.lastHitboxX) / dt;
      this.hitboxVelocityY = (this.hitboxY - this.lastHitboxY) / dt;
      this.lastHitboxX = this.hitboxX;
      this.lastHitboxY = this.hitboxY;

      this.rectHitboxVelocityX = (this.rectHitboxX - this.lastRectHitboxX) / dt;
      this.rectHitboxVelocityY = (this.rectHitboxY - this.lastRectHitboxY) / dt;
      this.lastRectHitboxX = this.rectHitboxX;
      this.lastRectHitboxY = this.rectHitboxY;
    }

    const baseVX = Math.sin(toRad(this.direction)) * this.velocity;
    const baseVY = Math.cos(toRad(this.direction)) * this.velocity;
    const mtBase = this.momentumTransfer * 0.08;
    const friction = 1 - 2 * dt;

    if (Math.abs(this.snowflakes.length - this.density) > 5) {
      this.regenerateSnowflakes();
    }

    let i = 0;
    while (i < this.snowflakes.length) {
      const flake = this.snowflakes[i];
      let remove = false;

      if (flake.opacity < 1.0) {
        flake.opacity -= this.meltSpeed * dt;
        if (flake.opacity <= 0) remove = true;
      }

      if (!remove) {
        flake.velocityX *= friction;
        flake.velocityY *= friction;

        const totalVX = baseVX * flake.speed + flake.velocityX;
        const totalVY = baseVY * flake.speed + flake.velocityY;

        let newX = flake.x + totalVX * dt;
        let newY = flake.y + totalVY * dt;

        const sway = Math.sin(this.time * 2 + flake.swayOffset) * flake.sway * dt;
        newX += sway;

        if (this.hitboxEnabled && flake.opacity >= 1.0 && flake.passThrough !== true) {
          const dx = newX - this.hitboxX;
          const dy = newY - this.hitboxY;
          const distSq = dx * dx + dy * dy;
          const featherR = this.hitboxRadius + this.hitboxFeather;

          if (distSq < featherR * featherR) {
            const dist = Math.sqrt(distSq);
            const strength = (dist > this.hitboxRadius && this.hitboxFeather > 0)
              ? this.hitboxStrength * (1 - (dist - this.hitboxRadius) / this.hitboxFeather)
              : this.hitboxStrength;

            const nx = dx / (dist || 1);
            const ny = dy / (dist || 1);
            const hitboxSpeed = Math.hypot(this.hitboxVelocityX, this.hitboxVelocityY);

            if (dist < this.hitboxRadius) {
              const targetDist = this.hitboxRadius + flake.size;
              flake.x = this.hitboxX + nx * targetDist;
              flake.y = this.hitboxY + ny * targetDist;

              if (hitboxSpeed > 0.1) {
                flake.velocityX += this.hitboxVelocityX * mtBase * flake.turbulence;
                flake.velocityY += this.hitboxVelocityY * mtBase * flake.turbulence;
              }

              if (Math.random() < this.meltChance * dt) {
                flake.opacity = 0.99;
              }
            } else {
              const defX = this.hitboxX + nx * Math.max(dist, this.hitboxRadius + flake.size);
              const defY = this.hitboxY + ny * Math.max(dist, this.hitboxRadius + flake.size);
              flake.x = newX + (defX - newX) * strength;
              flake.y = newY + (defY - newY) * strength;

              if (hitboxSpeed > 0.1) {
                const drag = 0.08 * strength * mtBase;
                flake.velocityX += this.hitboxVelocityX * drag;
                flake.velocityY += this.hitboxVelocityY * drag;
              }
            }
          } else {
            flake.x = newX;
            flake.y = newY;
          }
        } else {
          flake.x = newX;
          flake.y = newY;
        }

        if (this.rectHitboxEnabled && flake.opacity > 0 && flake.passThrough !== true) {
          const rectX = this.rectHitboxX - this.rectHitboxWidth / 2;
          const rectY = this.rectHitboxY - this.rectHitboxHeight / 2;
          const { distance, nx, ny } = this.rectSignedDistance(
            flake.x, flake.y, rectX, rectY,
            this.rectHitboxWidth, this.rectHitboxHeight, this.rectHitboxCornerRadius
          );

          if (distance < 0) {
            const pushDist = -distance + 0.5;
            flake.x += nx * pushDist;
            flake.y += ny * pushDist;

            const vn = flake.velocityX * nx + flake.velocityY * ny;
            if (vn < 0) {
              flake.velocityX -= vn * nx;
              flake.velocityY -= vn * ny;
            }

            const rectSpeed = Math.hypot(this.rectHitboxVelocityX, this.rectHitboxVelocityY);
            if (rectSpeed > 0.1) {
              flake.velocityX += this.rectHitboxVelocityX * mtBase * flake.turbulence;
              flake.velocityY += this.rectHitboxVelocityY * mtBase * flake.turbulence;
            }

            flake.opacity -= this.meltSpeed * dt * 2;
          }
        }

        const outOfBounds =
          flake.y > this.height + 10 ||
          flake.y < -10 ||
          flake.x > this.width + 10 ||
          flake.x < -10;

        if (outOfBounds) {
          const spawn = this._spawnPositionFromDirection();

          flake.x = spawn.x;
          flake.y = spawn.y;
          flake.opacity = 1;
          flake.velocityX = 0;
          flake.velocityY = 0;
          flake.size = this.randomFlakeSize();
          flake.passThrough = Math.random() < this.hitboxPassThroughChance;
        }
      }

      if (remove) this.snowflakes.splice(i, 1);
      else i++;
    }
    const deficit = Math.floor(this.density) - this.snowflakes.length;
    for (let j = 0; j < deficit; j++) {
      const spawn = this._spawnPositionFromDirection();

      this.snowflakes.push({
        x: spawn.x,
        y: spawn.y,
        size: this.randomFlakeSize(),
        speed: 0.8 + Math.random() * 0.4,
        sway: 10 + Math.random() * 20,
        swayOffset: Math.random() * Math.PI * 2,
        velocityX: 0,
        velocityY: 0,
        opacity: 1.0,
        turbulence: 0.5 + Math.random() * 1.5,
        passThrough: Math.random() < this.hitboxPassThroughChance,
      });
    }
  }

  drawHitboxes() {
    const ctx = this.ctx;
    ctx.save();

    if (this.hitboxEnabled && this.showHitbox) {
      ctx.strokeStyle = "rgba(255,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.hitboxX, this.hitboxY, this.hitboxRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.rectHitboxEnabled && this.showRectHitbox) {
      const w = this.rectHitboxWidth;
      const h = this.rectHitboxHeight;
      const r = Math.min(this.rectHitboxCornerRadius, w / 2, h / 2);
      const x = this.rectHitboxX - w / 2;
      const y = this.rectHitboxY - h / 2;
      ctx.strokeStyle = "rgba(0,0,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) {
      console.error("❌ Contexto 2D não encontrado!");
      return;
    }
    
    // FORÇA VISIBILIDADE
    ctx.globalAlpha = 1.0;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawHitboxes();

    // Debug
    if (this.showDebug && VTSState.connected) {
      ctx.save();
      ctx.fillStyle = "#00ff00";
      ctx.font = "20px monospace";
      ctx.fillText(`FaceZ: ${VTSState.faceAngleZ.toFixed(1)}°`, 50, 50);
      ctx.fillText(`Offset: ${(this.hitboxX - LOGICAL_WIDTH/2).toFixed(0)}, ${(this.hitboxY - LOGICAL_HEIGHT/2).toFixed(0)}`, 50, 80);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.globalCompositeOperation = "lighter";

    for (const flake of this.snowflakes) {
      const blurPx = (this.flakeFeather || 0) * 0.5;
      ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
      ctx.globalAlpha = Math.max(0, Math.min(1, flake.opacity));
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

const riveCanvas = document.getElementById("rive-canvas");
let riveInstance = null, vm = null;
const inputs = {};

function initRive() {
  console.log("Loading Rive…");
  riveInstance = new rive.Rive({
    src: RIVE_FILE_URL,
    canvas: riveCanvas,
    autoplay: true,
    autoBind: true,
    shouldDisableRenderingWhenOffscreen: true,
    artboard: "Main",
    stateMachines: ["State Machine 1"],
    layout: new rive.Layout({ fit: rive.Fit.contain, alignment: rive.Alignment.center }),
    onLoad: () => {
      console.log("✅ Rive carregado");
      riveInstance.resizeDrawingSurfaceToCanvas();

      const rootVm = riveInstance.viewModelInstance;
      if (!rootVm) {
        console.error("❌ ViewModel raiz não encontrado");
        return;
      }

      vm = rootVm.viewModel("View Model 1") || rootVm;
      
      const inputNames = [
        "snowFps", "snowDpr", "density", "velocity", "direction",
        "directionX", "directionY", "flakeSizeMin", "flakeSizeMax", "feather",
        "hitboxX", "hitboxY", "hitboxRadius", "rectHitboxX", "rectHitboxY",
        "rectHitboxWidth", "rectHitboxHeight", "rectHitboxCornerRadius",
        "hitboxEnabled", "rectHitboxEnabled", "showHitbox", "showRectHitbox",
        "isSetupMode", "isHeadEnabled", "isShouldersEnabled",
        "offsetX", "offsetY", "rectOffsetX", "rectOffsetY"
      ];

      inputNames.forEach(name => {
        inputs[name] = vm.number(name) || vm.boolean(name);
      });

      // INICIALIZA SNOW SÓ AGORA
      if (setupSnowCanvas()) {
        snow = new SnowEngine(snowCanvas, { density: 50, velocity: 80, direction: 0 });
        console.log("✅ SISTEMA COMPLETO INICIALIZADO - SNOW ATIVO");
      } else {
        console.error("❌ FALHA NA INICIALIZAÇÃO DO SNOW CANVAS");
      }
    },
  });
}

initRive();

let snowTargetFps = 30, snowFrameMs = 1000 / snowTargetFps;
let lastTime = performance.now(), snowAccumMs = 0;

function updateSnowFpsFromVM() {
  if (!inputs.snowFps) return;
  const fps = clamp(inputs.snowFps.value, 10, 60);
  if (fps !== snowTargetFps) {
    snowTargetFps = fps;
    snowFrameMs = 1000 / snowTargetFps;
  }
}

function updateSnowDprFromVM() {
  if (!inputs.snowDpr || !snowCanvas) return;
  const clamped = clamp(inputs.snowDpr.value, 0, 100);
  const targetScale = 0.5 + (clamped / 100) * 0.5;

  if (Math.abs(targetScale - snowDprScale) > 0.05) {
    snowDprScale = targetScale;
    setupSnowCanvas();
  }
}

function rotateAroundPivot(x, y, pivotX, pivotY, angleDeg) {
  const a = angleDeg * Math.PI / 180;

  const dx = x - pivotX;
  const dy = y - pivotY;

  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  return {
    x: pivotX + dx * cosA - dy * sinA,
    y: pivotY + dx * sinA + dy * cosA
  };
}

function mainLoop(now) {
  const deltaMsRaw = now - lastTime;
  const deltaMs = clamp(deltaMsRaw, 0, 1000);
  const dt = deltaMs / 1000;
  lastTime = now;

  if (vm && snow) {
    updateSnowFpsFromVM();
    updateSnowDprFromVM();

    const directionDeg = inputs.directionX && inputs.directionY
      ? joystickXYToAngleDeg(inputs.directionX.value, inputs.directionY.value)
      : inputs.direction?.value ?? 0;

    const isSetup = inputs.isSetupMode?.value === true;
    const SETUP_TRACKING_STRENGTH = 1;

    const baseHeadVts = getVTSHeadOffsets();
    const baseBodyVts = getVTSBodyOffsets();

    const headVts = isSetup
      ? { x: baseHeadVts.x * SETUP_TRACKING_STRENGTH, y: baseHeadVts.y * SETUP_TRACKING_STRENGTH, scale: baseHeadVts.scale }
      : baseHeadVts;

    console.log("headVts.y", headVts.y);

    const bodyVts = isSetup
      ? { x: baseBodyVts.x * SETUP_TRACKING_STRENGTH, y: baseBodyVts.y * SETUP_TRACKING_STRENGTH, scale: baseBodyVts.scale }
      : baseBodyVts;

    const pivotX = 0;
    const pivotY = 80;

    if (inputs.offsetX) inputs.offsetX.value = headVts.x;
    if (inputs.offsetY) inputs.offsetY.value = headVts.y;

    if (inputs.rectOffsetX) inputs.rectOffsetX.value = bodyVts.x;
    if (inputs.rectOffsetY) inputs.rectOffsetY.value = bodyVts.y;

    const headXWithOffset = inputs.hitboxX?.value != null ? inputs.hitboxX.value + headVts.x : undefined;
    const headYWithOffset = inputs.hitboxY?.value != null ? inputs.hitboxY.value + headVts.y : undefined;
    const bodyXWithOffset = inputs.rectHitboxX?.value != null ? inputs.rectHitboxX.value + bodyVts.x : undefined;
    const bodyYWithOffset = inputs.rectHitboxY?.value != null ? inputs.rectHitboxY.value + bodyVts.y : undefined;

    const headEnabled = inputs.isHeadEnabled?.value !== null 
      ? !!inputs.isHeadEnabled?.value 
      : !!inputs.hitboxEnabled?.value;

    const shouldersEnabled = inputs.isShouldersEnabled?.value !== null 
      ? !!inputs.isShouldersEnabled?.value 
      : !!inputs.rectHitboxEnabled?.value;

    const configUpdate = {
      showHitbox: isSetup,
      showRectHitbox: isSetup,
      density: inputs.density?.value,
      velocity: inputs.velocity?.value,
      direction: directionDeg,
      flakeSizeMin: inputs.flakeSizeMin?.value,
      flakeSizeMax: inputs.flakeSizeMax?.value,
      flakeFeather: inputs.feather?.value,
      hitboxX: headXWithOffset,
      hitboxY: headYWithOffset,
      hitboxRadius: inputs.hitboxRadius?.value,
      rectHitboxX: bodyXWithOffset,
      rectHitboxY: bodyYWithOffset,
      rectHitboxWidth: inputs.rectHitboxWidth?.value,
      rectHitboxHeight: inputs.rectHitboxHeight?.value,
      rectHitboxCornerRadius: inputs.rectHitboxCornerRadius?.value,
      hitboxEnabled: headEnabled,
      rectHitboxEnabled: shouldersEnabled,

    };

    snow.updateSettings(configUpdate);
  }

  snowAccumMs += deltaMs;
  if (snowAccumMs >= snowFrameMs) {
    const snowDt = Math.min(snowAccumMs, snowFrameMs * 3) / 1000;
    if (snow) {
      snow.update(snowDt);
      snow.draw();
    }
    snowAccumMs = 0;
  }

  requestAnimationFrame(mainLoop);
}

requestAnimationFrame(mainLoop);