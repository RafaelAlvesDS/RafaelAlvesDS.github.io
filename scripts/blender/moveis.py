"""Gera móveis em glTF para o site (rodam em tempo real no navegador).
Convenção: metros; origem no chão; frente do móvel para -Y no Blender (= +Z no three.js).
Materiais recebem nomes que o site troca pelos materiais dele (com as texturas procedurais): linen, walnut, black, chrome,
leather, duvet, throw, cushion, fabricD. UVs em metros (cube project, 1 unidade = 1 m).
Uso: python moveis.py <pasta_saida>
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector

OUT = sys.argv[-1]
MATS = {}

def mat(name, rgb, rough=0.8, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    MATS[name] = m; return m

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()

def finish(o, m, smooth=True):
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o

def cube(name, x0, x1, y0, y1, z0, z1, m, bevel=0.0, seg=3, sub=0, puff=0.0, smooth=True):
    """caixa de (x0..x1, y0..y1, z0..z1), com chanfro arredondado, subdivisão e 'estufado' opcionais"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0+x1)/2, (y0+y1)/2, (z0+z1)/2))
    o = bpy.context.object; o.name = name; o.scale = (x1-x0, y1-y0, z1-z0)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        md = o.modifiers.new('bv', 'BEVEL'); md.width = bevel; md.segments = seg; md.limit_method = 'NONE'
    if sub:
        md = o.modifiers.new('sb', 'SUBSURF'); md.levels = sub; md.render_levels = sub
    if puff:
        md = o.modifiers.new('cs', 'CAST'); md.factor = puff; md.cast_type = 'SPHERE'
    return finish(o, m, smooth)

def cyl(name, x, y, z0, z1, r0, r1, m, seg=16, axis='Z'):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r0, radius2=r1, depth=z1-z0, location=(0, 0, 0))
    o = bpy.context.object; o.name = name
    if axis == 'X': o.rotation_euler = (0, math.pi/2, 0)
    if axis == 'Y': o.rotation_euler = (math.pi/2, 0, 0)
    o.location = (x, y, (z0+z1)/2) if axis == 'Z' else (x, y, z0)
    md = o.modifiers.new('bv', 'BEVEL'); md.width = min(r0, r1, (z1-z0))*0.3+0.001; md.segments = 2
    return finish(o, m)

def noise(o, strength=0.006, size=0.08):
    t = bpy.data.textures.new('n'+o.name, 'CLOUDS'); t.noise_scale = size
    md = o.modifiers.new('dp', 'DISPLACE'); md.texture = t; md.strength = strength; md.mid_level = 0.5

