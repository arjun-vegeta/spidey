import * as THREE from 'three';

export interface InkMaterialOptions {
  paperTexture?: THREE.Texture;
  hatchTexture?: THREE.Texture;
  inkColor?: THREE.Color;
  accentColor?: THREE.Color;
  isEnemy?: boolean;
  isCrane?: boolean;
  isAccent?: boolean;
  useUv?: boolean;
  uvScale?: number;
  wireframe?: boolean;
}

export class InkShaderMaterial {
  public static defaultInkColor = new THREE.Color(0x152778); // Deep ballpoint navy/blue
  public static defaultAccentColor = new THREE.Color(0xd63031); // Red ink
  public static craneColor = new THREE.Color(0xe67e22); // Orange ink
  public static defaultLightDir = new THREE.Vector3(0.40, 0.75, 0.45).normalize();

  // Global registry of all active ink materials to update line-boil time
  private static registeredMaterials = new Set<THREE.ShaderMaterial>();

  public static setLightDirection(dir: THREE.Vector3): void {
    const normalized = dir.clone().normalize();
    this.defaultLightDir.copy(normalized);
    this.registeredMaterials.forEach((mat) => {
      if (mat.uniforms && mat.uniforms.uLightDir) {
        mat.uniforms.uLightDir.value.copy(normalized);
      }
    });
  }

  public static update(dt: number): void {
    const timeDelta = dt;
    this.registeredMaterials.forEach((mat) => {
      if (mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value += timeDelta;
      }
    });
  }

