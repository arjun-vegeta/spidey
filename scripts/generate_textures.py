#!/usr/bin/env python3
"""
High-Resolution Hand-Drawn Blue Ink & Notebook Paper Texture Generator
for Spider-Man First-Person Game (Three.js WebGL).

Strictly replicates the ballpoint blue ink pen on lined notebook paper aesthetic:
- paper_notebook.png (2048x2048): Cream paper, blue rules every 48px, red margin at x=200, fiber noise, edge vignette.
- hatch_lut.png (1024x1024 & 512x2048): 4 tonal levels of seamlessly tileable ballpoint blue hatching (#1B2D7C / #14215E).
- spidey_arm_tex.png (1024x1024): FPS arms/gloves, pen-and-ink web grid, Spider emblem on gauntlet, silver web-shooter, stitched finger pads.
- muzzle_flash_ink.png (512x512): Hand-drawn comic book ink starburst / muzzle flare with sharp radiating ink spikes and splatters.
- ink_impact_atlas.png (1024x1024): 4x4 grid of 16 distinct hand-drawn ink splatters, bullet chip marks, comic impact lines, and ink drips.
- sniper_reticle.png (1024x1024): Hand-drawn drafting / blueprint sniper scope reticle with mil-dots, stadiametric rangefinder, BDC elevation brackets.
- speed_lines.png (1024x1024): Radial sketched speed lines with transparent center and dense outer ballpoint ink strokes.
"""

import os
import sys
import math
import random
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image, ImageDraw, ImageFont, ImageFilter

TEXTURE_DIR = "/Users/arjun/Desktop/spidey/public/textures"
os.makedirs(TEXTURE_DIR, exist_ok=True)

# Common Palette
INK_DARK = (20, 33, 94)       # #14215E Deep navy ballpoint core
INK_BLUE = (27, 45, 124)      # #1B2D7C Ballpoint blue
INK_LIGHT = (44, 75, 166)     # #2C4BA6 Lighter blue ink feathering
RULE_BLUE = (122, 150, 212)   # #7A96D4 Faint notebook ruled line blue
RULE_LIGHT = (142, 168, 219)  # #8EA8DB Light notebook rule
MARGIN_RED = (222, 83, 83)    # #DE5353 Notebook margin red
SUIT_RED = (214, 48, 49)      # #D63031 Comic red suit
PAPER_CREAM = (250, 247, 238) # #FAF7EE Off-white notebook paper base

# Try loading Noteworthy or system font for drafting/sketched text
FONT_NOTE = None
FONT_NOTE_SM = None
for font_path in [
    "/System/Library/Fonts/Noteworthy.ttc",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Courier.ttc",
    "/System/Library/Fonts/Menlo.ttc",
]:
    if os.path.exists(font_path):
        try:
            FONT_NOTE = ImageFont.truetype(font_path, 22)
            FONT_NOTE_SM = ImageFont.truetype(font_path, 16)
            break
        except Exception:
            pass

if FONT_NOTE is None:
    FONT_NOTE = ImageFont.load_default()
    FONT_NOTE_SM = ImageFont.load_default()


# ==============================================================================
# 1. NOTEBOOK PAPER TEXTURE (2048 x 2048)
# ==============================================================================
def generate_paper_notebook():
    print("Generating paper_notebook.png (2048x2048)...")
    width, height = 2048, 2048
    np.random.seed(42)
    random.seed(42)

    # Base paper substrate
    base = np.full((height, width, 3), PAPER_CREAM, dtype=np.float32)

    # Multi-octave Perlin/Gaussian paper fiber noise
    fine_grain = np.random.normal(0, 1.8, (height, width))
    mid_noise = gaussian_filter(np.random.normal(0, 2.2, (512, 512)), sigma=2.0)
    mid_noise = np.repeat(np.repeat(mid_noise, 4, axis=0), 4, axis=1)
    low_noise = gaussian_filter(np.random.normal(0, 3.0, (128, 128)), sigma=3.0)
    low_noise = gaussian_filter(np.repeat(np.repeat(low_noise, 16, axis=0), 16, axis=1), sigma=12.0)

    fiber_total = fine_grain + mid_noise + low_noise
    for c in range(3):
        base[:, :, c] += fiber_total

    # Aged edge vignette (warm darkening toward edges)
    y_coords, x_coords = np.indices((height, width))
    norm_x = (x_coords - width / 2.0) / (width / 2.0)
    norm_y = (y_coords - height / 2.0) / (height / 2.0)
    radius = np.sqrt(norm_x**2 + norm_y**2)
    
    # Vignette factor: subtle darkening starting at r=0.7
    vignette = 1.0 - 0.08 * np.clip((radius - 0.7) / 0.55, 0.0, 1.0)
    base[:, :, 0] *= vignette
    base[:, :, 1] *= vignette * 0.99
    base[:, :, 2] *= vignette * 0.97 # slightly warmer sepia edge

    base = np.clip(base, 0, 255).astype(np.uint8)
    img = Image.fromarray(base, mode="RGB")
    draw = ImageDraw.Draw(img, "RGBA")

    # Embedded cellulose fiber strands
    for _ in range(350):
        fx = random.randint(20, width - 20)
        fy = random.randint(20, height - 20)
        length = random.randint(12, 36)
        f_ang = random.uniform(0, 2 * math.pi)
        pts = []
        cx, cy = fx, fy
        for s in range(4):
            pts.append((cx, cy))
            cx += math.cos(f_ang + random.uniform(-0.4, 0.4)) * (length / 3)
            cy += math.sin(f_ang + random.uniform(-0.4, 0.4)) * (length / 3)
        fiber_alpha = random.randint(25, 60)
        fiber_col = random.choice([
            (210, 200, 185, fiber_alpha),
            (195, 185, 170, fiber_alpha),
            (170, 185, 210, fiber_alpha - 10) # faint blue rag fiber
        ])
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i+1]], fill=fiber_col, width=1)

    # Faint dot grid watermark (48px spacing)
    for gy in range(48, height - 24, 48):
        for gx in range(48, width - 24, 48):
            draw.point((gx, gy), fill=(160, 180, 220, 20))

    # Ruled notebook lines (spaced exactly every 48 pixels)
    start_y = 144
    line_spacing = 48
    x_steps = np.arange(0, width + 16, 16)

    # Top header line (double ruled)
    for y_rule in [140, 144]:
        pts = []
        phase = random.uniform(0, 10)
        for x in x_steps:
            wobble = 0.5 * math.sin(x * 0.008 + phase) + random.uniform(-0.2, 0.2)
            pts.append((x, y_rule + wobble))
        rule_rgba = (RULE_BLUE[0], RULE_BLUE[1], RULE_BLUE[2], 210)
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i+1]], fill=rule_rgba, width=2)

    # Regular ruled lines every 48px from 192 down to 2016
    for y_rule in range(start_y + line_spacing, height - 24, line_spacing):
        pts = []
        phase1 = random.uniform(0, 10)
        phase2 = random.uniform(0, 10)
        for x in x_steps:
            wobble = 0.55 * math.sin(x * 0.006 + phase1) + 0.3 * math.sin(x * 0.022 + phase2) + random.uniform(-0.25, 0.25)
            pts.append((x, y_rule + wobble))
        alpha = random.randint(155, 195)
        rule_rgba = (RULE_LIGHT[0], RULE_LIGHT[1], RULE_LIGHT[2], alpha)
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i+1]], fill=rule_rgba, width=2)

    # Vertical red margin line at x = 200 with organic wave and ink bleed
    margin_x = 200
    y_steps = np.arange(0, height + 16, 16)
    pts_red = []
    phase_red1 = random.uniform(0, 10)
    phase_red2 = random.uniform(0, 10)
    for y in y_steps:
        wobble = 1.2 * math.sin(y * 0.011 + phase_red1) + 0.5 * math.sin(y * 0.033 + phase_red2) + random.uniform(-0.35, 0.35)
        pts_red.append((margin_x + wobble, y))

    # Ink bleed halo (feathering)
    bleed_rgba = (MARGIN_RED[0], MARGIN_RED[1], MARGIN_RED[2], 75)
    for i in range(len(pts_red) - 1):
        p1, p2 = pts_red[i], pts_red[i+1]
        draw.line([(p1[0] - 1, p1[1]), (p2[0] - 1, p2[1])], fill=bleed_rgba, width=3)
        draw.line([(p1[0] + 1, p1[1]), (p2[0] + 1, p2[1])], fill=bleed_rgba, width=3)

    # Solid red margin core
    core_rgba = (MARGIN_RED[0], MARGIN_RED[1], MARGIN_RED[2], 235)
    for i in range(len(pts_red) - 1):
        draw.line([pts_red[i], pts_red[i+1]], fill=core_rgba, width=2)

    # Second faint margin line at x=206 (classic dual-ruled margin)
    pts_red2 = [(p[0] + 6, p[1]) for p in pts_red]
    faint_red = (235, 110, 110, 85)
    for i in range(len(pts_red2) - 1):
        draw.line([pts_red2[i], pts_red2[i+1]], fill=faint_red, width=1)

    # Header drafting guides "NO." and "DATE:"
    draw.text((1620, 88), "NO.", fill=(RULE_BLUE[0], RULE_BLUE[1], RULE_BLUE[2], 180), font=FONT_NOTE)
    draw.line([(1670, 110), (1780, 110)], fill=(RULE_BLUE[0], RULE_BLUE[1], RULE_BLUE[2], 180), width=1)
    draw.text((1810, 88), "DATE:", fill=(RULE_BLUE[0], RULE_BLUE[1], RULE_BLUE[2], 180), font=FONT_NOTE)
    draw.line([(1885, 110), (2000, 110)], fill=(RULE_BLUE[0], RULE_BLUE[1], RULE_BLUE[2], 180), width=1)

    out_path = os.path.join(TEXTURE_DIR, "paper_notebook.png")
    img.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# 2. SEAMLESS HATCHING LUT (1024 x 1024 & 512 x 2048)
