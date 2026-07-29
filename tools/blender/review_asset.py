"""Render a neutral turntable-style frame for strict GLB asset review.

This script is designed for Blender MCP's ``python.execute`` namespace. The
bridge injects ``bpy``, ``mathutils``, ``args`` and ``__result__``.
"""

from mathutils import Vector

asset_path = args["asset_path"]
output_path = args["output_path"]
resolution = int(args.get("resolution", 768))

# Start from a deterministic, empty review stage.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials):
    for item in list(block):
        if item.users == 0:
            block.remove(item)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=asset_path)
imported = [obj for obj in bpy.data.objects if obj not in before]
meshes = [obj for obj in imported if obj.type == "MESH"]
if not meshes:
    raise RuntimeError(f"No mesh objects imported from {asset_path}")

# Preserve the imported hierarchy while centring the complete evaluated bounds.
corners = []
for obj in meshes:
    corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
lo = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
hi = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
centre = (lo + hi) * 0.5
offset = Vector((-centre.x, -centre.y, -lo.z))
imported_set = set(imported)
for root in (obj for obj in imported if obj.parent not in imported_set):
    root.location += offset

width = max(hi.x - lo.x, 0.1)
depth = max(hi.y - lo.y, 0.1)
height = max(hi.z - lo.z, 0.1)
radius = max(width, depth, height * 0.55)

# A restrained physical stage makes silhouette, contact, normals and material
# roughness obvious without flattering the asset with dramatic VFX.
bpy.ops.mesh.primitive_plane_add(size=max(8.0, radius * 7.0), location=(0, 0, 0))
floor = bpy.context.object
floor.name = "QA_Floor"
floor_mat = bpy.data.materials.new("QA_Floor_Mat")
floor_mat.diffuse_color = (0.045, 0.052, 0.064, 1.0)
floor_mat.roughness = 0.72
floor.data.materials.append(floor_mat)

def add_area(name, location, energy, size, color):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0, 0, height * 0.48)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj

add_area("QA_Key", (-radius * 2.4, -radius * 2.8, height * 1.55), 1100, radius * 2.0, (1.0, 0.73, 0.48))
add_area("QA_Fill", (radius * 2.7, -radius * 1.5, height * 0.9), 680, radius * 2.4, (0.42, 0.60, 1.0))
add_area("QA_Rim", (0, radius * 2.4, height * 1.45), 950, radius * 1.7, (0.78, 0.88, 1.0))

camera_data = bpy.data.cameras.new("QA_Camera")
camera = bpy.data.objects.new("QA_Camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (radius * 2.15, -radius * 3.35, height * 0.62)
target = Vector((0, 0, height * 0.48))
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 66

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = resolution
scene.render.resolution_y = resolution
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.render.filepath = output_path
scene.render.image_settings.color_depth = "8"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.world.color = (0.008, 0.010, 0.016)

bpy.ops.render.render(write_still=True)
__result__ = {
    "asset": asset_path,
    "output": output_path,
    "mesh_count": len(meshes),
    "object_count": len(imported),
    "bounds": [round(width, 4), round(depth, 4), round(height, 4)],
}
