"""Soldado low-poly com esqueleto e animações para o battle royale (glTF com skinning).
Peças rígidas presas a ossos (peso 1). Materiais: 'skin', 'gear' (preto/cinza), 'cloth' (cor da roupa, trocada por NPC), 'pants'.
Animações: idle, walk, run, crouch, crouchwalk, aim, aimcrouch, die. Frente para -Y no Blender (= +Z no three.js), 1 m = 1 unidade.
Uso: python soldado.py <saida.glb>"""
import bpy, bmesh, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Euler
OUT = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
FPS = 24
bpy.context.scene.render.fps = FPS

def mat(n, rgb, r=0.8, m=0.0):
    M = bpy.data.materials.new(n); M.use_nodes = True; b = M.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = m; return M
SKIN, GEAR, CLOTH, PANTS, BOOT = mat('skin', (0.78, 0.56, 0.42), 0.7), mat('gear', (0.16, 0.17, 0.16), 0.6), mat('cloth', (0.85, 0.85, 0.85), 0.85), mat('pants', (0.22, 0.25, 0.2), 0.85), mat('boot', (0.12, 0.1, 0.08), 0.7)

# ---------------- esqueleto
arm = bpy.data.armatures.new('rig'); rig = bpy.data.objects.new('soldado', arm); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
B = {}
def bone(n, h, t, parent=None):
    b = arm.edit_bones.new(n); b.head = h; b.tail = t
    if parent: b.parent = B[parent]; b.use_connect = False
    B[n] = b; return b
bone('hips', (0, 0, 0.95), (0, 0, 1.05))
bone('spine', (0, 0, 1.05), (0, 0, 1.25), 'hips')
bone('chest', (0, 0, 1.25), (0, 0, 1.45), 'spine')
bone('neck', (0, 0, 1.45), (0, 0, 1.55), 'chest')
bone('head', (0, 0, 1.55), (0, 0, 1.75), 'neck')
for s, L in ((1, 'L'), (-1, 'R')):
    bone('upperarm.'+L, (s*0.19, 0, 1.42), (s*0.19, 0, 1.15), 'chest')
    bone('forearm.'+L, (s*0.19, 0, 1.15), (s*0.19, 0, 0.9), 'upperarm.'+L)
    bone('hand.'+L, (s*0.19, 0, 0.9), (s*0.19, 0, 0.8), 'forearm.'+L)
    bone('thigh.'+L, (s*0.1, 0, 0.93), (s*0.1, 0, 0.5), 'hips')
    bone('shin.'+L, (s*0.1, 0, 0.5), (s*0.1, 0, 0.08), 'thigh.'+L)
    bone('foot.'+L, (s*0.1, 0, 0.08), (s*0.1, -0.15, 0.04), 'shin.'+L)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------- malha: peças arredondadas presas aos ossos
