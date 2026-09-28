(() => {
  "use strict";

  const canvas = document.getElementById("slope");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = Object.fromEntries([
    "hud", "distance", "distance-bar", "best", "score", "score-note", "speed", "slope-label",
    "start-screen", "pause-screen", "finish-screen", "start-button", "pause-button", "resume-button",
    "restart-button", "finish-title", "finish-overline", "finish-copy", "finish-badge", "final-score",
    "final-distance", "bottom-bar", "touch-controls", "tip", "toast"
  ].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

  const TAU = Math.PI * 2;
  const WORLD_WIDTH = 250;
  const PROJECTION = 4.5;
  const PLAYER_Y_RATIO = 0.72;
  const YETI_START = 1050;
  const TIPS = [
    "Gates are worth more than near misses.",
    "A little hop goes a long way.",
    "Wide turns are safer than last-second swerves.",
    "The yeti is not here for the scenery."
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let state = "title";
  let previousTime = 0;
  let elapsed = 0;
  let lastTipAt = 0;
  let toastTimer = 0;
  let run = null;
  let best = readBest();
  let snow = [];
  const keys = new Set();
  const pointerControls = new Set();

  function readBest() {
    try { return Math.max(0, Number(localStorage.getItem("powderline-best")) || 0); }
    catch { return 0; }
  }

  function saveBest(value) {
    try { localStorage.setItem("powderline-best", String(value)); } catch { /* Private browsing can disable storage. */ }
  }

  function randomGenerator(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildWorld(seed) {
    const random = randomGenerator(seed);
    const objects = [];
    let y = 60;
    let index = 0;
    while (y < 18000) {
      y += 26 + random() * 34;
      const x = (random() * 2 - 1) * 106;
      const roll = random();
      if (roll < 0.38) {
        objects.push({ kind: "pine", x, y, scale: 0.68 + random() * 0.7, seed: random() });
      } else if (roll < 0.56) {
        objects.push({ kind: "rock", x, y, scale: 0.7 + random() * 0.7, seed: random() });
      } else if (roll < 0.67) {
        objects.push({ kind: "log", x, y, scale: 0.8 + random() * 0.5, seed: random() });
      } else if (roll < 0.73) {
        objects.push({ kind: "snowman", x, y, scale: 0.75 + random() * 0.5, seed: random() });
      } else if (roll < 0.82) {
        objects.push({ kind: "mound", x, y, scale: 0.9 + random() * 0.6, seed: random() });
      }
      if (index % 3 === 0) {
        const clusterX = x + (random() * 2 - 1) * 13;
        objects.push({ kind: roll < 0.65 ? "pine" : "rock", x: clusterX, y: y + 3 + random() * 5, scale: 0.52 + random() * 0.47, seed: random() });
      }
      index += 1;
    }
    for (let gateY = 110; gateY < 18000; gateY += 124 + random() * 24) {
      objects.push({ kind: "gate", x: (random() * 2 - 1) * 66, y: gateY, seed: random(), passed: false });
    }
    objects.sort((a, b) => a.y - b.y);
    return objects;
  }

  function newRun() {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    run = {
      distance: 0,
      score: 0,
      gateScore: 0,
      bonusScore: 0,
      speed: 21,
      skierX: 0,
      cameraX: 0,
      lean: 0,
      crashed: 0,
      jump: 0,
      jumpCooldown: 0,
      yetiGap: null,
      yetiX: 0,
      yetiMood: false,
      objects: buildWorld(seed),
      particles: [],
      popups: [],
      tracks: [],
      lastTrack: 0,
      hitCount: 0,
      nearMisses: 0,
      gates: 0,
      lastCrashAt: -100,
      seed
    };
    for (let i = 0; i < 36; i++) {
      run.particles.push({ x: Math.random(), y: Math.random(), size: 0.4 + Math.random() * 1.5, speed: 0.16 + Math.random() * 0.34, alpha: 0.18 + Math.random() * 0.48 });
    }
    elapsed = 0;
    lastTipAt = 0;
    ui.best.textContent = `${best} m`;
    setState("playing");
  }

  function setState(next) {
    state = next;
    const inGame = next === "playing" || next === "paused";
    ui.hud.hidden = !inGame;
    ui.slopeLabel.hidden = !inGame;
    ui.bottomBar.hidden = !inGame;
    ui.pauseButton.hidden = next === "title" || next === "over";
    ui.pauseButton.setAttribute("aria-label", next === "paused" ? "Resume game" : "Pause game");
    ui.touchControls.hidden = next !== "playing";
    ui.startScreen.hidden = next !== "title";
    ui.pauseScreen.hidden = next !== "paused";
    ui.finishScreen.hidden = next !== "over";
    if (next === "playing") {
      if (elapsed - lastTipAt > 22) {
        ui.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
        lastTipAt = elapsed;
      }
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    snow = Array.from({ length: Math.max(26, Math.min(80, Math.floor(width * height / 15500))) }, () => ({
      x: Math.random(), y: Math.random(), size: 0.4 + Math.random() * 1.2, speed: 0.14 + Math.random() * 0.34, alpha: 0.16 + Math.random() * 0.35
    }));
  }

  function roundedRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function projectX(worldX) {
    const scale = Math.min(width / WORLD_WIDTH, 5.2);
    return width / 2 + (worldX - run.cameraX) * scale;
  }

  function projectY(worldY) {
    return height * PLAYER_Y_RATIO - (worldY - run.distance) * PROJECTION;
  }

  function drawMountain(cx, baseY, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - radius, baseY);
    ctx.lineTo(cx - radius * 0.24, baseY - radius * 0.55);
    ctx.lineTo(cx - radius * 0.08, baseY - radius * 0.42);
    ctx.lineTo(cx + radius * 0.22, baseY - radius);
    ctx.lineTo(cx + radius * 0.38, baseY - radius * 0.66);
    ctx.lineTo(cx + radius, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(248,253,255,.74)";
    ctx.beginPath();
    ctx.moveTo(cx + radius * 0.22, baseY - radius);
    ctx.lineTo(cx + radius * 0.38, baseY - radius * 0.66);
    ctx.lineTo(cx + radius * 0.24, baseY - radius * 0.76);
    ctx.lineTo(cx + radius * 0.18, baseY - radius * 0.62);
    ctx.lineTo(cx + radius * 0.08, baseY - radius * 0.77);
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#cfe8f2");
    sky.addColorStop(0.34, "#e5f2f7");
    sky.addColorStop(0.5, "#f2f8fa");
    sky.addColorStop(1, "#eef6f9");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const hazeY = Math.max(120, height * 0.38);
    const haze = ctx.createLinearGradient(0, hazeY - 70, 0, hazeY + 80);
    haze.addColorStop(0, "rgba(245,251,253,0)");
    haze.addColorStop(0.48, "rgba(245,251,253,.75)");
    haze.addColorStop(1, "rgba(240,248,251,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, hazeY - 70, width, 150);

    const mountainBase = height * 0.46;
    const drift = state === "playing" && run ? Math.sin(run.distance * 0.0013) * 16 : 0;
    drawMountain(width * 0.12 - drift, mountainBase, 125, "#bbd8e4");
    drawMountain(width * 0.34 - drift * 0.35, mountainBase + 20, 164, "#d4e8ef");
    drawMountain(width * 0.65 + drift * 0.5, mountainBase + 11, 140, "#c6e0e9");
    drawMountain(width * 0.88 + drift, mountainBase + 18, 182, "#b9d7e3");

    ctx.fillStyle = "rgba(255,255,255,.27)";
    for (let i = 0; i < 9; i++) {
      const x = ((i * 179 + (run ? run.distance * 0.18 : 0)) % (width + 120)) - 60;
      const y = height * 0.18 + (i % 4) * 23;
      ctx.beginPath();
      ctx.ellipse(x, y, 33 + i % 3 * 10, 8, 0, 0, TAU);
      ctx.fill();
    }

    const slope = ctx.createLinearGradient(0, mountainBase - 20, 0, height);
    slope.addColorStop(0, "rgba(246,251,253,.72)");
    slope.addColorStop(1, "#f5fafc");
    ctx.fillStyle = slope;
    ctx.fillRect(0, mountainBase - 20, width, height - mountainBase + 20);
  }

  function drawSnowfall(dt) {
    for (const flake of snow) {
      if (state === "playing") flake.y = (flake.y + flake.speed * dt * (run.speed / 22)) % 1.05;
      const x = flake.x * width + (state === "playing" ? Math.sin(elapsed * 0.4 + flake.y * 8) * 6 : 0);
      const y = flake.y * height;
      ctx.fillStyle = `rgba(255,255,255,${flake.alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, flake.size, 0, TAU);
      ctx.fill();
    }
  }

  function drawPine(x, y, scale, tint = 0) {
    const s = scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = "rgba(73,111,124,.12)";
    ctx.beginPath(); ctx.ellipse(3, 2, 15, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#6d503b";
    ctx.fillRect(-2, -8, 4, 13);
    const green = tint ? "#638c87" : "#477b77";
    ctx.fillStyle = green;
    ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(-15, -13); ctx.lineTo(-8, -15); ctx.lineTo(-19, -1); ctx.lineTo(-8, -3); ctx.lineTo(-14, 6); ctx.lineTo(14, 6); ctx.lineTo(8, -3); ctx.lineTo(19, -1); ctx.lineTo(8, -15); ctx.lineTo(15, -13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(240,250,252,.83)";
    ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(-7, -26); ctx.lineTo(-1, -28); ctx.lineTo(5, -19); ctx.lineTo(2, -29); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawRock(x, y, scale, seed) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(73,111,124,.12)";
    ctx.beginPath(); ctx.ellipse(2, 1, 17, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = seed > 0.5 ? "#8ca2a7" : "#96adb2";
    ctx.beginPath(); ctx.moveTo(-12, -1); ctx.lineTo(-8, -10); ctx.lineTo(-2, -15); ctx.lineTo(6, -12); ctx.lineTo(13, -3); ctx.lineTo(11, 3); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(244,251,253,.65)";
    ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(-2, -15); ctx.lineTo(3, -12); ctx.lineTo(-1, -8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawLog(x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.16); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(73,111,124,.12)"; ctx.beginPath(); ctx.ellipse(0, 3, 19, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#946d50"; roundedRect(-17, -4, 34, 9, 4); ctx.fill();
    ctx.fillStyle = "#c99c70"; ctx.beginPath(); ctx.ellipse(-17, 0, 3.5, 4.5, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawSnowman(x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(73,111,124,.11)"; ctx.beginPath(); ctx.ellipse(0, 2, 11, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -3, 7, 0, TAU); ctx.arc(0, -13, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = "#d88157"; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, -11); ctx.lineTo(0, -10); ctx.fill();
    ctx.fillStyle = "#345563"; ctx.beginPath(); ctx.arc(-1.5, -14, .7, 0, TAU); ctx.arc(1.5, -14, .7, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawMound(x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(73,111,124,.09)"; ctx.beginPath(); ctx.ellipse(0, 2, 21, 5, 0, 0, TAU); ctx.fill();
    const gradient = ctx.createLinearGradient(0, -10, 0, 4); gradient.addColorStop(0, "#ffffff"); gradient.addColorStop(1, "#c9e0e9");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(0, -2, 18, 7, 0, Math.PI, TAU); ctx.fill();
    ctx.restore();
  }

  function drawGate(x, y) {
    const flag = (fx, color, flap) => {
      ctx.strokeStyle = "#486e7c"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(fx, y + 11); ctx.lineTo(fx, y - 17); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(fx, y - 17); ctx.lineTo(fx + flap * 10, y - 14); ctx.lineTo(fx, y - 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillRect(fx - 1, y + 9, 3, 2);
    };
    flag(x - 30, "#e57e69", 1); flag(x + 30, "#4f9fbd", -1);
    ctx.setLineDash([3, 5]); ctx.strokeStyle = "rgba(89,139,159,.44)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 28, y + 8); ctx.lineTo(x + 28, y + 8); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawObject(object, screenY) {
    const x = projectX(object.x);
    const perspective = Math.max(0.54, Math.min(1.1, 0.55 + screenY / height * 0.5));
    const scale = object.scale * perspective;
    switch (object.kind) {
      case "pine": drawPine(x, screenY, scale, object.seed > 0.8 ? 1 : 0); break;
      case "rock": drawRock(x, screenY, scale, object.seed); break;
      case "log": drawLog(x, screenY, scale); break;
      case "snowman": drawSnowman(x, screenY, scale); break;
      case "mound": drawMound(x, screenY, scale); break;
      case "gate": drawGate(x, screenY); break;
    }
  }

  function drawTracks() {
    const baseX = projectX(run.skierX);
    for (let i = 0; i < 11; i++) {
      const distance = 12 + i * 14;
      const y = height * PLAYER_Y_RATIO - distance * PROJECTION;
      if (y < height * 0.42) continue;
      const fade = Math.max(0, 0.11 - i * 0.009);
      const bend = Math.sin((run.distance - distance) * 0.055 + run.lean * 0.15) * (4 + i * 1.15);
      ctx.strokeStyle = `rgba(112,164,183,${fade})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(baseX - 3 + bend, y); ctx.lineTo(baseX - 2 + bend, y - 9); ctx.moveTo(baseX + 3 + bend, y); ctx.lineTo(baseX + 4 + bend, y - 9); ctx.stroke();
    }
  }

  function drawSkier(x, y) {
    const turning = Math.max(-1, Math.min(1, run.lean / 35));
    const falling = run.crashed > 0;
    ctx.save();
    ctx.translate(x, y - (run.jump > 0 ? 12 + Math.sin((1 - run.jump / 0.72) * Math.PI) * 10 : 0));
    ctx.rotate(turning * 0.22 + (falling ? Math.sin(elapsed * 15) * 0.32 : 0));
    const air = run.jump > 0;
    if (air) {
      ctx.fillStyle = "rgba(54,99,118,.12)"; ctx.beginPath(); ctx.ellipse(0, 17, 13, 4, 0, 0, TAU); ctx.fill();
    }
    // Skis and poles.
    ctx.lineCap = "round";
    ctx.strokeStyle = "#246f9b"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, 12); ctx.lineTo(-5, -8); ctx.moveTo(10, 12); ctx.lineTo(5, -8); ctx.stroke();
    ctx.strokeStyle = "#698995"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-9, -1); ctx.lineTo(-17, 11); ctx.moveTo(9, -1); ctx.lineTo(17, 11); ctx.stroke();
    ctx.strokeStyle = "#f1a15b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-18, 10); ctx.lineTo(-16, 12); ctx.moveTo(16, 10); ctx.lineTo(18, 12); ctx.stroke();
    // Jacket and arms.
    ctx.fillStyle = falling ? "#dc8863" : "#e76f55";
    ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(-7, -5); ctx.lineTo(-4, -10); ctx.lineTo(4, -10); ctx.lineTo(7, -5); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = falling ? "#dc8863" : "#e76f55"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(-11, -1); ctx.moveTo(5, -7); ctx.lineTo(11, -1); ctx.stroke();
    // Hat, goggles, face.
    ctx.fillStyle = "#efc49c"; ctx.beginPath(); ctx.arc(0, -13, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = "#235f7e"; ctx.beginPath(); ctx.arc(0, -15, 4.5, Math.PI, TAU); ctx.lineTo(4.5, -14); ctx.lineTo(-4.5, -14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#dceef3"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3.5, -12); ctx.lineTo(3.5, -12); ctx.stroke();
    ctx.restore();
  }

  function drawYeti() {
    if (run.yetiGap === null) return;
    const y = height * PLAYER_Y_RATIO + run.yetiGap * PROJECTION;
    if (y < height * 0.78 || y > height + 95) return;
    const x = projectX(run.yetiX);
    const scale = Math.max(.7, Math.min(1.45, .87 + (y - height * .78) / height));
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(60,102,117,.15)"; ctx.beginPath(); ctx.ellipse(0, 14, 24, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#f8fbf7"; ctx.beginPath(); ctx.ellipse(0, 0, 17, 21, .08, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -15, 13, 13, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-16, 0, 6, 14, -.2, 0, TAU); ctx.ellipse(16, 0, 6, 14, .2, 0, TAU); ctx.fill();
    ctx.fillStyle = "#89a8a9"; ctx.beginPath(); ctx.arc(-4, -17, 1.7, 0, TAU); ctx.arc(4, -17, 1.7, 0, TAU); ctx.fill();
    ctx.fillStyle = "#a96458"; ctx.beginPath(); ctx.ellipse(0, -10, 4, 3, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#829c9a"; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(0, -8, 5, .2, Math.PI - .2); ctx.stroke();
    ctx.strokeStyle = "#f8fbf7"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-7, 17); ctx.lineTo(-10 + Math.sin(elapsed * 12) * 4, 22); ctx.moveTo(7, 17); ctx.lineTo(10 - Math.sin(elapsed * 12) * 4, 22); ctx.stroke();
    ctx.restore();
  }

  function drawPopups(dt) {
    for (let i = run.popups.length - 1; i >= 0; i--) {
      const popup = run.popups[i];
      if (state === "playing") popup.time += dt;
      const alpha = Math.max(0, 1 - popup.time / .9);
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center"; ctx.font = "500 10px 'DM Mono', monospace"; ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, projectX(popup.x), projectY(popup.y) - popup.time * 24);
      ctx.globalAlpha = 1;
      if (popup.time > .9) run.popups.splice(i, 1);
    }
  }

  function addPopup(text, x, y, color = "#267a96") {
    run.popups.push({ text, x, y, color, time: 0 });
  }

  function crash(message) {
    if (run.crashed > 0 || elapsed - run.lastCrashAt < 1.5) return;
    run.crashed = 1.35;
    run.lastCrashAt = elapsed;
    run.speed = Math.max(10, run.speed * .43);
    run.bonusScore -= 100;
    run.hitCount++;
    addPopup(message, run.skierX, run.distance, "#c96d56");
    showToast(message);
  }

  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 1050);
  }

  function endRun(caught) {
    if (state !== "playing") return;
    const distance = Math.floor(run.distance);
    run.score = Math.max(0, Math.floor(run.distance * 2 + run.gateScore + run.bonusScore));
    if (distance > best) { best = distance; saveBest(best); }
    ui.finishTitle.textContent = caught ? "Yeti got you." : "Nice run.";
    ui.finishOverline.textContent = caught ? "FRESH POWDER. FRESH TRACKS." : "THAT WAS A RUN";
    ui.finishCopy.textContent = caught ? "The mountain always gets the last laugh." : "A few more gates and you would have had it.";
    ui.finishBadge.textContent = caught ? "✳" : "↗";
    ui.finalScore.textContent = run.score.toLocaleString();
    ui.finalDistance.textContent = `${distance} m`;
    setState("over");
  }

  function update(dt) {
    if (!run || state !== "playing") return;
    elapsed += dt;
    const steerLeft = keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || pointerControls.has("left");
    const steerRight = keys.has("ArrowRight") || keys.has("d") || keys.has("D") || pointerControls.has("right");
    const fast = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
    const brake = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
    const steer = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    const targetSpeed = brake ? 12 : fast ? 35 : 23;
    run.speed += (targetSpeed - run.speed) * Math.min(1, dt * (brake || fast ? 2.8 : 1.1));
    if (run.crashed > 0) run.crashed = Math.max(0, run.crashed - dt);
    if (run.jumpCooldown > 0) run.jumpCooldown = Math.max(0, run.jumpCooldown - dt);
    if (run.jump > 0) run.jump = Math.max(0, run.jump - dt);
    if (steer && run.crashed <= 0) {
      const steeringRate = 26 + run.speed * .42;
      run.skierX += steer * steeringRate * dt;
      run.lean = lerp(run.lean, steer * 34, Math.min(1, dt * 8));
    } else {
      run.lean = lerp(run.lean, 0, Math.min(1, dt * 5));
    }
    run.skierX = Math.max(-111, Math.min(111, run.skierX));
    run.cameraX = lerp(run.cameraX, run.skierX * .6, Math.min(1, dt * 3.5));
    run.distance += run.speed * dt;
    run.score = Math.max(0, Math.floor(run.distance * 2 + run.gateScore + run.bonusScore));

    if (keys.has(" ") && run.jumpCooldown <= 0 && run.crashed <= 0) {
      run.jump = .72;
      run.jumpCooldown = 1.1;
      addPopup("AIR TIME", run.skierX, run.distance, "#397da0");
      keys.delete(" ");
    }

    const playerY = run.distance;
    for (const object of run.objects) {
      if (object.y < playerY - 15 || object.y > playerY + 68) continue;
      const deltaY = object.y - playerY;
      const deltaX = object.x - run.skierX;
      if (object.kind === "gate") {
        if (!object.passed && deltaY <= 0) {
          object.passed = true;
          if (Math.abs(deltaX) < 27) {
            const points = Math.abs(deltaX) < 12 ? 150 : 75;
            run.gateScore += points;
            run.gates++;
            addPopup(`GATE +${points}`, object.x, object.y, "#2580a1");
          }
        }
        continue;
      }
      const dangerRadius = object.kind === "pine" ? 5.7 * object.scale : object.kind === "log" ? 5.2 : object.kind === "snowman" ? 4.2 : object.kind === "mound" ? 4.8 : 4.3 * object.scale;
      if (!object.passed && Math.abs(deltaY) < 2.7) {
        object.passed = true;
        if (Math.abs(deltaX) < dangerRadius) {
          const jumpClears = run.jump > .05 && object.kind !== "pine";
          if (jumpClears) {
            run.bonusScore += 50;
            addPopup("CLEAN HOP +50", object.x, object.y, "#397da0");
          } else {
            crash(object.kind === "pine" ? "TREE!" : object.kind === "rock" ? "ROCK!" : object.kind === "log" ? "LOG!" : "WIPEOUT!");
          }
        } else if (Math.abs(deltaX) < dangerRadius + 2.2) {
          run.nearMisses++;
          if (run.nearMisses % 3 === 0) {
            run.bonusScore += 25;
            addPopup("CLOSE CALL +25", object.x, object.y, "#488c9f");
          }
        }
      }
    }

    if (run.yetiGap === null && run.distance > YETI_START) {
      run.yetiGap = 410;
      addPopup("SOMETHING'S FOLLOWING YOU…", run.skierX, run.distance + 8, "#526f7b");
      showToast("THE YETI IS ON YOUR TRACKS");
    }
    if (run.yetiGap !== null) {
      run.yetiGap -= dt * (5.8 + run.speed * .13);
      run.yetiX = lerp(run.yetiX, run.skierX + Math.sin(elapsed * 2.3) * 15, Math.min(1, dt * .75));
      if (run.yetiGap < 0) { endRun(true); return; }
    }

    if (elapsed - lastTipAt > 29) {
      ui.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
      lastTipAt = elapsed;
    }

    const distance = Math.floor(run.distance);
    ui.distance.textContent = distance.toLocaleString();
    ui.distanceBar.style.width = `${Math.min(100, distance / 30)}%`;
    ui.score.textContent = Math.floor(run.score).toLocaleString().padStart(5, "0");
    ui.scoreNote.textContent = run.gates ? `${run.gates} gate${run.gates === 1 ? "" : "s"} caught` : "Find the gates";
    ui.speed.textContent = Math.round(run.speed * 3.6);
    ui.best.textContent = `${Math.max(best, distance)} m`;
  }

  function render(dt) {
    drawBackground();
    if (!run || state === "title") {
      drawSnowfall(dt);
      return;
    }
    const horizonY = height * .43;
    // Thin blue trail markers make the piste edge legible without boxing in the open snowfield.
    for (let side of [-1, 1]) {
      const x = projectX(side * 126);
      ctx.fillStyle = "rgba(121,168,184,.12)";
      ctx.fillRect(side < 0 ? 0 : x, horizonY, Math.abs(x - (side < 0 ? 0 : width)), height - horizonY);
      ctx.strokeStyle = "rgba(100,151,171,.21)"; ctx.lineWidth = 1; ctx.setLineDash([2, 12]);
      ctx.beginPath(); ctx.moveTo(x, horizonY); ctx.lineTo(x, height); ctx.stroke(); ctx.setLineDash([]);
    }
    drawTracks();
    const visible = [];
    for (const object of run.objects) {
      const y = projectY(object.y);
      if (y > horizonY - 30 && y < height + 40) visible.push({ object, y });
    }
    visible.sort((a, b) => a.y - b.y);
    for (const item of visible) drawObject(item.object, item.y);
    drawYeti();
    drawSkier(projectX(run.skierX), height * PLAYER_Y_RATIO);
    drawPopups(dt);
    if (run.crashed > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(.22, run.crashed * .1)})`;
      ctx.fillRect(0, 0, width, height);
    }
    drawSnowfall(dt);
  }

  function frame(now) {
    const dt = Math.min(.04, previousTime ? (now - previousTime) / 1000 : .016);
    previousTime = now;
    update(dt);
    render(dt);
    requestAnimationFrame(frame);
  }

  function pauseToggle() {
    if (state === "playing") setState("paused");
    else if (state === "paused") setState("playing");
  }

  document.addEventListener("keydown", (event) => {
    const key = event.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) event.preventDefault();
    if (key === "Escape" || key.toLowerCase() === "p") {
      if (state === "title") return;
      pauseToggle();
      return;
    }
    if ((key === "Enter" || key === " ") && state === "title") { newRun(); return; }
    if ((key === "Enter" || key === " ") && state === "over") { newRun(); return; }
    if (state === "playing") keys.add(key);
  });

  document.addEventListener("keyup", (event) => keys.delete(event.key));
  window.addEventListener("blur", () => { keys.clear(); pointerControls.clear(); if (state === "playing") setState("paused"); });
  window.addEventListener("resize", resize);
  ui.startButton.addEventListener("click", newRun);
  ui.restartButton.addEventListener("click", newRun);
  ui.resumeButton.addEventListener("click", () => { if (state === "paused") setState("playing"); });
  ui.pauseButton.addEventListener("click", pauseToggle);

  for (const button of ui.touchControls.querySelectorAll("[data-control]")) {
    const control = button.dataset.control;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      pointerControls.add(control);
      if (control === "jump") keys.add(" ");
      button.setPointerCapture(event.pointerId);
    });
    const release = () => { pointerControls.delete(control); if (control === "jump") keys.delete(" "); };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }

  resize();
  ui.best.textContent = `${best} m`;
  setState("title");
  requestAnimationFrame(frame);
})();