# ==============================================================================
def generate_seamless_hatch_tile(tile_size=512, tone=1, seed=100):
    """
    Generates a mathematically seamless hand-drawn ballpoint blue hatching tile.
    Periodic Fourier harmonics guarantee zero edge discontinuity when tiled.
    
    Tone 1: sparse 45-degree diagonal strokes
    Tone 2: dense 45-degree diagonal strokes
    Tone 3: cross-hatch (45 and -45 degrees)
    Tone 4: dense multi-directional hatch with vertical counter-strokes
    """
    np.random.seed(seed + tone * 13)
    N = tile_size

    # Integer Fourier harmonics for exact 2D toroidal periodicity:
    # f(x + N, y) = f(x, y) and f(x, y + N) = f(x, y)
    y_idx, x_idx = np.indices((N, N), dtype=np.float32)
    dx = np.zeros((N, N), dtype=np.float32)
    dy = np.zeros((N, N), dtype=np.float32)
    dw = np.zeros((N, N), dtype=np.float32)

    for _ in range(4):
        u = int(np.random.randint(1, 5))
        v = int(np.random.randint(1, 5))
        amp = float(np.random.uniform(0.6, 1.4))
        phi = float(np.random.uniform(0, 2 * np.pi))
        phase = 2.0 * np.pi * (u * x_idx + v * y_idx) / N + phi
        dx += amp * np.sin(phase)
        dy += amp * np.cos(phase)
        dw += 0.3 * np.sin(phase * 2.0)

    x_perturbed = x_idx + dx
    y_perturbed = y_idx + dy

    # Alpha accumulation buffer [0.0, 1.0]
    ink_mask = np.zeros((N, N), dtype=np.float32)

    def draw_seamless_strokes(coords, spacing, width, intensity=1.0):
        d = np.abs(np.mod(coords + spacing / 2.0, spacing) - spacing / 2.0)
        eff_width = np.clip(width + dw * 0.5, 1.2, 5.0)
        profile = np.exp(-((d / (eff_width * 0.5)) ** 2))
        return profile * intensity

    # 45-degree coordinates: (x - y) mod N
    diag_45 = np.mod(x_perturbed - y_perturbed, N)
    # -45-degree coordinates: (x + y) mod N
    diag_neg45 = np.mod(x_perturbed + y_perturbed, N)
    # Vertical coordinates: x mod N
    vert_coords = np.mod(x_perturbed, N)

    if tone == 1:
        # Sparse 45-degree strokes (spacing = 32px, 16 lines per 512px)
        mask = draw_seamless_strokes(diag_45, spacing=32.0, width=2.4, intensity=0.92)
        ink_mask = np.maximum(ink_mask, mask)
    elif tone == 2:
        # Dense 45-degree strokes (spacing = 16px, 32 lines per 512px)
        mask1 = draw_seamless_strokes(diag_45, spacing=16.0, width=2.6, intensity=0.95)
        ink_mask = np.maximum(ink_mask, mask1)
    elif tone == 3:
        # Cross-hatch: dense 45-degree + -45-degree (spacing = 16px)
        m1 = draw_seamless_strokes(diag_45, spacing=16.0, width=2.5, intensity=0.95)
        m2 = draw_seamless_strokes(diag_neg45, spacing=16.0, width=2.2, intensity=0.88)
        intersection = m1 * m2 * 0.45
        ink_mask = np.clip(m1 + m2 + intersection, 0.0, 1.0)
    elif tone == 4:
        # Dense multi-directional hatch + vertical counter-strokes
        m1 = draw_seamless_strokes(diag_45, spacing=16.0, width=2.7, intensity=0.96)
        m2 = draw_seamless_strokes(diag_neg45, spacing=16.0, width=2.5, intensity=0.92)
        m3 = draw_seamless_strokes(vert_coords, spacing=16.0, width=2.3, intensity=0.85)
        inter = (m1 * m2 + m2 * m3 + m1 * m3) * 0.35
        ink_mask = np.clip(m1 + m2 + m3 + inter, 0.0, 1.0)

    # Micro-skips and paper tooth grain (periodic)
    tooth = np.sin(2 * np.pi * 16 * x_idx / N) * np.cos(2 * np.pi * 16 * y_idx / N) * 0.06
    ink_mask = np.clip(ink_mask + tooth * ink_mask, 0.0, 1.0)

    # Construct RGBA tile
    tile_rgba = np.zeros((N, N, 4), dtype=np.uint8)
    for c in range(3):
        col_curve = INK_DARK[c] * ink_mask + INK_LIGHT[c] * (1.0 - ink_mask)
        tile_rgba[:, :, c] = np.clip(col_curve * ink_mask + PAPER_CREAM[c] * (1.0 - ink_mask), 0, 255).astype(np.uint8)
    
    tile_rgba[:, :, 3] = (ink_mask * 255.0).astype(np.uint8)
    return tile_rgba