parts = []
def piece(bn, m, prim='cube', loc=(0, 0, 0), scl=(1, 1, 1), rot=(0, 0, 0), bev=0.0, seg=2, verts=12, taper=None):
    if prim == 'cube': bpy.ops.mesh.primitive_cube_add(size=1)
    elif prim == 'cyl': bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=0.5, depth=1)
    elif prim == 'sph': bpy.ops.mesh.primitive_uv_sphere_add(segments=verts, ring_count=max(6, verts//2), radius=0.5)
    o = bpy.context.object; o.scale = scl; o.rotation_euler = rot; o.location = loc
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if taper:   # afina a parte de baixo (z<0) por um fator
        for v in o.data.vertices:
            if v.co.z < 0: v.co.x *= taper; v.co.y *= taper
    if bev:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bev; md.segments = seg; md.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='b')
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    o['bone'] = bn; parts.append(o); return o

# tronco e quadril
piece('chest', CLOTH, loc=(0, 0, 1.33), scl=(0.36, 0.22, 0.28), bev=0.06, seg=3, taper=0.88)
piece('chest', GEAR, loc=(0, -0.005, 1.31), scl=(0.38, 0.25, 0.24), bev=0.03, seg=2)                 # colete
for x in (-0.09, 0.0, 0.09): piece('chest', GEAR, loc=(x, -0.135, 1.24), scl=(0.075, 0.05, 0.1), bev=0.012)   # porta-carregadores
piece('spine', CLOTH, loc=(0, 0, 1.13), scl=(0.31, 0.19, 0.2), bev=0.05, seg=3)
piece('hips', PANTS, loc=(0, 0, 0.98), scl=(0.32, 0.2, 0.14), bev=0.04, seg=2)
piece('hips', GEAR, loc=(0, 0, 1.04), scl=(0.335, 0.215, 0.04), bev=0.01)                            # cinto
piece('neck', SKIN, 'cyl', loc=(0, 0, 1.5), scl=(0.1, 0.1, 0.1), verts=10)
# cabeça: rosto, nariz, orelhas, capacete
piece('head', SKIN, 'sph', loc=(0, -0.005, 1.64), scl=(0.18, 0.2, 0.23), verts=16)
piece('head', SKIN, 'cube', loc=(0, -0.105, 1.62), scl=(0.03, 0.04, 0.05), bev=0.01)
for s in (1, -1): piece('head', SKIN, 'sph', loc=(s*0.09, 0.005, 1.63), scl=(0.03, 0.05, 0.06), verts=8)
for s in (1, -1): piece('head', GEAR, 'sph', loc=(s*0.042, -0.098, 1.66), scl=(0.025, 0.012, 0.018), verts=8)   # olhos
h = piece('head', PANTS, 'sph', loc=(0, 0.0, 1.69), scl=(0.215, 0.235, 0.17), verts=16)
for v in h.data.vertices:
    if v.co.z < -0.02: v.co.z = -0.02                                                              # capacete cortado na base
piece('head', PANTS, 'cube', loc=(0, -0.1, 1.715), scl=(0.18, 0.06, 0.012), bev=0.004)              # aba
# braços e pernas
for s, L in ((1, 'L'), (-1, 'R')):
    piece('chest', CLOTH, 'sph', loc=(s*0.19, 0, 1.42), scl=(0.13, 0.13, 0.12), verts=10)            # ombro
    piece('upperarm.'+L, CLOTH, 'cyl', loc=(s*0.19, 0, 1.28), scl=(0.105, 0.105, 0.27), verts=10, taper=0.85)
    piece('forearm.'+L, SKIN, 'cyl', loc=(s*0.19, 0, 1.02), scl=(0.085, 0.085, 0.25), verts=10, taper=0.8)
    piece('forearm.'+L, CLOTH, 'cyl', loc=(s*0.19, 0, 1.12), scl=(0.098, 0.098, 0.06), verts=10)     # punho da manga
    piece('hand.'+L, GEAR, 'cube', loc=(s*0.19, -0.01, 0.84), scl=(0.06, 0.09, 0.11), bev=0.02, seg=2)   # luva
    piece('thigh.'+L, PANTS, 'cyl', loc=(s*0.1, 0, 0.71), scl=(0.15, 0.15, 0.44), verts=10, taper=0.8)
    piece('thigh.'+L, GEAR, 'cube', loc=(s*0.17, 0, 0.74), scl=(0.04, 0.11, 0.13), bev=0.01)         # bolso lateral
    piece('shin.'+L, PANTS, 'cyl', loc=(s*0.1, 0, 0.31), scl=(0.115, 0.115, 0.42), verts=10, taper=0.8)
    piece('shin.'+L, GEAR, 'cube', loc=(s*0.1, -0.06, 0.48), scl=(0.11, 0.04, 0.09), bev=0.015)      # joelheira
    piece('foot.'+L, BOOT, 'cube', loc=(s*0.1, -0.05, 0.055), scl=(0.11, 0.27, 0.11), bev=0.03, seg=2)

# junta tudo numa malha só, com grupos de vértices por osso
for o in parts:
    vg = o.vertex_groups.new(name=o['bone']); vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
body = bpy.context.object; body.name = 'corpo'
from moveis import bake_vcol
bake_vcol(body, keep=('cloth',))
body.parent = rig; md = body.modifiers.new('arm', 'ARMATURE'); md.object = rig
print('triângulos', sum(len(p.vertices)-2 for p in body.data.polygons))

# ---------------- animações (poses por quadro-chave, rotações em graus no espaço local do osso)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
PB = rig.pose.bones
for pb in PB: pb.rotation_mode = 'XYZ'
def clear():
    for pb in PB: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
def key(frame, pose):
    clear()
    for n, v in pose.items():
        if n == 'hips_loc': PB['hips'].location = (v[0], v[2], -v[1]); continue   # osso do quadril aponta para cima: Y local = vertical
        PB[n].rotation_euler = [math.radians(a) for a in v]
    for pb in PB:
        pb.keyframe_insert('rotation_euler', frame=frame); pb.keyframe_insert('location', frame=frame)
# Convenções medidas no rig: ossos que apontam para baixo (braços e pernas): X negativo = para a frente; X positivo = para trás.
# Ossos que apontam para cima (coluna, cabeça): X positivo = inclina para a frente. Braço R: Z+ abre para fora; braço L: Z- abre para fora.
AIM = {'upperarm.R': (-40, 0, 12), 'forearm.R': (-62, 0, 0), 'hand.R': (0, 0, 0),
       'upperarm.L': (-72, 0, 22), 'forearm.L': (-28, 0, 0)}
def with_aim(p, aim=True):
    q = dict(AIM) if aim else {}; q.update(p); return q
def action(name, frames, loop=True):
    a = bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action = a
    for f, p in frames: key(f, p)
    tr = rig.animation_data.nla_tracks.new(); tr.name = name; st = tr.strips.new(name, int(frames[0][0]), a); st.name = name
    rig.animation_data.action = None
def walkcycle(n, amp, knee, bob, drop=0.0, thigh0=0.0, shin0=0.0, foot0=0.0, lean=0):
    fr = []
    for k in range(9):
        t = k/8*2*math.pi; s = math.sin(t)
        p = {'hips_loc': (0, 0, -drop - bob*abs(math.sin(t))), 'spine': (lean, 0, 0), 'neck': (-lean*0.6, 0, 0)}
        p['thigh.L'] = (-thigh0 - amp*s, 0, 0); p['thigh.R'] = (-thigh0 + amp*s, 0, 0)
        p['shin.L'] = (shin0 + knee*max(0, math.sin(t+1.6)), 0, 0); p['shin.R'] = (shin0 + knee*max(0, math.sin(t+1.6+math.pi)), 0, 0)
        p['foot.L'] = (-foot0, 0, 0); p['foot.R'] = (-foot0, 0, 0)
        fr.append((1 + k*n/8, with_aim(p)))
    return fr
action('idle', [(1, with_aim({'spine': (2, 0, 0)})), (24, with_aim({'spine': (0, 0, 0), 'hips_loc': (0, 0, -0.01)})), (48, with_aim({'spine': (2, 0, 0)}))])
action('walk', walkcycle(24, 25, 45, 0.02))
action('run', walkcycle(16, 42, 85, 0.05, lean=14))
CR = {'hips_loc': (0, 0, -0.38), 'thigh.L': (-72, 0, -6), 'shin.L': (112, 0, 0), 'foot.L': (-38, 0, 0),
      'thigh.R': (-50, 0, 6), 'shin.R': (112, 0, 0), 'foot.R': (-60, 0, 0), 'spine': (22, 0, 0), 'neck': (-14, 0, 0)}
action('crouch', [(1, with_aim(CR)), (40, with_aim(dict(CR, spine=(20, 0, 0)))), (80, with_aim(CR))])
action('crouchwalk', walkcycle(32, 18, 30, 0.015, drop=0.33, thigh0=60, shin0=100, foot0=40, lean=20))
action('aim', [(1, with_aim({'spine': (4, 0, 0)})), (30, with_aim({'spine': (5, 0, 0)}))])
action('die', [(1, with_aim({})),
               (7, {'hips_loc': (0, 0.05, -0.3), 'hips': (-25, 0, 0), 'spine': (-10, 0, 0), 'thigh.L': (-30, 0, 0), 'shin.L': (50, 0, 0), 'thigh.R': (-15, 0, 0), 'shin.R': (30, 0, 0),
                    'upperarm.L': (-60, 0, -40), 'upperarm.R': (-60, 0, 40)}),
               (15, {'hips_loc': (0, 0.35, -0.8), 'hips': (-88, 0, 0), 'spine': (-4, 0, 0), 'head': (-10, 0, 20), 'thigh.L': (-18, 0, -8), 'shin.L': (25, 0, 0),
                     'thigh.R': (-5, 0, 8), 'shin.R': (8, 0, 0), 'upperarm.L': (-20, 0, -70), 'upperarm.R': (-30, 0, 75), 'forearm.R': (-30, 0, 0)}),
               (20, {'hips_loc': (0, 0.35, -0.8), 'hips': (-90, 0, 0), 'spine': (-4, 0, 0), 'head': (-10, 0, 20), 'thigh.L': (-18, 0, -8), 'shin.L': (25, 0, 0),
                     'thigh.R': (-5, 0, 8), 'shin.R': (8, 0, 0), 'upperarm.L': (-20, 0, -70), 'upperarm.R': (-30, 0, 75), 'forearm.R': (-30, 0, 0)})], loop=False)
clear(); bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); body.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_skins=True, export_yup=True, export_apply=False, export_force_sampling=True, export_frame_step=2)
print('ok', os.path.getsize(OUT))
