"""Granada de fragmentação (tipo M67) do battle royale: corpo, espoleta, alavanca (colher) e argola do pino.
Origem no centro do corpo, Z para cima no Blender (= Y no three.js). Uso: python granada.py <pasta>"""
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moveis import reset, mat, cube, cyl, export, finish
OUTD = sys.argv[-1]
import moveis; moveis.OUT = OUTD; moveis.VCOL = True
reset()
OD = mat('verde_oliva', (0.17, 0.2, 0.1), 0.65)
G = mat('gunmetal', (0.25, 0.26, 0.27), 0.35, 0.8)
Y = mat('faixa', (0.75, 0.6, 0.12), 0.6)
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.032, location=(0, 0, 0)); b = bpy.context.object; b.name = 'corpo'; b.scale = (1, 1, 1.12); finish(b, OD)
cyl('faixa', 0, 0, 0.022, 0.027, 0.0225, 0.019, Y, 20)
cyl('espoleta', 0, 0, 0.032, 0.05, 0.011, 0.01, G, 14)
cyl('topo', 0, 0, 0.05, 0.056, 0.012, 0.012, G, 14)
for i, (y0, z0, z1, ang) in enumerate([(0.008, 0.042, 0.054, 0.0), (0.014, -0.005, 0.044, -0.12), (0.022, -0.032, -0.004, -0.38)]):
    c = cube('colher', -0.007, 0.007, y0, y0+0.004, z0, z1, G, bevel=0.0015); c.rotation_euler = (ang, 0, 0)
bpy.ops.mesh.primitive_torus_add(major_radius=0.012, minor_radius=0.0016, major_segments=16, minor_segments=6, location=(-0.016, 0, 0.046), rotation=(0, math.pi/2, 0)); finish(bpy.context.object, G)
cyl('pino', -0.012, 0, 0.0, 0.016, 0.0015, 0.0015, G, 6, axis='X'); bpy.context.object.location = (-0.012, 0, 0.046)
export('granada.glb', 2500)
