import numpy as np
import trimesh

def vertical_cylinder(radius, height, sections=16):
    """Create a cylinder standing vertically along the Y-axis."""
    c = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    rot = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
    c.apply_transform(rot)
    return c

def create_oval_backrest(rx=0.19, ry=0.21, thickness=0.045, n_theta=32):
    """
    Create an authentic Victorian upholstered balloon-back oval backrest:
    - Slightly tapered balloon-back silhouette (wider near top crown, tapered at waist).
    - Front face: domed cushion facing +Z with normals pointing forward.
    - Rear face: planar/gentle panel facing -Z with normals pointing backward.
    - Perimeter: thin carved wooden frame joining front to rear.
    """
    thetas = np.linspace(0, 2 * np.pi, n_theta, endpoint=False)
    ys = ry * np.sin(thetas)
    # Victorian balloon-back taper: wider at top crown, narrower at lower waist
    taper = 1.0 + 0.10 * (ys / ry)
    xs = rx * np.cos(thetas) * taper
    
    # Front vertices (slightly domed forward +Z)
    vf = np.column_stack([xs, ys, np.zeros_like(xs) + thickness / 2.0])
    vf_center = np.array([[0.0, 0.0, thickness / 2.0 + 0.015]])
    
    # Rear vertices (flat/gentle backward -Z for crest plaque)
    vb = np.column_stack([xs, ys, np.zeros_like(xs) - thickness / 2.0])
    vb_center = np.array([[0.0, 0.0, -thickness / 2.0 - 0.005]])
    
    verts = np.vstack([vf_center, vf, vb_center, vb])
    faces = []
    
    # Front fan (normals point +Z)
    for i in range(n_theta):
        i_next = (i + 1) % n_theta
        faces.append([0, 1 + i, 1 + i_next])
        
    # Rear fan (normals point -Z)
    rear_c = 1 + n_theta
    rear_start = rear_c + 1
    for i in range(n_theta):
        i_next = (i + 1) % n_theta
        faces.append([rear_c, rear_start + i_next, rear_start + i])
        
    # Rim quads
    for i in range(n_theta):
        i_next = (i + 1) % n_theta
        f_i = 1 + i
        f_next = 1 + i_next
        b_i = rear_start + i
        b_next = rear_start + i_next
        faces.append([f_i, b_i, b_next])
        faces.append([f_i, b_next, f_next])
        
    mesh = trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=True)
    return mesh

