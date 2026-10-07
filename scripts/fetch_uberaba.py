"""Baixa Uberaba inteira (vias, áreas e relevo) e grava em data/uberaba/ para uberaba.html carregar do próprio site.

Saídas (coordenadas locais em DECÍMETROS, x = leste, z = sul, origem no centro do recorte):
- meta.json    recorte, projeção, grade do relevo e estatísticas
- relevo.bin   altitude em decímetros (Int16, little-endian), grade de 20 m, linhas de norte para sul
- vias.json    grafo de vias para desenhar e dirigir:
                 nodes: [x, z, ...] dos cruzamentos e pontas
                 edges: [a, b, classe, faixas, mão_única, vel_max, nome, flags, [x, z, ...]]
                 paths: [classe, [x, z, ...]] calçadões, ciclovias, trilhas e estradas de terra (só desenho)
- areas.json   polígonos de uso do solo e água, e linhas de rios/córregos

Roda no GitHub Actions (.github/workflows/uberaba.yml).
"""
import io, json, math, os, time, urllib.parse, urllib.request
from collections import Counter
import numpy as np
from PIL import Image

# área folgada; o recorte final é o contorno das ruas residenciais + margem
BIG = (-19.865, -48.045, -19.655, -47.835)          # sul, oeste, norte, leste
MARGIN = 900                                        # metros além dos bairros
CHUNK = 500                                         # tamanho dos blocos do mapa (m)
STEP = 20                                           # grade do relevo (m)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'uberaba')
UA = {'User-Agent': 'uberaba-3d (github.com/RafaelAlvesDS)'}

CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
           'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
           'track', 'footway', 'path', 'cycleway', 'pedestrian', 'steps', 'bridleway']
DRIVE = set(CLASSES[:15])
LINES = set(CLASSES[15:])
AREA_KEYS = ('landuse', 'leisure', 'natural', 'amenity')
AREA_KINDS = {'grass', 'park', 'recreation_ground', 'meadow', 'forest', 'wood', 'scrub', 'grassland', 'wetland',
              'farmland', 'farmyard', 'orchard', 'residential', 'commercial', 'retail', 'industrial', 'water',
              'pitch', 'playground', 'garden', 'cemetery', 'construction', 'brownfield', 'greenfield',
              'golf_course', 'stadium', 'parking', 'basin', 'reservoir', 'village_green', 'military', 'quarry'}


def fetch(url, data=None, tries=4, timeout=420):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print('  falhou', url[:80], e, flush=True)
            time.sleep(10 * (k + 1))
    raise RuntimeError('não consegui baixar ' + url)


