"""Armas do battle royale (glTF): pistola, escopeta, fuzil, sniper. Origem na empunhadura (onde fica a mão direita),
cano apontando para +Y no Blender (= -Z no three.js, a direção para onde a câmera olha). Metros.
Materiais: gunmetal, polymer, wood, glass. Uso: python armas.py <pasta>"""
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moveis import reset, mat, cube, cyl, export, finish

def tube(name, y0, y1, r, m, z=0.0, x=0.0, seg=16, r1=None):
    """cilindro ao longo de Y (cano), de y0 a y1"""
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r if r1 is None else r1, depth=y1-y0, location=(x, (y0+y1)/2, z), rotation=(-math.pi/2, 0, 0))
    o = bpy.context.object; o.name = name
    md = o.modifiers.new('bv', 'BEVEL'); md.width = min(r, 0.004); md.segments = 2; md.limit_method = 'ANGLE'
    return finish(o, m)
def M():
    return mat('gunmetal', (0.11, 0.115, 0.12), 0.35, 0.8), mat('polymer', (0.06, 0.06, 0.065), 0.6), mat('wood', (0.36, 0.2, 0.09), 0.55), mat('glass', (0.15, 0.3, 0.35), 0.05, 0.5)
def grip(P, ang=0.32, h=0.11, w=0.03, d=0.045, y=0.0):
    g = cube('empunhadura', -w/2, w/2, y-d/2, y+d/2, -h, 0.03, P, bevel=0.008, seg=2); g.rotation_euler = (ang, 0, 0); return g
def guard(G, y0, y1, z):
    cube('guarda_baixo', -0.007, 0.007, y0, y1, z-0.006, z, G, bevel=0.002)
    cube('guarda_frente', -0.007, 0.007, y1-0.006, y1, z, z+0.035, G, bevel=0.002)
    cube('gatilho', -0.003, 0.003, (y0+y1)/2-0.003, (y0+y1)/2+0.003, z+0.005, z+0.03, G, bevel=0.001)

def pistola():
    reset(); G, P, W, Gl = M()
    cube('ferrolho', -0.014, 0.014, -0.035, 0.155, 0.04, 0.072, G, bevel=0.004, seg=2)
    for i in range(6): cube('serrilha', -0.0145, 0.0145, -0.03+i*0.007, -0.027+i*0.007, 0.045, 0.07, P)
    cube('ejecao', -0.0146, 0.002, 0.03, 0.07, 0.055, 0.069, P)
    cube('armacao', -0.013, 0.013, -0.025, 0.145, 0.018, 0.042, P, bevel=0.004, seg=2)
    cube('trilho', -0.011, 0.011, 0.09, 0.14, 0.008, 0.02, P, bevel=0.002)
    tube('cano', 0.15, 0.16, 0.007, G, z=0.058)
    cube('mira_tras', -0.009, 0.009, -0.03, -0.018, 0.072, 0.08, G); cube('mira_frente', -0.003, 0.003, 0.14, 0.148, 0.072, 0.079, G)
    grip(P, ang=0.28, h=0.1, w=0.029, d=0.046, y=0.0)
    guard(P, 0.015, 0.07, 0.006)
    cube('carregador', -0.011, 0.011, -0.03, 0.01, -0.105, -0.095, G, bevel=0.002)
    export('arma_pistola.glb', 3000)

def fuzil():
    reset(); G, P, W, Gl = M()
    cube('receptor', -0.024, 0.024, -0.08, 0.17, 0.0, 0.065, G, bevel=0.005, seg=2)
    cube('receptor_baixo', -0.022, 0.022, -0.06, 0.12, -0.03, 0.005, P, bevel=0.004, seg=2)
    cube('trilho_topo', -0.012, 0.012, -0.075, 0.46, 0.065, 0.078, P)
    for i in range(24): cube('dente', -0.0125, 0.0125, -0.07+i*0.022, -0.06+i*0.022, 0.078, 0.082, P)
    cube('guarda_mao', -0.026, 0.026, 0.17, 0.46, -0.012, 0.062, P, bevel=0.008, seg=2)
    for i in range(8): cube('ventilacao', -0.027, 0.027, 0.19+i*0.032, 0.205+i*0.032, 0.01, 0.045, G)
    tube('cano', 0.46, 0.66, 0.009, G, z=0.03)
    tube('quebra_chama', 0.66, 0.71, 0.013, G, z=0.03, seg=8)
    cube('massa_mira', -0.006, 0.006, 0.56, 0.58, 0.03, 0.085, G, bevel=0.002); cube('poste', -0.002, 0.002, 0.567, 0.573, 0.085, 0.1, G)
    # mira red dot
    tube('red_dot', 0.0, 0.075, 0.019, P, z=0.11); cube('base_dot', -0.012, 0.012, 0.01, 0.065, 0.078, 0.095, P)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.016, depth=0.003, location=(0, -0.0015, 0.11), rotation=(-math.pi/2, 0, 0)); finish(bpy.context.object, Gl)
    # carregador curvo
    for i in range(4):     # carregador curvo em 4 gomos
        c = cube('carregador', -0.014, 0.014, 0.065+i*0.016, 0.11+i*0.016, -0.085-i*0.038, -0.02-i*0.038, G, bevel=0.003); c.rotation_euler = (-(0.1+i*0.08), 0, 0)
    grip(P, ang=0.35, h=0.1, w=0.028, d=0.04, y=0.0)
    guard(G, 0.02, 0.065, -0.03)
    # coronha retrátil
    tube('tubo_coronha', -0.24, -0.08, 0.014, G, z=0.03, seg=12)
    cube('coronha', -0.022, 0.022, -0.3, -0.17, -0.035, 0.07, P, bevel=0.01, seg=2)
    cube('soleira', -0.024, 0.024, -0.31, -0.295, -0.04, 0.072, mat('borracha', (0.03, 0.03, 0.03), 0.9), bevel=0.004)
    cube('alca', -0.006, 0.006, 0.2, 0.42, -0.02, -0.012, P)
    export('arma_fuzil.glb', 6000)