def create_victorian_chair():
    parts = []
    
    # -------------------------------------------------------------------------
    # 1. Seat Cushion and Apron (Handle_Grip_Seat)
    # Standing vertically along Y, centered at y = 0.0
    # -------------------------------------------------------------------------
    seat = vertical_cylinder(radius=0.22, height=0.08, sections=32)
    # Shield shape: slightly wider than deep
    seat.apply_scale([1.0, 1.0, 0.95])
    seat.apply_translation([0.0, 0.0, 0.01])
    seat.metadata["name"] = "Handle_Grip_Seat"
    parts.append(("Handle_Grip_Seat", seat))
    
    # -------------------------------------------------------------------------
    # 2. Tufted Oval Backrest (Tufted_Backrest)
    # Clean Victorian balloon-back oval with front cushion (+Z) and rear panel (-Z)
    # The gold carved crown is integrated into the top arch of the oval texture.
    # -------------------------------------------------------------------------
    back = create_oval_backrest(rx=0.19, ry=0.21, thickness=0.045, n_theta=32)
    
    # Tilt backward around X-axis by 8.5 deg
    tilt_rad = np.radians(-8.5) # Tilt top backward (-Z)
    rot_x = trimesh.transformations.rotation_matrix(tilt_rad, [1, 0, 0])
    back.apply_transform(rot_x)
    back.apply_translation([0.0, 0.25, -0.16])
    back.metadata["name"] = "Tufted_Backrest"
    parts.append(("Tufted_Backrest", back))
    
    # -------------------------------------------------------------------------
    # 3. Armrests (Left & Right)
    # Vertical posts from seat to arm pad, and horizontal arm pads along Z
    # -------------------------------------------------------------------------
    arm_parts = []
    for side in [-1.0, 1.0]:
        x_pos = side * 0.20
        # Vertical arm support post
        post = vertical_cylinder(radius=0.015, height=0.18, sections=16)
        post.apply_translation([x_pos, 0.10, 0.08])
        
        # Horizontal upholstered arm pad along Z
        pad = trimesh.creation.cylinder(radius=0.022, height=0.24, sections=16)
        pad.apply_scale([0.8, 0.7, 1.0])
        pad.apply_translation([x_pos, 0.19, -0.02])
        
        arm_parts.extend([post, pad])
        
    arms_mesh = trimesh.util.concatenate(arm_parts)
    arms_mesh.metadata["name"] = "Armrests"
    parts.append(("Armrests", arms_mesh))
    
    # -------------------------------------------------------------------------
    # 4. Legs: Continuous Vertical Front & Rear Legs
    # Full height 0.42m extending from y = 0 down to y = -0.42
    # -------------------------------------------------------------------------
    leg_parts = []
    
    # Front Legs (Left & Right)
    for side in [-1.0, 1.0]:
        x_f = side * 0.19
        z_f = 0.16
        leg_f = vertical_cylinder(radius=0.018, height=0.42, sections=16)
        leg_f.apply_translation([x_f, -0.21, z_f])
        leg_parts.append(leg_f)
        
    # Rear Legs (Left & Right, splayed backward slightly)
    for side in [-1.0, 1.0]:
        x_b = side * 0.16
        z_b = -0.17
        leg_b = vertical_cylinder(radius=0.016, height=0.42, sections=16)
        rot_b = trimesh.transformations.rotation_matrix(np.radians(-4.0), [1, 0, 0])
        leg_b.apply_transform(rot_b)
        leg_b.apply_translation([x_b, -0.21, z_b])
        leg_parts.append(leg_b)
        
    legs_mesh = trimesh.util.concatenate(leg_parts)
    legs_mesh.metadata["name"] = "Chair_Legs"
    parts.append(("Chair_Legs", legs_mesh))
    
    # -------------------------------------------------------------------------
    # 5. Forward Feature (points forward on +Z)
    # Medallion on front apron
    # -------------------------------------------------------------------------
    fwd = trimesh.creation.cylinder(radius=0.025, height=0.02, sections=16)
    fwd.apply_translation([0.0, 0.0, 0.21])
    fwd.metadata["name"] = "Forward_Feature"
    parts.append(("Forward_Feature", fwd))
    
    # Combine all parts
    all_meshes = [p[1] for p in parts]
    combined = trimesh.util.concatenate(all_meshes)
    
    cur_bounds = combined.bounds
    cur_extents = cur_bounds[1] - cur_bounds[0]
    
    target_extents = np.array([0.48, 0.87, 0.48])
    scale_factors = target_extents / cur_extents
    combined.apply_scale(scale_factors)
    for p in parts:
        p[1].apply_scale(scale_factors)
        
    # Center origin mesh (Handle_Grip_Seat) exactly at (0, 0, 0)
    seat_center = (seat.bounds[0] + seat.bounds[1]) / 2.0
    shift = -seat_center
    combined.apply_translation(shift)
    for p in parts:
        p[1].apply_translation(shift)
        
    print(f"[Chair Generator] Final extents: {(combined.bounds[1] - combined.bounds[0]) * 100} cm")
    print(f"[Chair Generator] Final bounds: min={combined.bounds[0]}, max={combined.bounds[1]}")
    print(f"[Chair Generator] Total triangles: {len(combined.faces)}")
    
    return parts, combined

if __name__ == "__main__":
    parts, combined = create_victorian_chair()
    combined.export("scratch/victorian_chair_aligned.glb")
    print("Exported scratch/victorian_chair_aligned.glb")
