#!/usr/bin/env python3
"""
Multi-View Projective UV Baking Pipeline for MiniMax H3 Turntables
Pit Fighter: Old Sorrow — Issue #71 (The Gallery — Private Box Chair)

Implements Option A (Multi-View Projective UV Baking):
  1. Loads 3D model geometry (optimized Victorian armchair with 16-check socket alignment).
  2. Generates conformal, non-overlapping UV atlas via xatlas.
  3. Projects K evenly spaced keyframes from the 768x768 MiniMax H3 continuous turntable.
  4. Computes per-texel normal-weighted camera blending with backface culling & bilateral symmetry.
  5. Performs edge dilation to eliminate texture seam filtering artifacts.
  6. Exports production-ready binary GLB with embedded PBR textures.
"""

import os
import sys
import time
import json
import numpy as np
import cv2
from PIL import Image
import trimesh
import xatlas

# Project paths
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
COMFY_OUTPUT = r"C:\Users\dimit\Documents\comfy\ComfyUI_windows_portable_amd\ComfyUI\output"
H3_BASE_IDX = 2357
TOTAL_H3_FRAMES = 124

def load_h3_keyframe(frame_idx):
    """Load high-res 768x768 PNG from ComfyUI output, or fall back to webp frame."""
    fn = os.path.join(COMFY_OUTPUT, f"h3_turntable_frames_{H3_BASE_IDX + frame_idx:05d}_.png")
    if os.path.exists(fn):
        return Image.open(fn).convert("RGB")
    
    # Fallback to webp
    webp_path = os.path.join(ROOT, "public", "tex", "props", "h3_chair_turntable.webp")
    from PIL import ImageSequence
    im = Image.open(webp_path)
    frames = list(ImageSequence.Iterator(im))
    mapped_idx = int(frame_idx * (len(frames) - 1) / (TOTAL_H3_FRAMES - 1))
    return frames[mapped_idx].convert("RGB").resize((768, 768), Image.Resampling.LANCZOS)

def get_camera_matrices(phi_deg, elevation_deg=13.0, distance=1.32, fov_deg=43.0, img_size=(768, 768)):
    """Compute camera extrinsic and projection matrices for an orbital turntable camera."""
    W, H = img_size
    phi = np.radians(phi_deg)
    theta_elev = np.radians(elevation_deg)
    fov = np.radians(fov_deg)
    
    T = np.array([0.0, 0.015, 0.0])  # Target center
    C = np.array([
        distance * np.sin(phi) * np.cos(theta_elev),
        T[1] + distance * np.sin(theta_elev),
        distance * np.cos(phi) * np.cos(theta_elev)
    ])
    
    f = (T - C) / np.linalg.norm(T - C)
    up = np.array([0.0, 1.0, 0.0])
    r = np.cross(f, up)
    r = r / np.linalg.norm(r)
    u = np.cross(r, f)
    
    fx = (W / 2.0) / np.tan(fov / 2.0)
    fy = fx
    cx, cy = W / 2.0, H / 2.0
    
    return {
        "C": C,
        "f": f,
        "r": r,
        "u": u,
        "fx": fx,
        "fy": fy,
        "cx": cx,
        "cy": cy,
        "W": W,
        "H": H
    }

