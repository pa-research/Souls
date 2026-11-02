"""Turns a hero exported from Tripo Studio (rigged, Mixamo skeleton, FBX for Blender, with its animations) into the
game's model: src/Souls.Web/wwwroot/Content/Models/Heroes/<class>.glb, its animations named as the 3D client plays
them (heroes.js), its textures 2048 px WebP, in a GLB the browser loads without extra decoders.

    blender --background --factory-startup --python tools/heroes/prepare.py -- <export.fbx> <class id>

Tripo's animation names map to the game's: Warrior-Mage (idle; an AI Animation, a battle stance), slash (attack),
hit_to_body_01 (hit), cast_a_spell (cast), defeat (death), cheer (victory), greet_01 (greet). Other animations in the
export are left out.
"""
import os
import sys

import bpy
from mathutils import Quaternion

CLIPS = {
    'warrior': 'idle',
    'slash': 'attack',
    'hit_to_body': 'hit',
    'cast_a_spell': 'cast',
    'defeat': 'death',
    'cheer': 'victory',
    'greet': 'greet',
}
TEXTURE_SIZE = 2048
LOOP_BLEND = 20  # frames over which the idle eases back into its first pose

source, class_id = sys.argv[sys.argv.index('--') + 1:][:2]
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'Souls.Web', 'wwwroot', 'Content', 'Models', 'Heroes', f'{class_id}.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source, use_anim=True)

# The animations: renamed to the game's names, the others dropped; each kept on the armature's NLA so all export.
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
kept = {}
for action in list(bpy.data.actions):
    game = next((name for key, name in CLIPS.items() if key in action.name.lower()), None)
    if game is None or game in kept:
        bpy.data.actions.remove(action)
        continue
    action.name = game
    action.use_fake_user = True
    kept[game] = action

def close_loop(action, window):
    """Eases the last `window` frames into the first frame's pose, so a looping clip has no jump where it wraps."""
    first, last = action.frame_range
    window = min(window, (last - first) / 2)  # a short clip keeps its first half as it is
    start = last - window
    ramp = lambda f: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (f - start) / window)))
    for bag in (bag for layer in action.layers for strip in layer.strips for bag in strip.channelbags):
        channels = {}
        for curve in bag.fcurves:
            channels.setdefault(curve.data_path, {})[curve.array_index] = curve
        for path, curves in channels.items():
            if path.endswith('rotation_quaternion') and len(curves) == 4:
                # Rotations turn the rest of the way along the shortest arc (componentwise they could pass zero).
                at = lambda f: Quaternion([curves[i].evaluate(f) for i in range(4)])
                delta = at(first) @ at(last).inverted()
                if delta.w < 0:
                    delta.negate()
                keys = {i: {k.co.x: k for k in curves[i].keyframe_points if k.co.x > start} for i in range(4)}
                for frame in sorted(set(keys[0]) & set(keys[1]) & set(keys[2]) & set(keys[3])):
                    q = Quaternion().slerp(delta, ramp(frame)) @ at(frame)
                    for i in range(4):
                        key = keys[i][frame]
                        shift = q[i] - key.co.y
                        key.co.y += shift
                        key.handle_left.y += shift
                        key.handle_right.y += shift
            else:
                for curve in curves.values():
                    gap = curve.evaluate(first) - curve.evaluate(last)
                    for key in curve.keyframe_points:
                        if key.co.x > start:
                            shift = gap * ramp(key.co.x)
                            key.co.y += shift
                            key.handle_left.y += shift
                            key.handle_right.y += shift
            for curve in curves.values():
                curve.update()


# The idle loops forever: the AI Animation does not end quite where it starts.
if 'idle' in kept:
    close_loop(kept['idle'], LOOP_BLEND)
missing = set(CLIPS.values()) - set(kept)
if missing:
    print(f'WARNING: no animation for {sorted(missing)}')
armature.animation_data_create()
armature.animation_data.action = kept.get('idle')
for name, action in kept.items():
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(action.frame_range[0]), action)
    track.mute = True

# Textures: at most TEXTURE_SIZE (Tripo exports 8K).
for image in bpy.data.images:
    if image.size[0] > TEXTURE_SIZE or image.size[1] > TEXTURE_SIZE:
        ratio = TEXTURE_SIZE / max(image.size)
        image.scale(int(image.size[0] * ratio), int(image.size[1] * ratio))

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_image_format='WEBP',
    export_image_quality=90,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_skins=True,
    export_yup=True,
)
print(f'Wrote {out}: {sorted(kept)}, {sum(len(m.data.polygons) for m in bpy.data.objects if m.type == "MESH")} faces')
