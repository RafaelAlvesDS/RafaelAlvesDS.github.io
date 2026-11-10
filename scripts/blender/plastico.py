"""Mesa quadrada e cadeira bistrô de plástico branco (tipo bar). Mesma convenção dos outros: frente -Y, encosto +Y."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moveis import *

def mesa():
    reset(); P = mat('plastic', (0.93, 0.93, 0.91), 0.35)
    cube('tampo', -0.35, 0.35, -0.35, 0.35, 0.69, 0.71, P, bevel=0.012, seg=3)
    cube('aba', -0.35, 0.35, -0.35, 0.35, 0.63, 0.69, P, bevel=0.01, seg=2)
    cube('vazio', -0.33, 0.33, -0.33, 0.33, 0.62, 0.69, P, bevel=0.005)
    for a in (0, math.pi/2):                                                   # frisos em X do tampo
        c = cube('friso', -0.47, 0.47, -0.006, 0.006, 0.71, 0.714, P, bevel=0.002); c.rotation_euler = (0, 0, math.pi/4+a)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = cube('pe', -0.035, 0.035, -0.035, 0.035, -0.33, 0.33, P, bevel=0.01, seg=2)   # malha centrada na origem do objeto
            p.location = (sx*0.305, sy*0.305, 0.33); p.rotation_euler = (sy*0.05, -sx*0.05, 0)
    export('mesa_plastico.glb', 2500)

def cadeira():
    reset(); P = mat('plastic', (0.93, 0.93, 0.91), 0.35)
    s = cube('assento', -0.21, 0.21, -0.22, 0.2, 0.42, 0.45, P, bevel=0.025, seg=3)
    cube('saia', -0.2, 0.2, -0.21, 0.19, 0.39, 0.42, P, bevel=0.01, seg=2)
    for x, y in ((-0.19, -0.19), (0.19, -0.19)):                               # pernas da frente, abertas
        p = cube('perna', -0.025, 0.025, -0.022, 0.022, -0.21, 0.21, P, bevel=0.008, seg=2)
        p.location = (x*1.03, y*1.08, 0.21); p.rotation_euler = (0.06, -math.copysign(0.05, x), 0)
    for x in (-0.19, 0.19):                                                    # pernas de trás que viram a moldura do encosto
        p = cube('montante', -0.022, 0.022, -0.02, 0.02, -0.45, 0.45, P, bevel=0.008, seg=2)
        p.location = (x, 0.2, 0.45); p.rotation_euler = (-0.08, 0, 0)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.19, minor_radius=0.018, major_segments=24, minor_segments=8, location=(0, 0.235, 0.83))
    t = bpy.context.object; t.rotation_euler = (math.pi/2 - 0.08, 0, 0); t.scale = (1, 0.55, 1)
    import bmesh
    bpy.context.view_layer.objects.active = t; bpy.ops.object.mode_set(mode='EDIT'); bm = bmesh.from_edit_mesh(t.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.01], context='VERTS'); bmesh.update_edit_mesh(t.data); bpy.ops.object.mode_set(mode='OBJECT')
    finish(t, P)                                                               # arco do topo
    for i in range(7):                                                         # ripas verticais
        x = -0.135 + i*0.045; top = 0.86 - abs(x)*0.6
        cube('ripa', x-0.009, x+0.009, 0.218, 0.23, 0.5, top, P, bevel=0.004)
    cube('travessa', -0.19, 0.19, 0.185, 0.215, 0.47, 0.52, P, bevel=0.008)
    export('cadeira_plastico.glb', 4000)

mesa(); cadeira()