def escopeta():
    reset(); G, P, W, Gl = M()
    cube('receptor', -0.024, 0.024, -0.06, 0.15, -0.005, 0.06, G, bevel=0.006, seg=2)
    tube('cano', 0.15, 0.62, 0.012, G, z=0.04)
    tube('tubo', 0.15, 0.58, 0.012, G, z=0.012)
    cube('ligacao', -0.006, 0.006, 0.56, 0.585, 0.012, 0.04, G)
    for i in range(10):    # telha (pump) com ranhuras
        tube('telha', 0.25+i*0.018, 0.262+i*0.018, 0.022 if i % 2 else 0.02, W, z=0.012, seg=12)
    cube('mira', -0.003, 0.003, 0.61, 0.615, 0.052, 0.06, G)
    grip(W, ang=0.38, h=0.1, w=0.03, d=0.045)
    guard(G, 0.02, 0.07, -0.006)
    c = cube('coronha', -0.02, 0.02, -0.33, -0.03, -0.05, 0.05, W, bevel=0.012, seg=2); c.rotation_euler = (-0.12, 0, 0)
    cube('soleira', -0.022, 0.022, -0.35, -0.325, -0.08, 0.06, mat('borracha', (0.03, 0.03, 0.03), 0.9), bevel=0.004)
    export('arma_escopeta.glb', 5000)

def sniper():
    reset(); G, P, W, Gl = M()
    cube('receptor', -0.022, 0.022, -0.05, 0.2, 0.0, 0.05, G, bevel=0.005, seg=2)
    tube('cano', 0.2, 0.95, 0.011, G, z=0.028, r1=0.009)
    tube('freio', 0.95, 1.0, 0.016, G, z=0.028, seg=8)
    # coronha/chassi de madeira
    cube('chassi', -0.028, 0.028, -0.02, 0.48, -0.03, 0.025, W, bevel=0.01, seg=2)
    c = cube('coronha', -0.026, 0.026, -0.36, -0.02, -0.09, 0.03, W, bevel=0.012, seg=2)
    cube('apoio_rosto', -0.02, 0.02, -0.3, -0.12, 0.03, 0.06, W, bevel=0.01, seg=2)
    cube('soleira', -0.028, 0.028, -0.375, -0.355, -0.095, 0.035, mat('borracha', (0.03, 0.03, 0.03), 0.9), bevel=0.004)
    grip(W, ang=0.3, h=0.09, w=0.03, d=0.045)
    guard(G, 0.02, 0.07, -0.03)
    # ferrolho
    tube('ferrolho', -0.05, 0.12, 0.01, G, z=0.05, x=0.0)
    cyl('alavanca', 0.0, 0.02, 0.0, 0.0, 0.005, 0.005, G, 8, axis='X'); a = bpy.context.object; a.location = (0.012, 0.02, 0.05); a.scale = (1, 1, 0.06/0.0 if False else 1)
    cube('alavanca2', 0.012, 0.055, 0.015, 0.025, 0.045, 0.055, G, bevel=0.002)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.01, segments=10, ring_count=6, location=(0.058, 0.02, 0.05)); finish(bpy.context.object, G)
    # luneta
    tube('luneta', -0.03, 0.27, 0.017, P, z=0.11)
    tube('ocular', -0.08, -0.03, 0.021, P, z=0.11, r1=0.017)
    tube('objetiva', 0.27, 0.34, 0.017, P, z=0.11, r1=0.026)
    for y in (-0.0805, 0.3405):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.019 if y < 0 else 0.024, depth=0.002, location=(0, y, 0.11), rotation=(-math.pi/2, 0, 0)); finish(bpy.context.object, Gl)
    cyl('torre', 0.0, 0.12, 0.125, 0.145, 0.012, 0.012, P, 12); cyl('torre_l', 0.0, 0.12, 0.11, 0.11, 0.01, 0.01, P, 12, axis='X'); bpy.context.object.location = (0.017, 0.12, 0.11)
    for y in (0.02, 0.22): cube('anel', -0.02, 0.02, y-0.01, y+0.01, 0.05, 0.1, G, bevel=0.003)
    cube('carregador', -0.016, 0.016, 0.06, 0.12, -0.07, -0.025, G, bevel=0.003)
    # bipé dobrado
    for s in (-1, 1): cube('bipe', s*0.012-0.004, s*0.012+0.004, 0.25, 0.45, -0.045, -0.035, G, bevel=0.002)
    export('arma_sniper.glb', 7000)

OUTD = sys.argv[-1]
import moveis; moveis.OUT = OUTD; moveis.VCOL = True
pistola(); fuzil(); escopeta(); sniper()
