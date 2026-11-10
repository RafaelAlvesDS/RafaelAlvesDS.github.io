"""Carros do estacionamento (hatch, sedã, SUV) para instanciar no site: comprimento em X, largura em Y, Z para cima.
Materiais: paint (branco, recebe a cor por instância), glass, tire, rim, light, tail. Origem no chão, no centro do carro."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moveis import *
import bmesh

def prism(name, pts, w, m, bevel=0.05, seg=3, y=0.0):
    """extruda um perfil lateral (x,z) na largura w (centrado em y)"""
    me = bpy.data.meshes.new(name); o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    bm = bmesh.new(); vs = [bm.verts.new((x, y-w/2, z)) for x, z in pts]; f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f]); bmesh.ops.translate(bm, vec=(0, w, 0), verts=[v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    if bevel:
        md = o.modifiers.new('bv', 'BEVEL'); md.width = bevel; md.segments = seg; md.limit_method = 'ANGLE'; md.angle_limit = 0.35
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    md = o.modifiers.new('ws', 'WEIGHTED_NORMAL') if hasattr(bpy.types, 'WeightedNormalModifier') else None
    return o

def car(fname, L, W, body, cabin, roofz, axle, wr=0.31):
    reset()
    P, G, T, R, Li, Ta = (mat('paint', (1, 1, 1), 0.35, 0.4), mat('glass', (0.06, 0.08, 0.1), 0.1), mat('tire', (0.04, 0.04, 0.04), 0.9),
                          mat('rim', (0.75, 0.76, 0.78), 0.3, 0.9), mat('light', (0.95, 0.95, 0.9), 0.1), mat('tail', (0.6, 0.05, 0.05), 0.3))
    # carroceria com caixas de roda recortadas no perfil (para as rodas aparecerem)
    R0 = wr + 0.06; fxb = body[-1][0]; arch = []
    for cx in (axle, -axle):
        arch += [(cx+R0, body[-1][1])] + [(cx+R0*math.cos(t), wr+R0*math.sin(t)) for t in [i*math.pi/10 for i in range(11)]] + [(cx-R0, body[-1][1])]
    prism('carroceria', body + arch, W, P, bevel=0.05, seg=3)
    # cabine na cor do carro (teto e colunas) + vidros um pouco mais largos, recortados abaixo do teto
    prism('cabine', cabin, W-0.18, P, bevel=0.02, seg=2)
    zc = roofz - 0.07
    cxm = sum(x for x, z in cabin) / len(cabin)
    win = [(cxm + (x-cxm)*1.05, min(z, zc)) for x, z in cabin]                 # 2% maior: para-brisa e vidro traseiro aparecem
    prism('vidros', win, W-0.15, G, bevel=0.02, seg=1)
    mid = (cabin[1][0] + cabin[2][0]) / 2
    cube('coluna_b', mid-0.04, mid+0.04, -(W-0.14)/2, (W-0.14)/2, cabin[0][1], zc, P)
    for x in (-axle, axle):
        for s in (-1, 1):
            cyl('pneu', x, s*(W/2-0.12)-0.1, wr, wr+0.2, wr, wr, T, 20, axis='Y')
            o = bpy.context.object; o.location = (x, s*(W/2-0.1), wr)
            cyl('aro', x, 0, 0, 0.02, wr*0.62, wr*0.62, R, 16, axis='Y'); a = bpy.context.object; a.location = (x, s*(W/2+0.005), wr)
    fx = max(x for x, z in body); rx = min(x for x, z in body)
    for s in (-1, 1):
        cube('farol', fx-0.08, fx+0.005, s*(W/2-0.12)-0.16, s*(W/2-0.12)+0.16, 0.66, 0.76, Li, bevel=0.01)
        cube('lanterna', rx-0.005, rx+0.06, s*(W/2-0.1)-0.14, s*(W/2-0.1)+0.14, 0.78, 0.9, Ta, bevel=0.01)
        cube('retrovisor', fx-1.45 if False else cabin[-1][0]-0.15, cabin[-1][0]-0.03, s*(W/2)-0.06 if s > 0 else -W/2-0.06, s*(W/2)+0.06 if s > 0 else -W/2+0.06, 0.95, 1.05, P, bevel=0.015)
    cube('grade', fx-0.03, fx+0.008, -0.35, 0.35, 0.42, 0.55, T, bevel=0.01)
    export(fname, 6000)

# hatch (tipo Palio/Onix hatch): 3,90 × 1,65 × 1,50
car('carro_hatch.glb', 3.9, 1.66,
    body=[(-1.95, 0.26), (-1.95, 0.88), (-1.85, 0.95), (0.95, 0.98), (1.82, 0.8), (1.95, 0.6), (1.95, 0.26)],
    cabin=[(-1.8, 0.93), (-1.62, 1.47), (0.15, 1.5), (0.98, 0.97)], roofz=1.5, axle=1.25)
# sedã: 4,50 × 1,75 × 1,46, com porta-malas
car('carro_seda.glb', 4.5, 1.75,
    body=[(-2.25, 0.27), (-2.25, 0.86), (-2.15, 0.96), (-1.4, 0.98), (1.15, 0.96), (2.1, 0.78), (2.25, 0.58), (2.25, 0.27)],
    cabin=[(-1.45, 0.95), (-0.75, 1.43), (0.45, 1.46), (1.2, 0.95)], roofz=1.46, axle=1.35)
# SUV: 4,40 × 1,82 × 1,66
car('carro_suv.glb', 4.4, 1.82,
    body=[(-2.2, 0.33), (-2.2, 1.0), (-2.1, 1.07), (1.25, 1.08), (2.1, 0.95), (2.2, 0.72), (2.2, 0.33)],
    cabin=[(-2.08, 1.04), (-1.95, 1.64), (0.55, 1.66), (1.3, 1.06)], roofz=1.66, axle=1.38, wr=0.35)
