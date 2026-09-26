// Essai F2C - interface de generation et validation graphique des lignes de guidage.
"use strict";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("message");
const statsBox = document.getElementById("stats");
const btnValidate = document.getElementById("btn-validate");

let field = [];      // sommets [[x,y],...] metres
let plan = null;     // dernier plan genere
let view = null;     // transformation metres -> pixels

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio;
  canvas.height = r.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  fitView();
  draw();
}
window.addEventListener("resize", resize);

function fitView() {
  const r = canvas.getBoundingClientRect();
  const pts = field.slice();
  if (plan && plan.route) pts.push(...plan.route);
  if (!pts.length) { view = { s: 1, tx: 0, ty: 0 }; return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 30;
  const s = Math.min((r.width - 2 * pad) / Math.max(maxX - minX, 1),
                     (r.height - 2 * pad) / Math.max(maxY - minY, 1));
  view = {
    s,
    tx: (r.width - s * (minX + maxX)) / 2,
    ty: r.height - (r.height - s * (minY + maxY)) / 2,
  };
}

function px(x, y) { return [view.tx + view.s * x, view.ty - view.s * y]; }

function draw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);

  // parcelle
  if (field.length) {
    ctx.beginPath();
    field.forEach(function(p, i) {
      const q = px(p[0], p[1]);
      if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(129, 199, 132, 0.35)";
    ctx.fill();
    ctx.strokeStyle = "#388e3c";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // plan genere : etats colores, sinon route simple
  if (plan) {
    if (plan.states && plan.states.length) {
      for (let i = 1; i < plan.states.length; i++) {
        const s0 = plan.states[i - 1], s1 = plan.states[i];
        const a = px(s0[0], s0[1]), b = px(s1[0], s1[1]);
        const isTurn = String(s0[2]).indexOf("TURN") >= 0;
        ctx.strokeStyle = isTurn ? "#ff9800" : "#2e7d32";
        ctx.lineWidth = isTurn ? 1.5 : 2.5;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    } else if (plan.route) {
      ctx.strokeStyle = "#2e7d32";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      plan.route.forEach(function(p, i) {
        const q = px(p[0], p[1]);
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      });
      ctx.stroke();
    }
  }

  // sommets
  ctx.fillStyle = "#1565c0";
  for (const p of field) {
    const q = px(p[0], p[1]);
    ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- interaction parcelle
canvas.addEventListener("click", function(e) {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const x = (mx - view.tx) / view.s;
  const y = (view.ty - my) / view.s;
  field.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  plan = null; btnValidate.disabled = true;
  draw();
});

document.getElementById("btn-clear").addEventListener("click", function() {
  field = []; plan = null; btnValidate.disabled = true;
  setMsg(""); statsBox.innerHTML = ""; fitView(); draw();
});

document.getElementById("btn-square").addEventListener("click", function() {
  field = [[0, 0], [10, 0], [10, 10], [0, 10]];
  plan = null; btnValidate.disabled = true;
  fitView(); draw();
});

// ---- generation
function options() {
  return {
    workWidth: parseFloat(document.getElementById("opt-width").value),
    headlandPasses: parseInt(document.getElementById("opt-passes").value, 10),
    angleDeg: parseFloat(document.getElementById("opt-angle").value),
    routePlanner: document.getElementById("opt-rp").value,
    pathSolver: document.getElementById("opt-pp").value,
    minTurningRadius: parseFloat(document.getElementById("opt-radius").value),
  };
}

function setMsg(t, cls) { msg.textContent = t; msg.className = cls || ""; }

document.getElementById("btn-generate").addEventListener("click", async function() {
  if (field.length < 3) { setMsg("Posez au moins 3 sommets de parcelle.", "err"); return; }
  setMsg("Generation en cours...");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: field, options: options() }),
    });
    const data = await res.json();
    if (!data.ok) { setMsg("Erreur : " + data.error, "err"); plan = null; btnValidate.disabled = true; draw(); return; }
    plan = data.plan;
    btnValidate.disabled = false;
    const st = plan.stats || {};
    statsBox.innerHTML =
      "Longueur route : " + (st.routeLength != null ? st.routeLength.toFixed(1) + " m" : "n/a") + "<br>" +
      "Longueur chemin : " + (st.pathLength != null ? st.pathLength.toFixed(1) + " m" : "n/a") + "<br>" +
      "Etats : " + (st.numStates != null ? st.numStates : "n/a") +
      (plan.statesError ? "<br>" + plan.statesError : "");
    setMsg("Plan genere - verifiez le trace puis validez.", "ok");
    fitView(); draw();
  } catch (e) {
    setMsg("Serveur injoignable : " + e, "err");
  }
});

// ---- validation (verrouillage)
btnValidate.addEventListener("click", async function() {
  try {
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json();
    if (data.ok) {
      setMsg("Lignes VALIDEES et verrouillees. Fichier : " + data.file, "ok");
      btnValidate.disabled = true;
    } else {
      setMsg("Erreur validation : " + data.error, "err");
    }
  } catch (e) {
    setMsg("Serveur injoignable : " + e, "err");
  }
});

resize();