def generate_hatch_lut():
    print("Generating hatch_lut.png (1024x1024 atlas) & hatch_lut_512x2048.png...")
    N = 512
    tile1 = generate_seamless_hatch_tile(tile_size=N, tone=1, seed=101)
    tile2 = generate_seamless_hatch_tile(tile_size=N, tone=2, seed=202)
    tile3 = generate_seamless_hatch_tile(tile_size=N, tone=3, seed=303)
    tile4 = generate_seamless_hatch_tile(tile_size=N, tone=4, seed=404)

    # 1. Square Atlas (1024x1024): 2x2 quadrants
    atlas_2x2 = np.zeros((1024, 1024, 4), dtype=np.uint8)
    atlas_2x2[0:512, 0:512] = tile1
    atlas_2x2[0:512, 512:1024] = tile2
    atlas_2x2[512:1024, 0:512] = tile3
    atlas_2x2[512:1024, 512:1024] = tile4

    out_path = os.path.join(TEXTURE_DIR, "hatch_lut.png")
    Image.fromarray(atlas_2x2, mode="RGBA").save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")

    # 2. Vertical Strip Atlas (512x2048): for vertical TAM lookup shaders
    strip = np.zeros((2048, 512, 4), dtype=np.uint8)
    strip[0:512, :] = tile1
    strip[512:1024, :] = tile2
    strip[1024:1536, :] = tile3
    strip[1536:2048, :] = tile4

    strip_path = os.path.join(TEXTURE_DIR, "hatch_lut_512x2048.png")
    Image.fromarray(strip, mode="RGBA").save(strip_path, "PNG", optimize=True)
    print(f"Saved {strip_path} ({os.path.getsize(strip_path):,} bytes)")