def export(fname, tris):
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in objs:
        bpy.context.view_layer.objects.active = o; o.select_set(True)
    # aplica modificadores, junta por material, UV em metros e reduz triângulos se passar do alvo
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    o = bpy.context.object
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.uv.cube_project(cube_size=1.0, correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    n = sum(len(p.vertices)-2 for p in o.data.polygons)
    if n > tris:
        md = o.modifiers.new('dc', 'DECIMATE'); md.ratio = tris/n; bpy.ops.object.modifier_apply(modifier='dc')
    n = sum(len(p.vertices)-2 for p in o.data.polygons)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format='GLB', export_apply=True,
                              export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT')
    print(fname, 'triângulos:', n, 'bytes:', os.path.getsize(os.path.join(OUT, fname)))

# ---------------------------------------------------------------- sofá retrátil e reclinável sem caixa (2,04 × 1,00 × 0,97)
def sofa():
    reset()
    L, Ld, W = mat('linen', (0.80, 0.75, 0.65)), mat('fabricD', (0.55, 0.5, 0.44)), mat('walnut', (0.3, 0.2, 0.12), 0.6)
    X = 1.02; AW = 0.13; D = 1.0
    for s in (-1, 1):                                                       # braços finos, topo arredondado
        x0, x1 = (s*X-AW, s*X) if s > 0 else (-X, -X+AW)
        cube('braco', x0, x1, -D, 0, 0.1, 0.6, L, bevel=0.05, seg=4)
    cube('costas', -X+AW, X-AW, -0.24, 0, 0.1, 0.58, L, bevel=0.04, seg=3)
    cube('estrutura', -X+AW, X-AW, -D+0.08, -0.2, 0.12, 0.27, Ld, bevel=0.02, seg=2)
    for a0, a1 in ((-X+AW+0.01, -0.005), (0.005, X-AW-0.01)):
        c = cube('assento', a0, a1, -D, -0.22, 0.26, 0.47, L, bevel=0.06, seg=4, sub=1, puff=0.08)
        noise(c, 0.004, 0.15)
        for nm, z0, z1, y0, y1 in (('encosto', 0.46, 0.97, -0.3, -0.02), ('pillow', 0.84, 0.97, -0.36, -0.06)):
            k = cube(nm, a0+0.01, a1-0.01, y0, y1, z0, z1, L, bevel=0.08, seg=4, sub=1, puff=0.12)
            k.rotation_euler = (-0.13, 0, 0); noise(k, 0.004, 0.15)
    for x, y in ((-X+0.06, -0.06), (X-0.06, -0.06), (-X+0.06, -D+0.06), (X-0.06, -D+0.06), (0, -0.06), (0, -D+0.12)):
        cyl('pe', x, y, 0, 0.1, 0.025, 0.017, W, 12)
    export('sofa_retratil.glb', 14000)

# ---------------------------------------------------------------- cama de casal 1,38 × 1,88 com cabeceira de gomos (encosta em y=0)
def cama():
    reset()
    Wd, Li, Du, Th, Cu, Fd = (mat('walnut', (0.3, 0.2, 0.12), 0.6), mat('linen', (0.85, 0.82, 0.76)), mat('duvet', (0.93, 0.92, 0.9)),
                              mat('throw', (0.45, 0.48, 0.35)), mat('cushion', (0.95, 0.94, 0.92)), mat('fabricD', (0.55, 0.5, 0.44)))
    W = 0.69
    for i in range(6):                                                      # cabeceira estofada em gomos verticais
        a = -W-0.08 + i*(2*W+0.16)/6
        c = cube('gomo', a+0.005, a+(2*W+0.16)/6-0.005, -0.08, 0, 0.12, 0.98, Fd, bevel=0.035, seg=4, sub=1, puff=0.05)
    cube('base_cab', -W-0.08, W+0.08, -0.03, 0, 0.08, 0.98, Fd, bevel=0.01, seg=1)
    cube('box', -W-0.02, W+0.02, -1.94, -0.06, 0.1, 0.34, Wd, bevel=0.015, seg=2)
    cube('rodape', -W+0.05, W-0.05, -1.87, -0.13, 0.0, 0.1, mat('black', (0.05, 0.05, 0.05), 0.5))
    cube('colchao', -W, W, -1.92, -0.08, 0.34, 0.6, Li, bevel=0.04, seg=4)
    d = cube('edredom', -W-0.04, W+0.04, -1.96, -0.72, 0.56, 0.66, Du, bevel=0.04, seg=4); noise(d, 0.008, 0.12)
    for s in (-1, 1):                                                       # caimento lateral do edredom
        x0, x1 = (W+0.02, W+0.06) if s > 0 else (-W-0.06, -W-0.02)
        f = cube('caimento', x0, x1, -1.96, -0.72, 0.36, 0.64, Du, bevel=0.015, seg=3); noise(f, 0.006, 0.1)
    cube('dobra', -W-0.04, W+0.04, -0.82, -0.68, 0.6, 0.71, Du, bevel=0.05, seg=4)
    m = cube('manta', -W-0.06, W+0.06, -1.72, -1.42, 0.655, 0.685, Th, bevel=0.012, seg=3)
    for s in (-1, 1):
        cube('travesseiro', s*0.36-0.3, s*0.36+0.3, -0.5, -0.12, 0.585, 0.73, Cu, bevel=0.06, seg=4, puff=0.2)
        q = cube('almofada', s*0.3-0.2, s*0.3+0.2, -0.6, -0.5, 0.52, 0.84, Fd, bevel=0.05, seg=4, puff=0.2)
        q.rotation_euler = (-0.3, 0, 0)
    export('cama_casal.glb', 16000)

# ---------------------------------------------------------------- cadeira de escritório (presidente), encosto para +Y
def cadeira():
    reset()
    Le, Bk, Cr = mat('leather', (0.12, 0.12, 0.13), 0.45), mat('black', (0.05, 0.05, 0.05), 0.5), mat('chrome', (0.8, 0.8, 0.82), 0.2, 1.0)
    for i in range(5):                                                      # base estrela com rodízios
        a = i/5*2*math.pi + math.pi/2
        bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.object; o.scale = (0.32, 0.05, 0.035)
        bpy.ops.object.transform_apply(scale=True); o.location = (math.cos(a)*0.16, math.sin(a)*0.16, 0.095); o.rotation_euler = (0, 0.12, a)
        md = o.modifiers.new('bv', 'BEVEL'); md.width = 0.012; md.segments = 3; finish(o, Cr)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, segments=12, ring_count=8, location=(math.cos(a)*0.31, math.sin(a)*0.31, 0.03)); finish(bpy.context.object, Bk)
    cyl('pistao', 0, 0, 0.1, 0.4, 0.028, 0.028, Bk, 16); cyl('capa', 0, 0, 0.1, 0.3, 0.04, 0.032, Bk, 16)
    cube('mecanismo', -0.12, 0.12, -0.12, 0.1, 0.38, 0.43, Bk, bevel=0.01)
    s = cube('assento', -0.27, 0.27, -0.27, 0.25, 0.42, 0.53, Le, bevel=0.05, seg=4, sub=1, puff=0.12); noise(s, 0.003, 0.1)
    cube('suporte', -0.04, 0.04, 0.1, 0.26, 0.4, 0.44, Bk, bevel=0.01)          # lâmina que liga o mecanismo ao encosto
    cube('suporte2', -0.04, 0.04, 0.22, 0.27, 0.4, 0.62, Bk, bevel=0.01)
    bpy.ops.object.empty_add(location=(0, 0.25, 0.5)); piv = bpy.context.object
    parts = [cube('encosto', -0.25, 0.25, 0.2, 0.3, 0.52, 1.17, Le, bevel=0.05, seg=4, puff=0.06),
             cube('lombar', -0.22, 0.22, 0.16, 0.24, 0.6, 0.76, Le, bevel=0.03, seg=3, puff=0.1),
             cube('gomo', -0.22, 0.22, 0.16, 0.24, 0.8, 0.96, Le, bevel=0.03, seg=3, puff=0.1),
             cube('haste_cab', -0.03, 0.03, 0.27, 0.31, 1.1, 1.22, Bk, bevel=0.008),
             cube('cabeca', -0.19, 0.19, 0.21, 0.3, 1.18, 1.36, Le, bevel=0.04, seg=4, puff=0.12)]
    for o in parts:
        mw = o.matrix_world.copy(); o.parent = piv; o.matrix_world = mw
    piv.rotation_euler = (-0.12, 0, 0)
    for x in (-0.29, 0.29):                                                 # braços
        cube('haste', x-0.025, x+0.025, -0.02, 0.06, 0.5, 0.66, Bk, bevel=0.01)
        cube('apoio', x-0.04, x+0.04, -0.2, 0.14, 0.66, 0.7, Bk, bevel=0.015, seg=3)
    export('cadeira_escritorio.glb', 9000)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sofa(); cama(); cadeira()