def rasterize_uv_maps(vertices, normals, faces, uvs, tex_size=1024):
    """Rasterize 3D positions and normals into UV space buffers."""
    pos_map = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
    norm_map = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
    mask_map = np.zeros((tex_size, tex_size), dtype=bool)
    
    uv_px = np.zeros_like(uvs)
    uv_px[:, 0] = uvs[:, 0] * (tex_size - 1)
    uv_px[:, 1] = (1.0 - uvs[:, 1]) * (tex_size - 1)
    
    for f in faces:
        tri_uv = uv_px[f].astype(np.int32)
        min_x, min_y = np.maximum(tri_uv.min(axis=0), 0)
        max_x, max_y = np.minimum(tri_uv.max(axis=0), tex_size - 1)
        if min_x >= max_x or min_y >= max_y:
            continue
        
        tri_mask = np.zeros((max_y - min_y + 1, max_x - min_x + 1), dtype=np.uint8)
        cv2.fillConvexPoly(tri_mask, tri_uv - [min_x, min_y], 1)
        
        ys, xs = np.where(tri_mask == 1)
        if len(xs) == 0:
            continue
        
        pts = np.stack([xs + min_x, ys + min_y], axis=1)
        
        p0, p1, p2 = uv_px[f[0]], uv_px[f[1]], uv_px[f[2]]
        denom = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1])
        if abs(denom) < 1e-7:
            continue
        
        w0 = ((p1[1] - p2[1]) * (pts[:, 0] - p2[0]) + (p2[0] - p1[0]) * (pts[:, 1] - p2[1])) / denom
        w1 = ((p2[1] - p0[1]) * (pts[:, 0] - p2[0]) + (p0[0] - p2[0]) * (pts[:, 1] - p2[1])) / denom
        w2 = 1.0 - w0 - w1
        
        v0, v1, v2 = vertices[f[0]], vertices[f[1]], vertices[f[2]]
        n0, n1, n2 = normals[f[0]], normals[f[1]], normals[f[2]]
        
        pos = w0[:, None] * v0 + w1[:, None] * v1 + w2[:, None] * v2
        norm = w0[:, None] * n0 + w1[:, None] * n1 + w2[:, None] * n2
        
        # Normalize vectors
        norm_len = np.linalg.norm(norm, axis=-1, keepdims=True)
        norm = norm / np.maximum(norm_len, 1e-6)
        
        pos_map[ys + min_y, xs + min_x] = pos
        norm_map[ys + min_y, xs + min_x] = norm
        mask_map[ys + min_y, xs + min_x] = True
        
    return pos_map, norm_map, mask_map

