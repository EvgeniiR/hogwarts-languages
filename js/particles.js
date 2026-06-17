export class ParticleEngine {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'particle-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:-1;border-radius:6px;';
    this.ctx = this.canvas.getContext('2d');
    this.ambientParticles = [];
    this.bursts = [];
    this.running = false;
    this.rafId = null;
    this.w = 0;
    this.h = 0;
    const pos = getComputedStyle(container).position;
    if (pos === 'static')
      container.style.position = 'relative';
    if (pos !== 'fixed' && pos !== 'absolute' && getComputedStyle(container).zIndex === 'auto')
      container.style.zIndex = '0';
    container.appendChild(this.canvas);
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    if (!this.w || !this.h) return;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    if (this.running) return;
    this._resize();
    if (!this.w || !this.h) { this.running = true; this._loop(); return; }
    this.running = true;
    for (let i = 0; i < 35; i++)
      this.ambientParticles.push(this._mkAmbient());
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    window.removeEventListener('resize', this._onResize);
    this.ambientParticles = [];
    this.bursts = [];
    if (this.canvas && this.canvas.parentNode)
      this.canvas.parentNode.removeChild(this.canvas);
  }

  _mkAmbient() {
    return {
      x: Math.random() * this.w, y: Math.random() * this.h,
      vx: (Math.random() - 0.5) * 0.3, vy: -(0.15 + Math.random() * 0.4),
      size: 1 + Math.random() * 2, alpha: 0.15 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.4 ? '232,200,96' : '180,210,255'
    };
  }

  getPos(el) {
    const cRect = this.canvas.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return {
      x: eRect.left + eRect.width / 2 - cRect.left,
      y: eRect.top + eRect.height / 2 - cRect.top
    };
  }

  burst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * Math.random();
      const speed = 1.5 + Math.random() * 3;
      this.bursts.push({
        x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.012 + Math.random() * 0.018,
        size: 2 + Math.random() * 4,
        color: color || '232,200,96'
      });
    }
  }

  _loop() {
    if (!this.running) return;
    if (!this.w || !this.h) { this._resize(); if (!this.w || !this.h) { this.rafId = requestAnimationFrame(() => this._loop()); return; } }
    this.ctx.clearRect(0, 0, this.w, this.h);
    const now = Date.now() / 1000;

    for (const p of this.ambientParticles) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = this.h + 5; p.x = Math.random() * this.w; }
      if (p.x < -10) p.x = this.w + 5;
      if (p.x > this.w + 10) p.x = -5;
      this.ctx.globalAlpha = p.alpha * (0.5 + 0.5 * Math.sin(now + p.phase));
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${p.color},${this.ctx.globalAlpha})`;
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;

    this.bursts = this.bursts.filter(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.04; p.vx *= 0.96; p.vy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) return false;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${p.color},${p.life * 0.85})`;
      this.ctx.fill();
      return true;
    });

    this.rafId = requestAnimationFrame(() => this._loop());
  }
}
