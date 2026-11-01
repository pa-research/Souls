"""Turns a hero exported from Tripo Studio (rigged, Mixamo skeleton, FBX for Blender, with its animations) into the
game's model: src/Souls.Web/wwwroot/Content/Models/Heroes/<class>.glb, its animations named as the 3D client plays
them (heroes.js), its textures 2048 px WebP, in a GLB the browser loads without extra decoders.

    blender --background --factory-startup --python tools/heroes/prepare.py -- <export.fbx> <class id>

Tripo's preset names map to the game's: idle, slash (attack), hit_to_body_01 (hit), cast_a_spell (cast), defeat
(death), cheer (victory), greet_01 (greet). Other animations in the export are left out.
"""
import os
import sys

import bpy

CLIPS = {
    'idle': 'idle',
    'slash': 'attack',
    'hit_to_body': 'hit',
    'cast_a_spell': 'cast',
    'defeat': 'death',
    'cheer': 'victory',
    'greet': 'greet',
}
TEXTURE_SIZE = 2048

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
