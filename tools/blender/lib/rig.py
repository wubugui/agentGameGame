"""
The canonical skeleton every humanoid in the game shares.

Bone names here are NORMATIVE: they must match the `Rig.joints` keys in
docs/CONTRACTS.md exactly, because src/entities/Animator.js looks joints up by
name and rotates them directly. THREE.Bone extends Object3D, so a bone imported
from a GLB satisfies the same contract a hand-built Object3D did.

Sharing one skeleton across every character also means one set of animations
retargets to all of them for free.

Blender is Z-up; the glTF exporter converts to Y-up on the way out, so model
everything Z-up here and it lands correctly in Three.js.
"""
import bpy
from mathutils import Vector

# Bone name -> (head, tail, parent). Units are world units == Mir tiles.
# A 1.8-unit-tall adult male; other builds scale from this.
HUMANOID_BONES = {
    "hips":      ((0.000, 0.000, 0.980), (0.000, 0.000, 1.120), None),
    "spine":     ((0.000, 0.000, 1.120), (0.000, 0.000, 1.300), "hips"),
    "chest":     ((0.000, 0.000, 1.300), (0.000, 0.000, 1.520), "spine"),
    "neck":      ((0.000, 0.000, 1.520), (0.000, 0.000, 1.620), "chest"),
    "head":      ((0.000, 0.000, 1.620), (0.000, 0.000, 1.820), "neck"),

    "shoulderL": ((0.075, 0.000, 1.480), (0.210, 0.000, 1.470), "chest"),
    "elbowL":    ((0.210, 0.000, 1.470), (0.210, 0.000, 1.200), "shoulderL"),
    "wristL":    ((0.210, 0.000, 1.200), (0.210, 0.000, 0.960), "elbowL"),

    "shoulderR": ((-0.075, 0.000, 1.480), (-0.210, 0.000, 1.470), "chest"),
    "elbowR":    ((-0.210, 0.000, 1.470), (-0.210, 0.000, 1.200), "shoulderR"),
    "wristR":    ((-0.210, 0.000, 1.200), (-0.210, 0.000, 0.960), "elbowR"),

    "hipL":      ((0.095, 0.000, 0.960), (0.100, 0.000, 0.540), "hips"),
    "kneeL":     ((0.100, 0.000, 0.540), (0.100, 0.000, 0.090), "hipL"),
    "ankleL":    ((0.100, 0.000, 0.090), (0.100, 0.150, 0.030), "kneeL"),

    "hipR":      ((-0.095, 0.000, 0.960), (-0.100, 0.000, 0.540), "hips"),
    "kneeR":     ((-0.100, 0.000, 0.540), (-0.100, 0.000, 0.090), "hipR"),
    "ankleR":    ((-0.100, 0.000, 0.090), (-0.100, 0.150, 0.030), "kneeR"),
}

# Mount points the game parents weapons/shields/capes to. Exported as empties
# parented to the named bone; Three.js sees them as Object3D children.
ATTACH_POINTS = {
    "handR": ("wristR", (-0.215, 0.02, 0.940)),
    "handL": ("wristL", (0.215, 0.02, 0.940)),
    "back":  ("chest",  (0.000, -0.13, 1.420)),
    "headTop": ("head", (0.000, 0.00, 1.800)),
}

# Quadrupeds and insects reuse the same NAMES so Animator never hits an
# undefined joint; the front legs stand in for the arms.
QUADRUPED_MAP = {
    "shoulderL": "frontLegL_upper", "elbowL": "frontLegL_lower", "wristL": "frontPawL",
    "shoulderR": "frontLegR_upper", "elbowR": "frontLegR_lower", "wristR": "frontPawR",
    "hipL": "hindLegL_upper", "kneeL": "hindLegL_lower", "ankleL": "hindPawL",
    "hipR": "hindLegR_upper", "kneeR": "hindLegR_lower", "ankleR": "hindPawR",
}


def build_armature(name="rig", bones=None, scale=1.0):
    """Create the armature object and return it (in OBJECT mode)."""
    bones = bones or HUMANOID_BONES
    arm_data = bpy.data.armatures.new(name)
    arm_obj = bpy.data.objects.new(name, arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    created = {}
    # Two passes so a child can reference a parent defined later in the dict.
    for bname, (head, tail, _parent) in bones.items():
        eb = arm_data.edit_bones.new(bname)
        eb.head = Vector(head) * scale
        eb.tail = Vector(tail) * scale
        eb.use_connect = False
        created[bname] = eb
    for bname, (_h, _t, parent) in bones.items():
        if parent:
            created[bname].parent = created[parent]

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def add_attach_empties(arm_obj, points=None, scale=1.0):
    """Empties parented to bones, so the game can mount gear by name."""
    points = points or ATTACH_POINTS
    out = {}
    for name, (bone, loc) in points.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.05
        e.location = Vector(loc) * scale
        bpy.context.collection.objects.link(e)
        e.parent = arm_obj
        e.parent_type = "BONE"
        e.parent_bone = bone
        # Bone-parenting anchors to the bone TAIL; undo that so the empty sits
        # where we actually asked for it in armature space.
        e.matrix_parent_inverse = (arm_obj.matrix_world @ _bone_tail_matrix(arm_obj, bone)).inverted()
        out[name] = e
    return out


def _bone_tail_matrix(arm_obj, bone_name):
    from mathutils import Matrix
    pb = arm_obj.pose.bones.get(bone_name)
    if pb is None:
        return Matrix.Identity(4)
    m = pb.matrix.copy()
    m.translation = pb.tail.copy()
    return m


def bind(mesh_objs, arm_obj, heat=True):
    """Skin meshes to the armature with automatic weights."""
    bpy.ops.object.select_all(action="DESELECT")
    for m in mesh_objs:
        m.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO" if heat else "ARMATURE_NAME")


def rigid_bind(mesh_obj, arm_obj, bone_name):
    """
    Hard-assign every vertex of a mesh to one bone. Correct for armour plates,
    helmets, and weapons, which should not deform at all — and much cheaper
    than heat-map weights.
    """
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    mesh_obj.parent = arm_obj
    vg = mesh_obj.vertex_groups.new(name=bone_name)
    vg.add(range(len(mesh_obj.data.vertices)), 1.0, "REPLACE")