def bake_multiview(pos_map, norm_map, mask_map, keyframe_samples, tex_size=1024):
    """
    Projectively bake K keyframes into the UV texture map using Best-View Selection
    with smooth seam transitions to prevent parallax ghosting.
    """
    accum_color = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
    accum_weight = np.zeros((tex_size, tex_size), dtype=np.float32)
    best_weight = np.zeros((tex_size, tex_size), dtype=np.float32)
    best_color = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
    
    valid_ys, valid_xs = np.where(mask_map)
    P = pos_map[valid_ys, valid_xs]      # (N, 3)
    N = norm_map[valid_ys, valid_xs]     # (N, 3)
    
    for sample in keyframe_samples:
        img_arr = np.array(sample["img"]).astype(np.float32)
        cam = get_camera_matrices(sample["angle"], img_size=(img_arr.shape[1], img_arr.shape[0]))
        
        # 1. Direct Projection
        P_diff = P - cam["C"]
        dist = np.linalg.norm(P_diff, axis=-1, keepdims=True)
        view_dir = -P_diff / np.maximum(dist, 1e-6)
        cos_alpha = np.sum(N * view_dir, axis=-1)
        
        X_cam = np.dot(P_diff, cam["r"])
        Y_cam = np.dot(P_diff, -cam["u"])
        Z_cam = np.dot(P_diff, cam["f"])
        
        valid_cam = (Z_cam > 0.1) & (cos_alpha > 0.05)
        
        px = cam["fx"] * (X_cam / np.maximum(Z_cam, 1e-6)) + cam["cx"]
        py = cam["fy"] * (Y_cam / np.maximum(Z_cam, 1e-6)) + cam["cy"]
        
        in_bounds = valid_cam & (px >= 2) & (px < cam["W"] - 3) & (py >= 2) & (py < cam["H"] - 3)
        
        if np.any(in_bounds):
            idx_in = np.where(in_bounds)[0]
            sampled_px = px[idx_in]
            sampled_py = py[idx_in]
            
            # Depth buffer occlusion testing: prevent foreground geometry from bleeding onto background
            depth_buffer = np.full((cam["H"], cam["W"]), 1e5, dtype=np.float32)
            ipx = np.clip(np.round(sampled_px).astype(int), 0, cam["W"] - 1)
            ipy = np.clip(np.round(sampled_py).astype(int), 0, cam["H"] - 1)
            np.minimum.at(depth_buffer, (ipy, ipx), Z_cam[idx_in])
            
            # 3x3 min filter to close small sampling gaps
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            depth_min = cv2.erode(depth_buffer, kernel)
            
            # Visible if surface point is within 2.5 cm of closest surface at this pixel
            visible = Z_cam[idx_in] <= depth_min[ipy, ipx] + 0.025
            
            x0 = sampled_px.astype(int)
            y0 = sampled_py.astype(int)
            x1 = x0 + 1
            y1 = y0 + 1
            wx = sampled_px - x0
            wy = sampled_py - y0
            
            c00 = img_arr[y0, x0]
            c10 = img_arr[y0, x1]
            c01 = img_arr[y1, x0]
            c11 = img_arr[y1, x1]
            
            sampled_c = (
                (1 - wx)[:, None] * (1 - wy)[:, None] * c00 +
                wx[:, None] * (1 - wy)[:, None] * c10 +
                (1 - wx)[:, None] * wy[:, None] * c01 +
                wx[:, None] * wy[:, None] * c11
            )
            
            not_bg = ~((sampled_c[:, 0] > 242) & (sampled_c[:, 1] > 242) & (sampled_c[:, 2] > 242))
            
            # Cardinal anchor bonus: canonical front (0°) and rear (180°) views dominate their respective panels
            is_front_cam = abs(sample["angle"] - 0.0) < 1.0 or abs(sample["angle"] - 360.0) < 1.0
            is_rear_cam = abs(sample["angle"] - 180.0) < 1.0
            
            anchor_mult = np.ones(len(idx_in), dtype=np.float32)
            if is_rear_cam:
                rear_facing = N[idx_in, 2] < -0.4
                anchor_mult[rear_facing] = 3.0
            elif is_front_cam:
                front_facing = N[idx_in, 2] > 0.4
                anchor_mult[front_facing] = 3.0
                
            weight = (np.maximum(cos_alpha[idx_in], 0.0) ** 2.0) * not_bg * visible * anchor_mult
            
            cur_y = valid_ys[idx_in]
            cur_x = valid_xs[idx_in]
            
            # Best-view update: keep the single best projection per texel
            better = weight > best_weight[cur_y, cur_x]
            if np.any(better):
                b_idx = np.where(better)[0]
                best_weight[cur_y[b_idx], cur_x[b_idx]] = weight[b_idx]
                best_color[cur_y[b_idx], cur_x[b_idx]] = sampled_c[b_idx]

    # Final blend
    has_samples = best_weight > 1e-4
    final_rgb = np.zeros((tex_size, tex_size, 3), dtype=np.uint8)
    
    # Fallback Victorian palette for unprojected crevices
    velvet_fallback = np.array([138, 18, 30], dtype=np.float32)
    final_rgb[mask_map] = velvet_fallback
    final_rgb[has_samples] = np.clip(best_color[has_samples], 0, 255).astype(np.uint8)
    
    # Texture Dilation pass (expand UV islands by 6 pixels)
    dilated_rgb = final_rgb.copy()
    valid_mask = has_samples.astype(np.uint8)
    
    for _ in range(6):
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        expanded_mask = cv2.dilate(valid_mask, kernel)
        border_pixels = (expanded_mask == 1) & (valid_mask == 0)
        if not np.any(border_pixels):
            break
        blurred = cv2.blur(dilated_rgb, (3, 3))
        dilated_rgb[border_pixels] = blurred[border_pixels]
        valid_mask = expanded_mask
        
    return dilated_rgb

def generate_keyframe_samples(k_samples):
    """
    Generate K evenly spaced keyframe samples covering 360 degrees around the chair.
    For angles in [0, 180]:
      Samples the continuous MiniMax H3 turntable video where Frame 0 is Front (0°)
      and Frame 93 is Rear (180°).
    For angles in (180, 360):
      Uses bilateral symmetry across the X=0 sagittal plane:
      the view from azimuth theta is the horizontal mirror of the view from (360 - theta).
    """
    samples = []
    # K angles evenly spaced around 360 degrees: 0, 360/K, 2*(360/K), ...
    angles = np.linspace(0.0, 360.0, k_samples, endpoint=False)
    
    for angle in angles:
        if angle <= 180.0:
            frame_idx = int(round(angle * (93.0 / 180.0)))
            img = load_h3_keyframe(frame_idx)
            is_flipped = False
        else:
            sym_angle = 360.0 - angle
            frame_idx = int(round(sym_angle * (93.0 / 180.0)))
            img = load_h3_keyframe(frame_idx).transpose(Image.FLIP_LEFT_RIGHT)
            is_flipped = True
            
        samples.append({
            "idx": frame_idx,
            "angle": float(angle),
            "img": img,
            "is_flipped": is_flipped
        })
    return samples