  public static create(options: InkMaterialOptions = {}): THREE.ShaderMaterial {
    const inkColor = options.inkColor || this.defaultInkColor;
    const accentColor = options.accentColor || this.defaultAccentColor;
    const useUv = options.useUv ?? false;
    const uvScale = options.uvScale ?? 10.0;

    const vertexShader = `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform vec3 uInkColor;
      uniform vec3 uAccentColor;
      uniform float uIsEnemy;
      uniform float uIsCrane;
      uniform float uIsAccent;
      uniform float uUseUv;
      uniform float uUvScale;
      uniform vec3 uLightDir;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying vec2 vUv;

      // Lightweight procedural value noise for organic pen stroke waver
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Smooth anti-aliased pen stroke hatching (inspiration render.js parity)
      float stripes(vec2 p, vec2 dir, float spacing, float width) {
        float t = dot(p, vec2(-dir.y, dir.x));
        float f = abs(fract(t / spacing) - 0.5) * spacing;
        float soft = width * 0.5;
        return 1.0 - smoothstep(width * 0.5 - soft, width * 0.5 + soft, f);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        if (!gl_FrontFacing) normal = -normal;
        vec3 lightDir = normalize(uLightDir);

        // Directional half-Lambert shading [0.0 (deep shadow) to 1.0 (fully lit)]:
        float ndl = dot(normal, lightDir) * 0.5 + 0.5;
        float shade = ndl;
        if (uIsEnemy > 0.5) {
          shade -= 0.14; // Deeper hatching for hostiles
        }

        // Distance from camera for adaptive distance-scaled LOD
        float dist = length(vViewPosition);

        // Quantized power-of-two LOD: line spacing steps with distance so on-screen density
        // stays clean (~9-12px) without collapsing into moire or ballooning into giant bars.
        // Clamped to max 6.0 so far buildings stay as detailed architectural drawings, not giant slabs.
        float lod = min(6.0, exp2(floor(log2(max(1.0, dist / 14.0)))));
        float sp = 0.25 * lod;
        float w = sp * 0.11; // Fine, elegant pen stroke width (reduced from heavy 0.18)

        // Triplanar world projection onto the dominant normal plane (in world meters)
        vec2 hp;
        if (uUseUv > 0.5) {
          hp = vUv * uUvScale * 12.0;
        } else {
          vec3 an = abs(normal);
          hp = an.y > max(an.x, an.z) ? vWorldPosition.xz : (an.x > an.z ? vWorldPosition.zy : vWorldPosition.xy);
        }

        // Hand-drawn organic waver: subtle pen tremor (reduced amplitude from 0.22 to 0.12)
        hp += (vec2(vnoise(hp * (2.2 / sp) + 7.1), vnoise(hp * (2.2 / sp) + 31.4)) - 0.5) * (sp * 0.12);

        // Multi-directional architectural drafting strokes:
        const vec2 d1 = vec2(0.7071, 0.7071);   // 45 deg diagonal
        const vec2 d2 = vec2(-0.7071, 0.7071);  // -45 deg diagonal
        const vec2 d3 = vec2(0.2588, 0.9659);   // 15 deg counter-angle

        float h1 = stripes(hp, d1, sp, w);
        float h2 = stripes(hp, d2, sp * 1.15, w);
        float h3 = stripes(hp, d3, sp * 0.75, w);

        // Directional shading tone progression (reduced threshold so sunlit/grazing facades stay clean paper):
        // Direct sun & glancing walls (shade > 0.56): clean cream paper
        // Soft shadow (shade <= 0.56 to 0.40): fine h1 single diagonal
        // Moderate shadow (shade <= 0.40 to 0.24): h1 + h2 crosshatch
        // Deep crevice (shade <= 0.24 to 0.08): h1 + h2 + h3 triple crosshatch
        float hatch = h1 * smoothstep(0.56, 0.40, shade);
        hatch = max(hatch, h2 * smoothstep(0.40, 0.24, shade));
        hatch = max(hatch, h3 * smoothstep(0.24, 0.10, shade));
        hatch = max(hatch, smoothstep(0.10, 0.01, shade) * 0.70);

        // Aerial perspective fade: far buildings have much softer, lighter ink so depth reads naturally
        float fade = mix(1.0, 0.22, smoothstep(14.0, 110.0, dist));
        hatch *= 0.65 * fade; // Scaled down overall dynamic shading texture density (reduced from heavy 1.0)

        // Cap ink coverage so shaded areas never turn into pitch black; cream paper always breathes through
        hatch = min(hatch, 0.48);

        // Authentic warm notebook paper substrate (#F5EEDD)
        vec3 paperColor = vec3(0.961, 0.933, 0.867);

        // Select ink color
        vec3 activeInk = uInkColor;
        if (uIsEnemy > 0.5) {
          activeInk = uAccentColor;
          paperColor = mix(paperColor, vec3(1.0, 0.82, 0.82), 0.65);
          hatch = max(hatch * 1.35, 0.32);
          hatch = min(hatch, 0.88);
        } else if (uIsCrane > 0.5) {
          activeInk = vec3(0.902, 0.494, 0.133); // Vibrant drafting orange
        } else if (uIsAccent > 0.5) {
          activeInk = uAccentColor;
        }

        vec3 finalColor = mix(paperColor, activeInk, hatch);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uInkColor: { value: inkColor },
        uAccentColor: { value: accentColor },
        uIsEnemy: { value: options.isEnemy ? 1.0 : 0.0 },
        uIsCrane: { value: options.isCrane ? 1.0 : 0.0 },
        uIsAccent: { value: options.isAccent ? 1.0 : 0.0 },
        uUseUv: { value: useUv ? 1.0 : 0.0 },
        uUvScale: { value: uvScale },
        uLightDir: { value: this.defaultLightDir.clone() }
      },
      wireframe: options.wireframe || false,
      // Push mesh polygons slightly back so edge line segments render razor sharp without z-fighting
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 1.0
    });

    this.registeredMaterials.add(material);
    return material;
  }

  public static unregister(material: THREE.ShaderMaterial): void {
    this.registeredMaterials.delete(material);
  }

  /**
   * Helper to create wireframe / edge outlines in ballpoint blue ink
   */
  public static createEdgeLines(
    geometry: THREE.BufferGeometry,
    color: THREE.Color = this.defaultInkColor,
    thresholdAngle: number = 28
  ): THREE.LineSegments {
    const edgesGeom = new THREE.EdgesGeometry(geometry, thresholdAngle);
    const lineMat = new THREE.LineBasicMaterial({
      color: color,
      depthTest: true,
      transparent: false
    });
    const lines = new THREE.LineSegments(edgesGeom, lineMat);
    lines.renderOrder = 1;
    return lines;
  }
}