def overpass(q):
    body = urllib.parse.urlencode({'data': q}).encode()
    for host in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'):
        try:
            raw = fetch(host, body, tries=2)
            print('overpass', host, len(raw) // 1024, 'KB', flush=True)
            return json.loads(raw)
        except Exception as e:  # noqa: BLE001
            print('overpass', host, e, flush=True)
    raise RuntimeError('Overpass indisponível')


def simplify(pts, tol):
    """Douglas-Peucker; mantém as pontas."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, az), (bx, bz) = pts[i], pts[j]
        vx, vz = bx - ax, bz - az
        L = math.hypot(vx, vz) or 1e-9
        best, bi = -1, -1
        for k in range(i + 1, j):
            px, pz = pts[k]
            d = abs((px - ax) * vz - (pz - az) * vx) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, f in zip(pts, keep) if f]


def flat(pts):
    out = []
    for x, z in pts:
        out += [round(x * 10), round(z * 10)]
    return out


def ring_area(pts):
    a = 0
    for i in range(len(pts)):
        (x1, z1), (x2, z2) = pts[i - 1], pts[i]
        a += x1 * z2 - x2 * z1
    return abs(a) / 2


def main():
    os.makedirs(OUT, exist_ok=True)
    s, w, n, e = BIG
    bb = f'({s},{w},{n},{e})'
    q = (f'[out:json][timeout:600][maxsize:2000000000];'
         f'way[highway]{bb};out body geom;'
         f'(way[landuse]{bb};way[leisure]{bb};way[natural~"^(water|wood|scrub|grassland|wetland)$"]{bb};'
         f'way[amenity=parking]{bb};way[waterway~"^(river|stream|canal|drain)$"]{bb};'
         f'relation[type=multipolygon][~"^(landuse|natural|leisure)$"~"."]{bb};);out geom;')
    data = overpass(q)
    els = data.get('elements', [])
    print(len(els), 'elementos', flush=True)

    # --- recorte: onde há ruas residenciais
    lats, lons = [], []
    for el in els:
        t = el.get('tags') or {}
        if el['type'] == 'way' and t.get('highway') in ('residential', 'living_street') and el.get('geometry'):
            for g in el['geometry']:
                lats.append(g['lat']); lons.append(g['lon'])
    lats, lons = np.array(lats), np.array(lons)
    la0, la1 = np.percentile(lats, [0.3, 99.7])
    lo0, lo1 = np.percentile(lons, [0.3, 99.7])
    lat0, lon0 = (la0 + la1) / 2, (lo0 + lo1) / 2
    phi = math.radians(lat0)
    M_LAT = 111132.954 - 559.822 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    M_LON = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    W = math.ceil(((lo1 - lo0) * M_LON + 2 * MARGIN) / CHUNK) * CHUNK
    H = math.ceil(((la1 - la0) * M_LAT + 2 * MARGIN) / CHUNK) * CHUNK
    X0, Z0 = -W / 2, -H / 2
    print(f'recorte {W/1000:.1f} km x {H/1000:.1f} km, centro {lat0:.5f},{lon0:.5f}', flush=True)

    def loc(lat, lon):
        return (lon - lon0) * M_LON, (lat0 - lat) * M_LAT

    def inside(pts, pad=150):
        xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
        return max(xs) > X0 - pad and min(xs) < X0 + W + pad and max(zs) > Z0 - pad and min(zs) < Z0 + H + pad

    # --- vias
    names, name_ix = [], {}
    def nm(t):
        v = t.get('name') or t.get('ref')
        if not v:
            return -1
        if v not in name_ix:
            name_ix[v] = len(names); names.append(v)
        return name_ix[v]

    ways = []
    for el in els:
        t = el.get('tags') or {}
        hw = t.get('highway')
        if el['type'] != 'way' or hw not in CLASSES or not el.get('geometry') or t.get('area') == 'yes':
            continue
        pts = [loc(g['lat'], g['lon']) for g in el['geometry']]
        if len(pts) < 2 or not inside(pts):
            continue
        ways.append((el, t, hw, pts))

    uses = Counter()
    for el, t, hw, pts in ways:
        if hw in DRIVE:
            ns = el['nodes']
            uses.update(ns)
            uses[ns[0]] += 1; uses[ns[-1]] += 1

    nodes, node_ix, edges, paths = [], {}, [], []
    def node(nid, p):
        if nid not in node_ix:
            node_ix[nid] = len(nodes) // 2; nodes.extend([round(p[0] * 10), round(p[1] * 10)])
        return node_ix[nid]

    for el, t, hw, pts in ways:
        if hw in LINES:
            paths.append([CLASSES.index(hw), flat(simplify(pts, 0.8))])
            continue
        ns = el['nodes']
        if len(ns) != len(pts):
            continue
        ow = t.get('oneway', '')
        rev = ow == '-1'
        oneway = 1 if (ow in ('yes', '1', 'true', '-1') or t.get('junction') in ('roundabout', 'circular')
                       or (hw == 'motorway' and ow != 'no')) else 0
        try:
            lanes = int(str(t.get('lanes', '0')).split(';')[0])
        except ValueError:
            lanes = 0
        try:
            ms = int(str(t.get('maxspeed', '0')).split()[0])
        except ValueError:
            ms = 0
        flags = ((1 if t.get('bridge') not in (None, 'no') else 0) | (2 if t.get('tunnel') not in (None, 'no') else 0)
                 | (4 if t.get('access') in ('private', 'no') else 0)
                 | (8 if t.get('junction') in ('roundabout', 'circular') else 0)
                 | (16 if t.get('service') in ('parking_aisle', 'driveway', 'drive-through') else 0))
        cls, name = CLASSES.index(hw), nm(t)
        cut = [0] + [i for i in range(1, len(ns) - 1) if uses[ns[i]] >= 2] + [len(ns) - 1]
        for i, j in zip(cut, cut[1:]):
            seg = simplify(pts[i:j + 1], 0.4)
            a, b = node(ns[i], pts[i]), node(ns[j], pts[j])
            if rev:
                a, b, seg = b, a, seg[::-1]
            if a == b and len(seg) < 3:
                continue
            edges.append([a, b, cls, lanes, oneway, ms, name, flags, flat(seg)])

    # --- áreas e rios
    kinds, kind_ix, areas, rivers = [], {}, [], []
    def kind(k):
        if k not in kind_ix:
            kind_ix[k] = len(kinds); kinds.append(k)
        return kind_ix[k]

    def add_ring(geom, k):
        pts = [loc(g['lat'], g['lon']) for g in geom]
        if len(pts) < 4 or not inside(pts, 0):
            return
        pts = simplify(pts[:-1], 1.2)
        if len(pts) >= 3 and ring_area(pts) > 60:
            areas.append([kind(k), flat(pts)])

    for el in els:
        t = el.get('tags') or {}
        if 'highway' in t and el['type'] == 'way':
            continue
        if el['type'] == 'way' and t.get('waterway') and el.get('geometry'):
            pts = [loc(g['lat'], g['lon']) for g in el['geometry']]
            if inside(pts, 0):
                rivers.append([kind(t['waterway']), flat(simplify(pts, 1.0))])
            continue
        k = next((t[key] for key in AREA_KEYS if t.get(key) in AREA_KINDS), None)
        if t.get('natural') == 'water' or t.get('water'):
            k = 'water'
        if not k:
            continue
        if el['type'] == 'way' and el.get('geometry'):
            g = el['geometry']
            if g[0] == g[-1]:
                add_ring(g, k)
        elif el['type'] == 'relation':
            for m in el.get('members', []):
                g = m.get('geometry')
                if m.get('role') == 'outer' and g and g[0] == g[-1]:
                    add_ring(g, k)

    # --- relevo (SRTM via AWS Terrain Tiles, formato Terrarium)
    Z = 14
    N = 2 ** Z
    nx, nz = W // STEP + 1, H // STEP + 1
    gx = X0 + np.arange(nx) * STEP
    gz = Z0 + np.arange(nz) * STEP
    LON = lon0 + gx[None, :] / M_LON + 0 * gz[:, None]
    LAT = lat0 - gz[:, None] / M_LAT + 0 * gx[None, :]
    fx = (LON + 180) / 360 * N * 256 - 0.5
    fy = (1 - np.arcsinh(np.tan(np.radians(LAT))) / np.pi) / 2 * N * 256 - 0.5
    tx0, tx1 = int(fx.min() // 256), int((fx.max() + 1) // 256)
    ty0, ty1 = int(fy.min() // 256), int((fy.max() + 1) // 256)
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float64)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            png = fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png')
            a = np.asarray(Image.open(io.BytesIO(png)).convert('RGB'), dtype=np.float64)
            mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
                a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    print('relevo:', (tx1 - tx0 + 1) * (ty1 - ty0 + 1), 'tiles', flush=True)
    px, py = fx - tx0 * 256, fy - ty0 * 256
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    u, v = px - ix, py - iy
    m = mosaic
    elev = (m[iy, ix] * (1 - u) * (1 - v) + m[iy, ix + 1] * u * (1 - v)
            + m[iy + 1, ix] * (1 - u) * v + m[iy + 1, ix + 1] * u * v)
    dm = np.round(elev * 10).astype('<i2')
    dm.tofile(os.path.join(OUT, 'relevo.bin'))

    meta = {'fonte': {'vias': 'OpenStreetMap (ODbL)', 'relevo': 'SRTM via AWS Terrain Tiles (Terrarium)'},
            'atualizado': time.strftime('%Y-%m-%d'), 'lat0': lat0, 'lon0': lon0, 'mLat': M_LAT, 'mLon': M_LON,
            'x0': X0, 'z0': Z0, 'w': W, 'h': H, 'chunk': CHUNK, 'step': STEP, 'nx': int(nx), 'nz': int(nz),
            'altMin': float(elev.min()), 'altMax': float(elev.max()),
            'contagem': {'nos': len(nodes) // 2, 'trechos': len(edges), 'caminhos': len(paths), 'areas': len(areas),
                         'rios': len(rivers)}}
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'vias.json'), 'w', encoding='utf-8') as f:
        json.dump({'classes': CLASSES, 'names': names, 'nodes': nodes, 'edges': edges, 'paths': paths}, f,
                  separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(OUT, 'areas.json'), 'w', encoding='utf-8') as f:
        json.dump({'kinds': kinds, 'areas': areas, 'rivers': rivers}, f, separators=(',', ':'), ensure_ascii=False)
    print(json.dumps(meta['contagem']), f"alt {meta['altMin']:.0f}-{meta['altMax']:.0f} m", flush=True)
    for fn in ('relevo.bin', 'vias.json', 'areas.json'):
        print(fn, os.path.getsize(os.path.join(OUT, fn)) // 1024, 'KB')


if __name__ == '__main__':
    main()