def run_pipeline(k_samples_list=(8, 16, 32)):
    """Run projective UV baking for 8, 16, and 32 keyframe samples."""
    print("=" * 70)
    print("Multi-View Projective UV Baking Pipeline — Issue #71")
    print(f"Target asset: weapon_chair | Sampling counts: {k_samples_list}")
    print("=" * 70)
    
    # 1. Load aligned Victorian chair model
    from build_victorian_chair_mesh import create_victorian_chair
    parts, combined = create_victorian_chair()
    mesh = combined
    
    # Dynamically compute part ranges
    part_ranges = []
    cur_f = 0
    for name, p_mesh in parts:
        part_ranges.append((name, cur_f, cur_f + len(p_mesh.faces)))
        cur_f += len(p_mesh.faces)
    print(f"[Parts] Dynamic submesh ranges: {part_ranges}")
    
    print(f"[Model] Vertices: {len(mesh.vertices)}, Faces: {len(mesh.faces)}")
    print(f"[Model] Extents: {(mesh.bounds[1] - mesh.bounds[0]) * 100} cm")
    
    # 2. Conformal UV parameterization via xatlas
    t0 = time.time()
    vmapping, indices, uvs = xatlas.parametrize(mesh.vertices, mesh.faces)
    vertices = mesh.vertices[vmapping]
    normals = mesh.vertex_normals[vmapping]
    faces = indices
    print(f"[xatlas] Parameterized in {time.time() - t0:.2f}s: {len(vertices)} verts, {len(faces)} faces")
    
    # 3. Rasterize UV space positions & normals
    t1 = time.time()
    pos_map, norm_map, mask_map = rasterize_uv_maps(vertices, normals, faces, uvs, tex_size=1024)
    print(f"[Rasterizer] Rendered {mask_map.sum()} UV texels in {time.time() - t1:.2f}s")
    
    results = {}
    
    for k in k_samples_list:
        print(f"\n--- [Option A] Baking with {k} Keyframes ---")
        t_bake = time.time()
        samples = generate_keyframe_samples(k)
        print(f"  Loaded {len(samples)} keyframe images from MiniMax H3")
        
        baked_tex = bake_multiview(pos_map, norm_map, mask_map, samples, tex_size=1024)
        bake_duration = time.time() - t_bake
        print(f"  Baking completed in {bake_duration:.2f}s")
        
        # Save baked texture image
        tex_path = os.path.join(ROOT, "public", "tex", "props", f"weapon_chair_baked_{k}k.png")
        os.makedirs(os.path.dirname(tex_path), exist_ok=True)
        Image.fromarray(baked_tex).save(tex_path, optimize=True)
        print(f"  Saved texture: {tex_path} ({os.path.getsize(tex_path) / 1024:.1f} KB)")
        
        # Construct production GLB with baked PBR material
        # Create trimesh with TextureVisuals
        tex_img = Image.fromarray(baked_tex)
        material = trimesh.visual.material.PBRMaterial(
            name=f"Victorian_Chair_Baked_{k}k",
            baseColorTexture=tex_img,
            roughnessFactor=0.6,
            metallicFactor=0.3
        )
        
        baked_mesh = trimesh.Trimesh(
            vertices=vertices,
            faces=faces,
            visual=trimesh.visual.TextureVisuals(uv=uvs, material=material),
            process=False
        )
        
        # Preserve manifest-required node structure with proper submeshes
        scene_dict = {}
        for part_name, start_f, end_f in part_ranges:
            sub = baked_mesh.submesh([range(start_f, end_f)], append=True)
            sub.metadata["name"] = part_name
            scene_dict[part_name] = sub
            
        export_scene = trimesh.Scene(scene_dict)
        
        # Single consolidated mesh GLB
        glb_path = os.path.join(ROOT, "public", "models", "props", f"weapon_chair_baked_{k}k.glb")
        
        # Trimesh export
        glb_data = trimesh.exchange.gltf.export_glb(export_scene)
        with open(glb_path, "wb") as f:
            f.write(glb_data)
            
        file_size_kb = len(glb_data) / 1024.0
        print(f"  Exported GLB: {glb_path} ({file_size_kb:.1f} KB, budget <= 1500 KB)")
        
        results[k] = {
            "texture": tex_path,
            "glb": glb_path,
            "size_kb": file_size_kb,
            "duration_s": bake_duration,
            "triangles": len(faces)
        }
        
    return results

if __name__ == "__main__":
    run_pipeline([8, 16, 32])
