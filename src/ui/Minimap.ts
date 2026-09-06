export interface MapEnemy {
  x: number;
  z: number;
  kind: string;
}

export interface MapBuilding {
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * Bottom-center circular minimap: player-centered, north-up.
 * Building footprints are pre-rendered once to an offscreen layer;
 * per frame only the crop + dots + player arrow are drawn.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D | null;
  private staticLayer: HTMLCanvasElement | null = null;
  private readonly size: number;
  private readonly range: number = 95;
  private readonly half: number;
  private visible: boolean = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = typeof document !== 'undefined' ? canvas.getContext('2d') : null;
    this.size = canvas.width;
    this.half = this.size / 2;
  }

  public get scale(): number {
    return (this.half - 8) / this.range;
  }

  public setVisible(v: boolean): void {
    this.visible = v;
    const wrap = this.canvas.parentElement;
    if (wrap) wrap.style.display = v ? 'block' : 'none';
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  public setBuildings(buildings: MapBuilding[]): void {
    if (typeof document === 'undefined') return;
    const s = this.scale;
    const world = 520;
    const layer = document.createElement('canvas');
    layer.width = Math.ceil(world * s);
    layer.height = Math.ceil(world * s);
    const g = layer.getContext('2d');
    if (!g) return;
    g.fillStyle = '#efe8d6';
    g.fillRect(0, 0, layer.width, layer.height);
    g.fillStyle = 'rgba(21, 39, 120, 0.28)';
    for (const b of buildings) {
      g.fillRect((b.x - b.w / 2 + 260) * s, (b.z - b.d / 2 + 260) * s, Math.max(2, b.w * s), Math.max(2, b.d * s));
    }
    // Construction site tint at origin
    g.fillStyle = 'rgba(230, 126, 34, 0.30)';
    g.fillRect((0 - 13 + 260) * s, (0 - 11 + 260) * s, 26 * s, 22 * s);
    this.staticLayer = layer;
  }

  public draw(px: number, pz: number, yaw: number, enemies: MapEnemy[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const S = this.size;
    const H = this.half;
    const s = this.scale;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(H, H, H - 2, 0, Math.PI * 2);
    ctx.clip();

    // Paper base
    ctx.fillStyle = '#f3eedd';
    ctx.fillRect(0, 0, S, S);

    // Static buildings crop around player
    if (this.staticLayer) {
      const sx = (px + 260) * s - H;
      const sy = (pz + 260) * s - H;
      ctx.drawImage(this.staticLayer, sx, sy, S, S, 0, 0, S, S);
    }

    const dot = (wx: number, wz: number): [number, number] => [(wx - px) * s + H, (wz - pz) * s + H];

    // Enemies
    for (const e of enemies) {
      const [ex, ey] = dot(e.x, e.z);
      if (ex < 0 || ey < 0 || ex > S || ey > S) continue;
      if (e.kind === 'drone') {
        ctx.fillStyle = '#e67e22';
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#d63031';
        ctx.beginPath();
        ctx.arc(ex, ey, e.kind === 'sniper' ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        if (e.kind === 'sniper') {
          ctx.strokeStyle = '#faf7ee';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ex, ey, 5.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Player view cone + arrow (canvas angle clockwise from up = -yaw)
    ctx.fillStyle = 'rgba(21, 39, 120, 0.15)';
    ctx.beginPath();
    ctx.moveTo(H, H);
    ctx.arc(H, H, 34, -yaw - Math.PI / 6 - Math.PI / 2, -yaw + Math.PI / 6 - Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(H, H);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#152778';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // Ink ring border
    ctx.strokeStyle = '#152778';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(H, H, H - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}
