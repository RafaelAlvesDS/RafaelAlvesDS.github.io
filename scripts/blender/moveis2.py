"""Segunda leva de móveis para o site (mesma convenção de moveis.py: metros, origem no chão, frente para -Y no Blender = +Z no three.js).
Uso: python moveis2.py <pasta_saida>
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moveis import *          # reset, mat, cube, cyl, noise, export, OUT

def bend(o, ang):
    md = o.modifiers.new('curva', 'SIMPLE_DEFORM'); md.deform_method = 'BEND'; md.angle = ang; md.deform_axis = 'Z'

# ---------------------------------------------------------------- cadeira de jantar de fibra natural (encosto em +Y)
def cadeira_fibra():
    reset()
    Fr, Ro = mat('freijo', (0.7, 0.55, 0.38), 0.6), mat('rope', (0.75, 0.6, 0.38), 0.95)
    cube('quadro', -0.225, 0.225, -0.215, 0.215, 0.41, 0.44, Fr, bevel=0.01, seg=2)
    s = cube('palhinha', -0.205, 0.205, -0.2, 0.19, 0.435, 0.465, Ro, bevel=0.012, seg=2); noise(s, 0.002, 0.02)
    for x, y in ((-0.19, -0.18), (0.19, -0.18)):
        cyl('pe', x, y, 0, 0.41, 0.016, 0.02, Fr, 12)
    for x in (-0.19, 0.19):
        cube('pe_tras', x-0.017, x+0.017, 0.165, 0.2, 0, 0.88, Fr, bevel=0.006, seg=2)
    b = cube('encosto', -0.19, 0.19, 0.17, 0.195, 0.56, 0.82, Ro, bevel=0.01, seg=2); bend(b, 0.35); noise(b, 0.002, 0.02)
    t = cube('travessa', -0.2, 0.2, 0.165, 0.2, 0.82, 0.86, Fr, bevel=0.01, seg=2); bend(t, 0.35)
    for y in (-0.18, 0.18):
        cube('trava', -0.19, 0.19, y-0.008, y+0.008, 0.12, 0.14, Fr, bevel=0.004)
    export('cadeira_fibra.glb', 5000)

# ---------------------------------------------------------------- cadeira externa: alumínio preto + corda náutica + almofada (encosto em +Y)
def cadeira_externa():
    reset()
    Al, Ro, Li = mat('black', (0.05, 0.05, 0.05), 0.5), mat('rope', (0.75, 0.6, 0.38), 0.95), mat('linen', (0.86, 0.84, 0.79))
    for x in (-0.2, 0.2):
        cube('pe_frente', x-0.012, x+0.012, -0.2, -0.176, 0, 0.42, Al, bevel=0.004)
        p = cube('pe_tras', x-0.012, x+0.012, 0.176, 0.2, 0, 0.84, Al, bevel=0.004); p.rotation_euler = (-0.1, 0, 0)
        cube('lateral', x-0.012, x+0.012, -0.2, 0.2, 0.4, 0.424, Al, bevel=0.004)
    for y in (-0.19, 0.19):
        cube('travessa', -0.2, 0.2, y-0.012, y+0.012, 0.4, 0.424, Al, bevel=0.004)
    for y in [i*0.05-0.17 for i in range(8)]:                                  # trama de corda do assento
        cyl('corda', 0, y, 0.415, 0.795, 0.007, 0.007, Ro, 8, axis='X')
    for i in range(7):                                                         # cordas horizontais do encosto
        z = 0.5 + i*0.05; cyl('corda_enc', 0, 0.19 + (z-0.42)*0.1, z, z+0.38, 0.008, 0.008, Ro, 8, axis='X')
    a = cube('almofada', -0.2, 0.2, -0.2, 0.18, 0.425, 0.48, Li, bevel=0.02, seg=3, puff=0.05)
    export('cadeira_externa.glb', 5000)
    # cyl com eixo X começa em x (z0 é deslocamento); corrigido abaixo via função específica

# ---------------------------------------------------------------- módulos do sofá externo (encosto em +Y; canto também em -X)
def lounge(nome, w, canto):
    reset()
    Al, Li, Pi = mat('black', (0.05, 0.05, 0.05), 0.5), mat('linen', (0.86, 0.84, 0.79)), mat('terra', (0.7, 0.4, 0.29))
    d = 0.77; x0, x1, y0, y1 = -w/2, w/2, -d/2, d/2
    cube('base', x0+0.02, x1-0.02, y0+0.02, y1-0.02, 0.07, 0.29, Al, bevel=0.015, seg=2)
    for x, y in ((x0+0.04, y0+0.04), (x1-0.04, y0+0.04), (x0+0.04, y1-0.04), (x1-0.04, y1-0.04)):
        cube('pe', x-0.015, x+0.015, y-0.015, y+0.015, 0, 0.07, Al, bevel=0.004)
    s = cube('assento', x0+0.01, x1-0.01, y0+0.01, y1-0.01, 0.28, 0.43, Li, bevel=0.05, seg=4, puff=0.04); noise(s, 0.003, 0.15)
    b = cube('encosto', x0+0.03, x1-0.03, y1-0.19, y1-0.02, 0.38, 0.74, Li, bevel=0.06, seg=4, puff=0.08); b.rotation_euler = (-0.12, 0, 0)
    if canto:
        c = cube('encosto2', x0+0.02, x0+0.19, y0+0.03, y1-0.2, 0.38, 0.74, Li, bevel=0.06, seg=4, puff=0.08); c.rotation_euler = (0, -0.12, 0)
    q = cube('almofada', -0.2, 0.2, y1-0.3, y1-0.18, 0.4, 0.78, Pi, bevel=0.05, seg=4, puff=0.2); q.rotation_euler = (-0.3, 0, 0)
    export(nome, 6000)

# ---------------------------------------------------------------- ombrelone lateral: mastro na origem, cobertura a 1,67 m para -Y
def ombrelone():
    reset()
    Al, Li = mat('black', (0.05, 0.05, 0.05), 0.5), mat('linen', (0.86, 0.84, 0.79))
    L = 1.67
    cube('base1', -0.4, 0.4, -0.04, 0.04, 0, 0.05, Al, bevel=0.01); cube('base2', -0.04, 0.04, -0.2, 0.4, 0, 0.05, Al, bevel=0.01)
    cyl('mastro', 0, 0, 0.05, 2.55, 0.03, 0.025, Al, 12)
    cube('braco', -0.015, 0.015, -L, 0, 2.5, 2.54, Al, bevel=0.006)
    cube('manivela', 0.03, 0.06, -0.02, 0.02, 1.2, 1.3, Al, bevel=0.008)
    cyl('pendural', 0, -L, 2.2, 2.52, 0.02, 0.02, Al, 10)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.15, radius2=0.05, depth=0.28, location=(0, -L, 2.36)); o = bpy.context.object
    md = o.modifiers.new('sl', 'SOLIDIFY'); md.thickness = 0.01; finish(o, Li)
    for i in range(8):                                                         # varetas
        a = (i+0.5)/8*2*math.pi; r = 1.12
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.008, depth=1.15, location=(0, 0, 0)); v = bpy.context.object
        v.location = (math.cos(a)*r/2, -L+math.sin(a)*r/2, 2.36)
        v.rotation_euler = (0, math.pi/2 - math.atan2(0.26, r), 0); v.rotation_mode = 'XYZ'
        v.rotation_euler = (0, 0, 0)
        dx, dy, dz = math.cos(a)*r, math.sin(a)*r, -0.26
        import mathutils
        v.rotation_mode = 'QUATERNION'; v.rotation_quaternion = mathutils.Vector((dx, dy, dz)).to_track_quat('Z', 'Y')
        v.location = (dx/2, -L+dy/2, 2.49+dz/2); finish(v, Al)
    export('ombrelone.glb', 3000)

# ---------------------------------------------------------------- TV 65" com pedestal central (tela virada para +Y)
def tv():
    reset()
    Bk, Sc = mat('black', (0.05, 0.05, 0.05), 0.4), mat('screen', (0.05, 0.08, 0.12), 0.2)
    cube('base', -0.22, 0.22, -0.12, 0.12, 0, 0.015, Bk, bevel=0.006, seg=2)
    cube('pescoco', -0.04, 0.04, -0.03, 0.01, 0.015, 0.2, Bk, bevel=0.008)
    cube('corpo', -0.72, 0.72, -0.03, 0.0, 0.1, 0.93, Bk, bevel=0.006, seg=2)
    cube('costas', -0.45, 0.45, -0.06, -0.02, 0.2, 0.75, Bk, bevel=0.02, seg=3)
    cube('tela', -0.715, 0.715, 0.0, 0.002, 0.105, 0.925, Sc)
    export('tv65.glb', 1500)

# ---------------------------------------------------------------- monitor 27" (tela virada para +Y)
def monitor():
    reset()
    Bk, Sc = mat('black', (0.05, 0.05, 0.05), 0.4), mat('screen', (0.05, 0.08, 0.12), 0.2)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.12, depth=0.012, location=(0, -0.06, 0.006)); o = bpy.context.object
    o.scale = (1.0, 0.75, 1); md = o.modifiers.new('bv', 'BEVEL'); md.width = 0.004; finish(o, Bk)
    cube('pescoco', -0.025, 0.025, -0.1, -0.07, 0.01, 0.32, Bk, bevel=0.008)
    cube('corpo', -0.31, 0.31, -0.035, 0.0, 0.12, 0.49, Bk, bevel=0.006, seg=2)
    cube('costas', -0.18, 0.18, -0.06, -0.03, 0.2, 0.42, Bk, bevel=0.015, seg=3)
    cube('tela', -0.305, 0.305, 0.0, 0.002, 0.13, 0.485, Sc)
    export('monitor27.glb', 1500)

# ---------------------------------------------------------------- geladeira duplex inox 0,70 × 0,72 × 1,86 (frente para -Y)
def geladeira():
    reset()
    Ix, Cr, Bk = mat('inox', (0.78, 0.8, 0.82), 0.3, 0.4), mat('chrome', (0.85, 0.85, 0.87), 0.2, 1.0), mat('black', (0.05, 0.05, 0.05), 0.5)
    cube('corpo', -0.35, 0.35, -0.3, 0.36, 0.03, 1.86, Ix, bevel=0.015, seg=3)
    cube('pes', -0.32, 0.32, -0.28, 0.3, 0, 0.03, Bk)
    cube('porta_baixo', -0.348, 0.348, -0.36, -0.3, 0.04, 0.97, Ix, bevel=0.012, seg=3)
    cube('porta_cima', -0.348, 0.348, -0.36, -0.3, 0.99, 1.85, Ix, bevel=0.012, seg=3)
    cube('vedacao', -0.345, 0.345, -0.34, -0.31, 0.97, 0.99, Bk)
    for z0, z1 in ((0.2, 0.88), (1.08, 1.75)):
        cube('puxador', 0.27, 0.3, -0.42, -0.4, z0, z1, Cr, bevel=0.008, seg=2)
        for z in (z0+0.03, z1-0.03):
            cube('suporte', 0.275, 0.295, -0.4, -0.36, z-0.01, z+0.01, Cr)
    cube('display', -0.08, 0.08, -0.362, -0.36, 1.5, 1.6, Bk)
    export('geladeira.glb', 3000)

os.makedirs(OUT, exist_ok=True)
cadeira_fibra(); cadeira_externa(); lounge('lounge_modulo.glb', 0.95, False); lounge('lounge_canto.glb', 0.77, True)
ombrelone(); tv(); monitor(); geladeira()