# ==============================================================================
# 3. SPIDER-MAN ARMS TEXTURE (1024 x 1024)
# ==============================================================================
def generate_spidey_arm():
    print("Generating spidey_arm_tex.png (1024x1024)...")
    size = 1024
    img = Image.new("RGBA", (size, size), (250, 247, 238, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    random.seed(88)

    # Base suit panels:
    # Upper half (0..480): Red suit gauntlet / forearm
    # Lower half (480..1024): Red suit hand & glove back, with navy blue flex panel on inner wrist
    red_wash = (SUIT_RED[0], SUIT_RED[1], SUIT_RED[2], 240)
    draw.rectangle([0, 0, size, 480], fill=red_wash)

    # Under-arm blue sketch panel (inner arm shadow / flexor)
    blue_panel = (INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 230)
    draw.polygon([(0, 0), (180, 0), (140, 480), (0, 480)], fill=blue_panel)
    draw.polygon([(size, 0), (size - 180, 0), (size - 140, 480), (size, 480)], fill=blue_panel)

    # Glove base
    draw.rectangle([0, 480, size, size], fill=red_wash)

    # Pen-and-ink hatching on blue inner panels
    for offset in range(-size, size, 16):
        draw.line([(offset, 0), (offset + 480, 480)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 160), width=2)
        draw.line([(offset + 480, 0), (offset, 480)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 110), width=2)

    # Forearm web linework (Spidey comic web pattern)
    num_radials = 16
    x_top = np.linspace(180, size - 180, num_radials)
    x_bot = np.linspace(140, size - 140, num_radials)

    for i in range(num_radials):
        pts = []
        for y in range(0, 480, 16):
            t = y / 480.0
            x_interp = (1.0 - t) * x_top[i] + t * x_bot[i]
            wobble = 0.8 * math.sin(y * 0.05 + i) + random.uniform(-0.4, 0.4)
            pts.append((x_interp + wobble, y))
        for j in range(len(pts) - 1):
            draw.line([pts[j], pts[j+1]], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 245), width=3)

    # Scalloped concentric web arcs across forearms
    for y_arc in range(40, 460, 44):
        for i in range(num_radials - 1):
            t = y_arc / 480.0
            x1 = (1.0 - t) * x_top[i] + t * x_bot[i]
            x2 = (1.0 - t) * x_top[i+1] + t * x_bot[i+1]
            xm = (x1 + x2) / 2.0
            ym = y_arc + 14.0
            arc_pts = []
            for step in range(9):
                st = step / 8.0
                px = (1 - st)**2 * x1 + 2 * (1 - st) * st * xm + st**2 * x2
                py = (1 - st)**2 * y_arc + 2 * (1 - st) * st * ym + st**2 * y_arc
                arc_pts.append((px, py))
            for j in range(len(arc_pts) - 1):
                draw.line([arc_pts[j], arc_pts[j+1]], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 235), width=2)

    # Hand-drawn Spider Emblem sketch on gauntlet (centered at x=512, y=240)
    cx, cy = 512, 240
    draw.polygon([
        (cx, cy - 35), (cx + 14, cy - 15), (cx + 8, cy + 5),
        (cx + 18, cy + 30), (cx, cy + 45), (cx - 18, cy + 30),
        (cx - 8, cy + 5), (cx - 14, cy - 15)
    ], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 255))

    leg_defs = [
        [(cx - 8, cy - 15), (cx - 38, cy - 45), (cx - 75, cy - 30)],
        [(cx + 8, cy - 15), (cx + 38, cy - 45), (cx + 75, cy - 30)],
        [(cx - 10, cy - 5), (cx - 52, cy - 18), (cx - 88, cy + 5)],
        [(cx + 10, cy - 5), (cx + 52, cy - 18), (cx + 88, cy + 5)],
        [(cx - 12, cy + 12), (cx - 55, cy + 22), (cx - 80, cy + 65)],
        [(cx + 12, cy + 12), (cx + 55, cy + 22), (cx + 80, cy + 65)],
        [(cx - 8, cy + 28), (cx - 42, cy + 55), (cx - 62, cy + 90)],
        [(cx + 8, cy + 28), (cx + 42, cy + 55), (cx + 62, cy + 90)],
    ]
    for leg in leg_defs:
        draw.line(leg, fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 255), width=4)

    # Wrist cuff & Web-Shooter Unit (y: 470..600)
    draw.rectangle([60, 470, size - 60, 500], fill=(40, 60, 110, 255), outline=(INK_DARK[0], INK_DARK[1], INK_DARK[2]), width=3)
    for sx in range(70, size - 70, 14):
        draw.line([(sx, 485), (sx + 8, 485)], fill=(255, 255, 255, 220), width=2)

    # Silver/Metallic Web-Shooter Housing (y: 505..595)
    shooter_box = [cx - 150, 510, cx + 150, 590]
    draw.rounded_rectangle(shooter_box, radius=12, fill=(185, 195, 205, 255), outline=(INK_DARK[0], INK_DARK[1], INK_DARK[2]), width=4)
    draw.line([(cx - 130, 530), (cx + 130, 530)], fill=(INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 180), width=2)
    draw.line([(cx - 130, 570), (cx + 130, 570)], fill=(INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 180), width=2)
    for rx in [cx - 125, cx - 90, cx + 90, cx + 125]:
        draw.ellipse([rx - 4, 546, rx + 4, 554], fill=(130, 140, 150), outline=INK_DARK, width=2)

    # Central Circular Web Nozzle
    draw.ellipse([cx - 42, 518, cx + 42, 582], fill=(215, 225, 235), outline=INK_DARK, width=4)
    draw.ellipse([cx - 26, 528, cx + 26, 572], fill=(160, 175, 190), outline=INK_DARK, width=3)
    draw.ellipse([cx - 12, 538, cx + 12, 562], fill=INK_DARK)
    for ang in np.linspace(0, 2 * math.pi, 8, endpoint=False):
        nx1 = cx + math.cos(ang) * 16
        ny1 = 550 + math.sin(ang) * 16
        nx2 = cx + math.cos(ang) * 24
        ny2 = 550 + math.sin(ang) * 24
        draw.line([(nx1, ny1), (nx2, ny2)], fill=INK_DARK, width=2)

    # Hand back & Knuckle pads (y: 610..780)
    hand_radials = 10
    hx_top = np.linspace(220, size - 220, hand_radials)
    hx_bot = np.linspace(100, size - 100, hand_radials)
    for i in range(hand_radials):
        draw.line([(hx_top[i], 605), (hx_bot[i], 780)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 230), width=3)

    for y_harc in [650, 710, 765]:
        for i in range(hand_radials - 1):
            t = (y_harc - 605) / 175.0
            x1 = (1 - t) * hx_top[i] + t * hx_bot[i]
            x2 = (1 - t) * hx_top[i+1] + t * hx_bot[i+1]
            xm = (x1 + x2) / 2.0
            ym = y_harc + 12.0
            draw.arc([x1, y_harc - 4, x2, ym + 8], 0, 180, fill=INK_DARK, width=2)

    # 4 Knuckle segment guards
    for kx in np.linspace(240, size - 240, 4):
        kbox = [kx - 35, 755, kx + 35, 785]
        draw.rounded_rectangle(kbox, radius=8, fill=(185, 40, 40, 255), outline=INK_DARK, width=3)
        for off in range(-30, 30, 8):
            draw.line([(kx + off, 758), (kx + off + 10, 782)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 180), width=1)

    # 5 Stitched Finger Pads (y: 790..1015)
    finger_centers = [150, 330, 512, 694, 874]
    finger_widths = [110, 105, 110, 105, 95]

    for fc, fw in zip(finger_centers, finger_widths):
        pad_box = [fc - fw // 2, 805, fc + fw // 2, 1010]
        draw.rounded_rectangle(pad_box, radius=24, fill=(175, 35, 35, 255), outline=INK_DARK, width=3)

        # Perimeter stitching (- - - -)
        stitch_inset = 6
        s_box = [pad_box[0] + stitch_inset, pad_box[1] + stitch_inset, pad_box[2] - stitch_inset, pad_box[3] - stitch_inset]
        for sy in range(s_box[1] + 10, s_box[3] - 10, 12):
            draw.line([(s_box[0], sy), (s_box[0], sy + 6)], fill=(255, 255, 255, 210), width=2)
            draw.line([(s_box[2], sy), (s_box[2], sy + 6)], fill=(255, 255, 255, 210), width=2)

        # Horizontal rubberized grip ribbing
        for gy in range(pad_box[1] + 28, pad_box[3] - 25, 14):
            draw.line([(pad_box[0] + 14, gy), (pad_box[2] - 14, gy)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 210), width=2)
            draw.line([(pad_box[0] + 16, gy), (pad_box[0] + 28, gy + 10)], fill=(INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 130), width=1)

        # Joint flexure creases
        for cy in [865, 935]:
            draw.line([(pad_box[0] + 8, cy), (pad_box[2] - 8, cy)], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 255), width=3)
            draw.line([(pad_box[0] + 12, cy + 3), (pad_box[2] - 12, cy + 3)], fill=(INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 200), width=1)

    out_path = os.path.join(TEXTURE_DIR, "spidey_arm_tex.png")
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# 4. MUZZLE FLASH INK STARBURST (512 x 512)
# ==============================================================================
def generate_muzzle_flash():
    print("Generating muzzle_flash_ink.png (512x512)...")
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = size // 2, size // 2
    random.seed(1337)

    # 1. Primary sharp radiating ink spikes
    num_spikes = 28
    spikes = []
    for i in range(num_spikes):
        angle = (2.0 * math.pi / num_spikes) * i + random.uniform(-0.08, 0.08)
        length = random.uniform(90, 238)
        if i % 4 == 0:
            length = random.uniform(190, 245)
        width = random.uniform(8, 22)
        spikes.append((angle, length, width))

    for angle, length, width in spikes:
        tip_x = cx + math.cos(angle) * length
        tip_y = cy + math.sin(angle) * length
        perp = angle + math.pi / 2.0
        base_x1 = cx + math.cos(perp) * (width / 2.0)
        base_y1 = cy + math.sin(perp) * (width / 2.0)
        base_x2 = cx - math.cos(perp) * (width / 2.0)
        base_y2 = cy - math.sin(perp) * (width / 2.0)

        mid_r = length * 0.45
        mid_x = cx + math.cos(angle) * mid_r + random.uniform(-4, 4)
        mid_y = cy + math.sin(angle) * mid_r + random.uniform(-4, 4)

        spike_poly = [
            (base_x1, base_y1),
            (mid_x + math.cos(perp) * (width * 0.3), mid_y + math.sin(perp) * (width * 0.3)),
            (tip_x, tip_y),
            (mid_x - math.cos(perp) * (width * 0.3), mid_y - math.sin(perp) * (width * 0.3)),
            (base_x2, base_y2)
        ]
        fill_col = (INK_DARK[0], INK_DARK[1], INK_DARK[2], 245)
        draw.polygon(spike_poly, fill=fill_col)

    # 2. Secondary sharp lightning / thorn rays branching off
    for _ in range(18):
        ang = random.uniform(0, 2 * math.pi)
        r0 = random.uniform(60, 130)
        r1 = r0 + random.uniform(40, 90)
        p1 = (cx + math.cos(ang) * r0, cy + math.sin(ang) * r0)
        p2 = (cx + math.cos(ang + random.uniform(-0.15, 0.15)) * r1, cy + math.sin(ang + random.uniform(-0.15, 0.15)) * r1)
        draw.line([p1, p2], fill=(INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], 220), width=random.randint(2, 4))

    # 3. Flying ink droplets and spatters
    for _ in range(45):
        ang = random.uniform(0, 2 * math.pi)
        dist = random.uniform(110, 245)
        px = cx + math.cos(ang) * dist
        py = cy + math.sin(ang) * dist
        r = random.uniform(1.5, 6.0)
        tip = (px + math.cos(ang) * (r * 1.8), py + math.sin(ang) * (r * 1.8))
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 230))
        draw.line([(px, py), tip], fill=(INK_DARK[0], INK_DARK[1], INK_DARK[2], 230), width=int(max(1, r)))

    # 4. Kinetic comic action lines
    for _ in range(30):
        ang = random.uniform(0, 2 * math.pi)
        r_start = random.uniform(150, 190)
        r_end = r_start + random.uniform(25, 55)
        p1 = (cx + math.cos(ang) * r_start, cy + math.sin(ang) * r_start)
        p2 = (cx + math.cos(ang) * r_end, cy + math.sin(ang) * r_end)
        draw.line([p1, p2], fill=(INK_LIGHT[0], INK_LIGHT[1], INK_LIGHT[2], 190), width=random.randint(1, 2))

    # 5. Core starburst explosion
    core_pts = []
    num_core = 20
    for i in range(num_core):
        ang = (2 * math.pi / num_core) * i
        r = random.uniform(35, 65) if i % 2 == 0 else random.uniform(18, 30)
        core_pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    draw.polygon(core_pts, fill=(PAPER_CREAM[0], PAPER_CREAM[1], PAPER_CREAM[2], 255), outline=INK_DARK, width=3)

    out_path = os.path.join(TEXTURE_DIR, "muzzle_flash_ink.png")
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# 5. INK IMPACT ATLAS (1024 x 1024, 4x4 Grid of 16 Decals)
# ==============================================================================
def generate_ink_impact_atlas():
    print("Generating ink_impact_atlas.png (1024x1024, 4x4 Grid)...")
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    random.seed(42)

    cell_size = 256

    def get_cell_center(row, col):
        return col * cell_size + cell_size // 2, row * cell_size + cell_size // 2

    # Decal 0: Organic ink splatter
    cx, cy = get_cell_center(0, 0)
    blot_pts = []
    for i in range(16):
        a = (2 * math.pi / 16) * i
        r = random.uniform(22, 42)
        blot_pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.polygon(blot_pts, fill=INK_DARK)
    for _ in range(12):
        a = random.uniform(0, 2 * math.pi)
        r1 = random.uniform(35, 85)
        p1 = (cx + math.cos(a) * 20, cy + math.sin(a) * 20)
        p2 = (cx + math.cos(a) * r1, cy + math.sin(a) * r1)
        draw.line([p1, p2], fill=INK_DARK, width=random.randint(2, 5))
        dr = random.uniform(2, 5)
        draw.ellipse([p2[0] - dr, p2[1] - dr, p2[0] + dr, p2[1] + dr], fill=INK_DARK)

    # Decal 1: Bullet chip mark
    cx, cy = get_cell_center(0, 1)
    draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=INK_DARK)
    for off in range(-16, 16, 4):
        draw.line([(cx + off, cy - 12), (cx + off + 8, cy + 12)], fill=(180, 200, 235), width=1)
    for _ in range(9):
        ang = random.uniform(0, 2 * math.pi)
        pts = [(cx, cy)]
        curr_r = 18.0
        while curr_r < 95.0:
            curr_r += random.uniform(12, 25)
            ang += random.uniform(-0.35, 0.35)
            pts.append((cx + math.cos(ang) * curr_r, cy + math.sin(ang) * curr_r))
        for j in range(len(pts) - 1):
            draw.line([pts[j], pts[j+1]], fill=INK_DARK, width=random.randint(2, 3))

    # Decal 2: Comic "POW!" style starburst
    cx, cy = get_cell_center(0, 2)
    burst_pts = []
    for i in range(24):
        a = (2 * math.pi / 24) * i
        r = random.uniform(75, 105) if i % 2 == 0 else random.uniform(25, 45)
        burst_pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.polygon(burst_pts, fill=INK_DARK)
    inner_pts = [(cx + (p[0] - cx) * 0.35, cy + (p[1] - cy) * 0.35) for p in burst_pts]
    draw.polygon(inner_pts, fill=(PAPER_CREAM[0], PAPER_CREAM[1], PAPER_CREAM[2], 255))
    for _ in range(16):
        a = random.uniform(0, 2 * math.pi)
        r = random.uniform(85, 115)
        draw.line([(cx + math.cos(a) * r, cy + math.sin(a) * r), (cx + math.cos(a) * (r + 14), cy + math.sin(a) * (r + 14))], fill=INK_BLUE, width=2)

    # Decal 3: Comic "CRACK!" lightning fissure
    cx, cy = get_cell_center(0, 3)
    fissures = [
        [(cx, cy - 90), (cx + 10, cy - 40), (cx - 15, cy), (cx + 5, cy + 45), (cx - 10, cy + 95)],
        [(cx - 15, cy), (cx - 65, cy - 25), (cx - 95, cy - 40)],
        [(cx + 5, cy + 45), (cx + 60, cy + 60), (cx + 85, cy + 85)],
    ]
    for fiss in fissures:
        draw.line(fiss, fill=INK_DARK, width=4)
        for p in fiss[1:-1]:
            draw.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], fill=INK_BLUE)

    # Decal 4: Dripping ink blotch
    cx, cy = get_cell_center(1, 0)
    draw.ellipse([cx - 45, cy - 40, cx + 45, cy + 5], fill=INK_DARK)
    drips = [
        (cx - 25, 45, 6),
        (cx + 2, 75, 8),
        (cx + 28, 55, 5)
    ]
    for dx, drip_len, dw in drips:
        draw.line([(dx, cy), (dx, cy + drip_len)], fill=INK_DARK, width=dw)
        draw.ellipse([dx - dw, cy + drip_len - 2, dx + dw, cy + drip_len + dw * 2], fill=INK_DARK)
        draw.ellipse([dx - 3, cy + drip_len + dw * 2 + 8, dx + 3, cy + drip_len + dw * 2 + 14], fill=INK_DARK)

    # Decal 5: Stippled bullet hole
    cx, cy = get_cell_center(1, 1)
    draw.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=INK_DARK)
    for a in np.linspace(0, 2 * math.pi, 20, endpoint=False):
        r_tooth = random.uniform(28, 48)
        draw.line([(cx + math.cos(a) * 22, cy + math.sin(a) * 22), (cx + math.cos(a) * r_tooth, cy + math.sin(a) * r_tooth)], fill=INK_DARK, width=2)
    for _ in range(60):
        ang = random.uniform(0, 2 * math.pi)
        dist = random.uniform(26, 85)
        draw.point((cx + math.cos(ang) * dist, cy + math.sin(ang) * dist), fill=INK_BLUE)

    # Decal 6: Cross-hatch scrape mark
    cx, cy = get_cell_center(1, 2)
    for off in range(-65, 65, 6):
        draw.line([(cx + off - 30, cy + off - 10), (cx + off + 30, cy + off + 10)], fill=INK_DARK, width=random.randint(2, 3))
        if off % 12 == 0:
            draw.line([(cx + off + 30, cy + off - 20), (cx + off - 30, cy + off + 20)], fill=INK_BLUE, width=2)

    # Decal 7: High-velocity ricochet splash
    cx, cy = get_cell_center(1, 3)
    draw.ellipse([cx - 45, cy + 25, cx - 15, cy + 55], fill=INK_DARK)
    for _ in range(22):
        ang = math.radians(random.uniform(-65, -15))
        dist = random.uniform(40, 125)
        p_end = (cx - 30 + math.cos(ang) * dist, cy + 40 + math.sin(ang) * dist)
        draw.line([(cx - 30, cy + 40), p_end], fill=INK_DARK, width=random.randint(2, 4))
        dr = random.uniform(2, 5)
        draw.ellipse([p_end[0] - dr, p_end[1] - dr, p_end[0] + dr, p_end[1] + dr], fill=INK_BLUE)

    # Decal 8: Concentric shockwave rings
    cx, cy = get_cell_center(2, 0)
    for rad in [20, 42, 68, 92]:
        ring_pts = []
        for a in np.linspace(0, 2 * math.pi, 36, endpoint=False):
            r_wob = rad + random.uniform(-2.5, 2.5)
            ring_pts.append((cx + math.cos(a) * r_wob, cy + math.sin(a) * r_wob))
        for j in range(len(ring_pts)):
            draw.line([ring_pts[j], ring_pts[(j+1)%len(ring_pts)]], fill=INK_DARK, width=2)
    draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=INK_DARK)

    # Decal 9: Heavy vertical teardrop drip
    cx, cy = get_cell_center(2, 1)
    draw.line([(cx, cy - 85), (cx, cy + 50)], fill=INK_DARK, width=8)
    draw.ellipse([cx - 18, cy + 40, cx + 18, cy + 76], fill=INK_DARK)
    draw.ellipse([cx - 6, cy + 86, cx + 6, cy + 98], fill=INK_DARK)
    draw.ellipse([cx - 3, cy + 104, cx + 3, cy + 110], fill=INK_BLUE)

    # Decal 10: Torn notebook paper puncture
    cx, cy = get_cell_center(2, 2)
    flaps = [
        [(cx, cy), (cx - 50, cy - 65), (cx + 40, cy - 75)],
        [(cx, cy), (cx + 65, cy - 20), (cx + 55, cy + 60)],
        [(cx, cy), (cx - 45, cy + 65), (cx - 70, cy - 10)],
    ]
    for flap in flaps:
        draw.polygon(flap, fill=(PAPER_CREAM[0], PAPER_CREAM[1], PAPER_CREAM[2], 255), outline=INK_DARK, width=3)
    draw.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=INK_DARK)
    for off in range(-12, 12, 3):
        draw.line([(cx + off, cy - 12), (cx + off, cy + 12)], fill=INK_LIGHT, width=1)

    # Decal 11: Comic "BAM" star spark
    cx, cy = get_cell_center(2, 3)
    bam_pts = []
    for i in range(16):
        a = (2 * math.pi / 16) * i
        r = random.uniform(80, 105) if i % 2 == 0 else random.uniform(30, 45)
        bam_pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.polygon(bam_pts, fill=INK_DARK)
    draw.polygon([(cx + (p[0]-cx)*0.4, cy + (p[1]-cy)*0.4) for p in bam_pts], fill=(222, 50, 50, 240))

    # Decal 12: Ring splash impact
    cx, cy = get_cell_center(3, 0)
    draw.ellipse([cx - 45, cy - 45, cx + 45, cy + 45], outline=INK_DARK, width=6)
    draw.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=INK_DARK)
    for a in np.linspace(0, 2 * math.pi, 14, endpoint=False):
        sp_x = cx + math.cos(a) * 62
        sp_y = cy + math.sin(a) * 62
        draw.ellipse([sp_x - 4, sp_y - 4, sp_x + 4, sp_y + 4], fill=INK_DARK)
        draw.line([(cx + math.cos(a) * 45, cy + math.sin(a) * 45), (sp_x, sp_y)], fill=INK_DARK, width=2)

    # Decal 13: Triple claw gouge
    cx, cy = get_cell_center(3, 1)
    for i, off in enumerate([-35, 0, 35]):
        p1 = (cx + off - 25, cy - 75)
        p2 = (cx + off + 25, cy + 75)
        draw.line([p1, p2], fill=INK_DARK, width=6)
        for t in np.linspace(0.1, 0.9, 8):
            lx = (1 - t) * p1[0] + t * p2[0]
            ly = (1 - t) * p1[1] + t * p2[1]
            draw.line([(lx - 12, ly - 6), (lx + 12, ly + 6)], fill=INK_BLUE, width=2)

    # Decal 14: Fine buckshot spray
    cx, cy = get_cell_center(3, 2)
    for _ in range(85):
        ang = random.uniform(0, 2 * math.pi)
        dist = random.uniform(8, 95)
        rad = random.uniform(1.2, 4.5)
        px = cx + math.cos(ang) * dist
        py = cy + math.sin(ang) * dist
        draw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=INK_DARK)

    # Decal 15: Spider-Man Web Impact Splat
    cx, cy = get_cell_center(3, 3)
    draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=INK_DARK)
    num_spokes = 10
    spoke_angles = np.linspace(0, 2 * math.pi, num_spokes, endpoint=False)
    for a in spoke_angles:
        wx = cx + math.cos(a) * 98
        wy = cy + math.sin(a) * 98
        draw.line([(cx, cy), (wx, wy)], fill=INK_DARK, width=3)
        draw.ellipse([wx - 4, wy - 4, wx + 4, wy + 4], fill=INK_DARK)

    for wrad in [32, 58, 82]:
        for i in range(num_spokes):
            a1 = spoke_angles[i]
            a2 = spoke_angles[(i + 1) % num_spokes]
            p1 = (cx + math.cos(a1) * wrad, cy + math.sin(a1) * wrad)
            p2 = (cx + math.cos(a2) * wrad, cy + math.sin(a2) * wrad)
            mid_a = (a1 + a2) / 2.0
            pm = (cx + math.cos(mid_a) * (wrad * 0.82), cy + math.sin(mid_a) * (wrad * 0.82))
            draw.line([p1, pm], fill=INK_DARK, width=2)
            draw.line([pm, p2], fill=INK_DARK, width=2)

    out_path = os.path.join(TEXTURE_DIR, "ink_impact_atlas.png")
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# 6. SNIPER RETICLE BLUEPRINT (1024 x 1024)
# ==============================================================================
def generate_sniper_reticle():
    print("Generating sniper_reticle.png (1024x1024)...")
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = size // 2, size // 2
    reticle_blue = (24, 41, 122, 255)

    # 1. Circular Scope Outer Vignette & Ring
    outer_r = 450
    draw.ellipse([cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r], outline=reticle_blue, width=5)
    draw.ellipse([cx - outer_r + 6, cy - outer_r + 6, cx + outer_r - 6, cy + outer_r - 6], outline=reticle_blue, width=2)

    # Compass / Azimuth degree marks every 5° and 10°
    for deg in range(0, 360, 5):
        rad = math.radians(deg)
        tick_len = 16 if deg % 10 == 0 else 8
        p1 = (cx + math.cos(rad) * (outer_r - 8), cy + math.sin(rad) * (outer_r - 8))
        p2 = (cx + math.cos(rad) * (outer_r - 8 - tick_len), cy + math.sin(rad) * (outer_r - 8 - tick_len))
        draw.line([p1, p2], fill=reticle_blue, width=2 if deg % 10 == 0 else 1)

    draw.text((cx - 10, cy - outer_r + 28), "0°", fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((cx + outer_r - 45, cy - 8), "90°", fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((cx - 16, cy + outer_r - 42), "180°", fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((cx - outer_r + 20, cy - 8), "270°", fill=reticle_blue, font=FONT_NOTE_SM)

    # 2. Main Mil-Dot Crosshairs with Center Gap
    gap = 14
    draw.line([(cx - outer_r + 40, cy), (cx - gap, cy)], fill=reticle_blue, width=3)
    draw.line([(cx + gap, cy), (cx + outer_r - 40, cy)], fill=reticle_blue, width=3)
    draw.line([(cx, cy - outer_r + 40), (cx, cy - gap)], fill=reticle_blue, width=3)
    draw.line([(cx, cy + gap), (cx, cy + outer_r - 40)], fill=reticle_blue, width=3)

    # Precision center aiming dot & ring
    draw.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], outline=reticle_blue, width=2)
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=reticle_blue)

    # Mil-Dots and sub-graduation ticks along axes (spaced every 24px)
    for dist in range(32, outer_r - 55, 24):
        for sx in [-1, 1]:
            draw.ellipse([cx + sx * dist - 2, cy - 2, cx + sx * dist + 2, cy + 2], fill=reticle_blue)
            tick_h = 10 if (dist // 24) % 4 == 0 else 5
            draw.line([(cx + sx * dist, cy - tick_h), (cx + sx * dist, cy + tick_h)], fill=reticle_blue, width=2)
            draw.ellipse([cx - 2, cy + sx * dist - 2, cx + 2, cy + sx * dist + 2], fill=reticle_blue)
            draw.line([(cx - tick_h, cy + sx * dist), (cx + tick_h, cy + sx * dist)], fill=reticle_blue, width=2)

    # 3. Stadiametric Rangefinder (Lower-Left Quadrant)
    rf_base_y = cy + 220
    rf_start_x = cx - 340
    rf_end_x = cx - 110
    draw.line([(rf_start_x, rf_base_y), (rf_end_x, rf_base_y)], fill=reticle_blue, width=3)
    curve_pts = []
    for x in range(rf_start_x, rf_end_x, 8):
        t = (x - rf_start_x) / (rf_end_x - rf_start_x)
        h = 110.0 / (1.0 + t * 2.5)
        curve_pts.append((x, rf_base_y - h))
    for j in range(len(curve_pts) - 1):
        draw.line([curve_pts[j], curve_pts[j+1]], fill=reticle_blue, width=3)

    rf_labels = [("2", 0.08), ("4", 0.32), ("6", 0.58), ("8", 0.82), ("10", 0.96)]
    for lbl, t in rf_labels:
        lx = rf_start_x + t * (rf_end_x - rf_start_x)
        lh = 110.0 / (1.0 + t * 2.5)
        draw.line([(lx, rf_base_y), (lx, rf_base_y - lh)], fill=reticle_blue, width=2)
        draw.text((lx - 6, rf_base_y + 8), lbl, fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((rf_start_x, rf_base_y + 30), "STADIAMETRIC 1.7m", fill=reticle_blue, font=FONT_NOTE_SM)

    # 4. Bullet Drop Compensation (BDC) Ladder
    bdc_marks = [
        (560, 40, "200"),
        (620, 60, "300"),
        (690, 85, "400"),
        (770, 115, "500"),
        (860, 150, "600"),
    ]
    for bdc_y, bdc_w, range_str in bdc_marks:
        draw.line([(cx - bdc_w // 2, bdc_y), (cx + bdc_w // 2, bdc_y)], fill=reticle_blue, width=3)
        draw.line([(cx - 6, bdc_y - 5), (cx, bdc_y), (cx + 6, bdc_y - 5)], fill=reticle_blue, width=2)
        draw.text((cx + bdc_w // 2 + 10, bdc_y - 8), range_str, fill=reticle_blue, font=FONT_NOTE_SM)
        draw.ellipse([cx - bdc_w // 2 - 18, bdc_y - 3, cx - bdc_w // 2 - 12, bdc_y + 3], fill=reticle_blue)
        draw.ellipse([cx + bdc_w // 2 + 38, bdc_y - 3, cx + bdc_w // 2 + 44, bdc_y + 3], fill=reticle_blue)

    # 5. Technical Blueprint Drafting Annotations
    draw.text((cx + 140, cy + 180), "SYSTEM: 0.1 MRAD", fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((cx + 140, cy + 205), "RETICLE: BDC MIL-DOT v3.2", fill=reticle_blue, font=FONT_NOTE_SM)
    draw.text((cx + 140, cy + 230), "CAL: .50 BMG / INK-CORE", fill=reticle_blue, font=FONT_NOTE_SM)

    # Blueprint corner brackets [  ]
    bracket_r = 380
    b_len = 35
    for sx, sy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        bx = cx + sx * bracket_r
        by = cy + sy * bracket_r
        draw.line([(bx, by), (bx - sx * b_len, by)], fill=reticle_blue, width=3)
        draw.line([(bx, by), (bx, by - sy * b_len)], fill=reticle_blue, width=3)

    out_path = os.path.join(TEXTURE_DIR, "sniper_reticle.png")
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# 7. SPEED LINES RADIAL BLUR (1024 x 1024)
# ==============================================================================
def generate_speed_lines():
    print("Generating speed_lines.png (1024x1024)...")
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = size // 2, size // 2
    random.seed(999)

    num_strokes = 260
    inner_radius = 240
    outer_radius = 730

    for i in range(num_strokes):
        base_angle = (2.0 * math.pi / num_strokes) * i + random.uniform(-0.02, 0.02)
        r_start = inner_radius + random.uniform(0, 160)
        r_end = outer_radius + random.uniform(0, 80)

        x1 = cx + math.cos(base_angle) * r_start
        y1 = cy + math.sin(base_angle) * r_start

        drift_angle = base_angle + random.uniform(-0.015, 0.015)
        x2 = cx + math.cos(drift_angle) * r_end
        y2 = cy + math.sin(drift_angle) * r_end

        alpha = random.randint(130, 245)
        color = (INK_BLUE[0], INK_BLUE[1], INK_BLUE[2], alpha)
        width = random.choice([2, 3, 3, 4, 5])

        draw.line([(x1, y1), (x2, y2)], fill=color, width=width)

        if random.random() < 0.35 and r_start > inner_radius + 60:
            off_ang = base_angle + random.uniform(-0.025, 0.025)
            fx1 = cx + math.cos(off_ang) * (r_start + 40)
            fy1 = cy + math.sin(off_ang) * (r_start + 40)
            fx2 = cx + math.cos(off_ang) * (r_end - 20)
            fy2 = cy + math.sin(off_ang) * (r_end - 20)
            draw.line([(fx1, fy1), (fx2, fy2)], fill=(INK_LIGHT[0], INK_LIGHT[1], INK_LIGHT[2], alpha // 2), width=1)

    out_path = os.path.join(TEXTURE_DIR, "speed_lines.png")
    img.save(out_path, "PNG", optimize=True)
    print(f"Saved {out_path} ({os.path.getsize(out_path):,} bytes)")


# ==============================================================================
# MAIN EXECUTION & VERIFICATION
# ==============================================================================
def main():
    print("=" * 70)
    print("STARTING PROCEDURAL BLUE INK & NOTEBOOK PAPER TEXTURE GENERATION")
    print("=" * 70)

    generate_paper_notebook()
    generate_hatch_lut()
    generate_spidey_arm()
    generate_muzzle_flash()
    generate_ink_impact_atlas()
    generate_sniper_reticle()
    generate_speed_lines()

    print("\n" + "=" * 70)
    print("VERIFICATION OF GENERATED TEXTURES:")
    print("=" * 70)
    expected_files = [
        ("paper_notebook.png", (2048, 2048)),
        ("hatch_lut.png", (1024, 1024)),
        ("hatch_lut_512x2048.png", (512, 2048)),
        ("spidey_arm_tex.png", (1024, 1024)),
        ("muzzle_flash_ink.png", (512, 512)),
        ("ink_impact_atlas.png", (1024, 1024)),
        ("sniper_reticle.png", (1024, 1024)),
        ("speed_lines.png", (1024, 1024)),
    ]

    all_ok = True
    for fname, exp_dims in expected_files:
        fpath = os.path.join(TEXTURE_DIR, fname)
        if not os.path.exists(fpath):
            print(f"❌ MISSING: {fname}")
            all_ok = False
            continue
        size_bytes = os.path.getsize(fpath)
        with Image.open(fpath) as im:
            actual_dims = im.size
            mode = im.mode
            if actual_dims == exp_dims:
                status = f"✅ OK: {fname:<24} | Dimensions: {actual_dims[0]:>4}x{actual_dims[1]:<4} | Mode: {mode:<4} | Size: {size_bytes:>10,} bytes"
            else:
                status = f"⚠️ MISMATCH: {fname} | Expected: {exp_dims} | Actual: {actual_dims}"
                all_ok = False
            print(status)

    if all_ok:
        print("\nAll textures successfully generated and verified!")
    else:
        print("\nSome textures failed verification!")
        sys.exit(1)


if __name__ == "__main__":
    main()
