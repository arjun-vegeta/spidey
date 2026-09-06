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

  // Global registry of all active ink materials to update line-boil time
  private static registeredMaterials = new Set<THREE.ShaderMaterial>();

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

      // Authentic pen stroke hatching with line-boil wobble
      float hatch(vec2 coord, float angle, float spacing, float width) {
        float rad = radians(angle);
        vec2 rotCoord = vec2(
          coord.x * cos(rad) - coord.y * sin(rad),
          coord.x * sin(rad) + coord.y * cos(rad)
        );
        // Subtle hand-drawn jitter that shifts organically
        float wobble = sin(rotCoord.x * 0.12 + uTime * 2.5) * 0.35 +
                       sin(rotCoord.x * 0.35 - uTime * 1.8) * 0.2;
        float pos = mod(rotCoord.y + wobble, spacing);
        return step(pos, width);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 lightDir = normalize(uLightDir);
        float NdotL = max(dot(normal, lightDir), 0.0);

        // Shading tone from 0.0 (fully lit) to 1.0 (deep shadow)
        float tone = 1.0 - (NdotL * 0.72 + 0.28);
        if (uIsEnemy > 0.5) {
          tone += 0.12; // Deeper hatching for hostiles
        }

        // Coordinate space for hatching:
        // High-density fine pen strokes for architectural sketch realism
        vec2 hatchCoord;
        if (uUseUv > 0.5) {
          hatchCoord = vUv * uUvScale * 32.0;
        } else {
          // Triplanar projection based on dominant normal
          vec3 blendWeights = abs(normal);
          blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);

          if (blendWeights.y > blendWeights.x && blendWeights.y > blendWeights.z) {
            hatchCoord = vWorldPosition.xz * 14.0;
          } else if (blendWeights.x > blendWeights.z) {
            hatchCoord = vWorldPosition.yz * 14.0;
          } else {
            hatchCoord = vWorldPosition.xy * 14.0;
          }
        }

        float hatchMask = 0.0;
        // Tone 1: Light shadow - fine 45 deg diagonal pen stroke
        if (tone > 0.16) {
          hatchMask = max(hatchMask, hatch(hatchCoord, 45.0, 1.8, 0.28));
        }
        // Tone 2: Medium shadow - crossed -45 deg stroke
        if (tone > 0.40) {
          hatchMask = max(hatchMask, hatch(hatchCoord, -45.0, 1.8, 0.28));
        }
        // Tone 3: Deep shadow - horizontal counter-hatch (0 deg)
        if (tone > 0.65) {
          hatchMask = max(hatchMask, hatch(hatchCoord, 0.0, 1.4, 0.32));
        }
        // Tone 4: Ambient occlusion / crevices - vertical counter-hatch (90 deg)
        if (tone > 0.85) {
          hatchMask = max(hatchMask, hatch(hatchCoord, 90.0, 1.4, 0.32));
        }

        // Cap ink coverage so shaded areas never turn into pitch black; cream paper always breathes through
        hatchMask = min(hatchMask, 0.76);

        // Authentic warm notebook paper substrate (#FAF7EE)
        vec3 paperColor = vec3(0.980, 0.968, 0.933);

        // Select ink color
        vec3 activeInk = uInkColor;
        if (uIsEnemy > 0.5) {
          activeInk = mix(uInkColor, uAccentColor, 0.85);
        } else if (uIsCrane > 0.5) {
          activeInk = vec3(0.902, 0.494, 0.133); // Vibrant drafting orange
        } else if (uIsAccent > 0.5) {
          activeInk = uAccentColor;
        }

        vec3 finalColor = mix(paperColor, activeInk, hatchMask);
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
        uLightDir: { value: new THREE.Vector3(0.45, 0.85, 0.35).normalize() }
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
