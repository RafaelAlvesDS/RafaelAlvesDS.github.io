"""Baixa o entorno do apartamento e grava em data/ para o site carregar sem depender de APIs externas.

- data/osm.json    ruas, construções, áreas verdes e árvores (OpenStreetMap, raio de 800 m)
- data/relevo.json altitude em metros numa malha de 2,4 km x 2,4 km com nós a cada 20 m (SRTM via tiles Terrarium)

Roda no GitHub Actions (.github/workflows/entorno.yml). A geometria usa as mesmas constantes do index.html.
"""
import io, json, math, os, time, urllib.parse, urllib.request
from PIL import Image

LAT0, LON0 = -19.7373341602545, -47.8937048567169
ANCHOR = (3.45, 54.6 - 3)            # centro do apto 12 no modelo (x, z)
M_LAT = 110600
M_LON = 111320 * math.cos(math.radians(LAT0))
SPAN, SEG = 2400, 120
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
UA = {'User-Agent': 'cobertura-3d (github.com/RafaelAlvesDS)'}


def w2geo(x, z):
    return LAT0 - (x - ANCHOR[0]) / M_LAT, LON0 - (z - ANCHOR[1]) / M_LON


def fetch(url, data=None, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print('  falhou', url[:70], e)
            time.sleep(5 * (k + 1))
    raise RuntimeError('não consegui baixar ' + url)


def osm():
    a = f'(around:800,{LAT0},{LON0})'
    q = (f'[out:json][timeout:90];(way{a}[highway];way{a}[building];way{a}[landuse];way{a}[leisure];'
         f'way{a}[natural];node(around:500,{LAT0},{LON0})[natural=tree];);out geom;')
    body = urllib.parse.urlencode({'data': q}).encode()
    for host in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'):
        try:
            raw = json.loads(fetch(host, body, tries=2))
            break
        except Exception as e:  # noqa: BLE001
            print('overpass', host, e)
    else:
        raise RuntimeError('Overpass indisponível')
    keep = {'highway', 'name', 'building', 'height', 'building:levels', 'landuse', 'leisure', 'natural', 'lanes'}
    els = []
    for el in raw.get('elements', []):
        tags = {k: v for k, v in (el.get('tags') or {}).items() if k in keep}
        if el['type'] == 'node':
            els.append({'type': 'node', 'lat': round(el['lat'], 6), 'lon': round(el['lon'], 6), 'tags': tags})
        elif el.get('geometry'):
            els.append({'type': 'way', 'tags': tags,
                        'geometry': [{'lat': round(g['lat'], 6), 'lon': round(g['lon'], 6)} for g in el['geometry']]})
    return {'source': 'OpenStreetMap (ODbL)', 'fetched': time.strftime('%Y-%m-%d'), 'elements': els}


def relevo():
    Z = 13
    N = 2 ** Z
    tiles = {}

    def merc(lat, lon):
        r = math.radians(lat)
        return (lon + 180) / 360 * N, (1 - math.asinh(math.tan(r)) / math.pi) / 2 * N

    def tile(tx, ty):
        key = (tx, ty)
        if key not in tiles:
            png = fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png')
            tiles[key] = Image.open(io.BytesIO(png)).convert('RGB').load()
        return tiles[key]

    def at(X, Y):
        p = tile(X // 256, Y // 256)[X % 256, Y % 256]
        return p[0] * 256 + p[1] + p[2] / 256 - 32768

    def elev(lat, lon):
        fx, fy = merc(lat, lon)
        px, py = fx * 256 - 0.5, fy * 256 - 0.5
        ix, iy = math.floor(px), math.floor(py)
        u, v = px - ix, py - iy
        return (at(ix, iy) * (1 - u) * (1 - v) + at(ix + 1, iy) * u * (1 - v)
                + at(ix, iy + 1) * (1 - u) * v + at(ix + 1, iy + 1) * u * v)

    n = SEG + 1
    step = SPAN / SEG
    x0, z0 = ANCHOR[0] - SPAN / 2, ANCHOR[1] - SPAN / 2
    grid = []
    for j in range(n):
        for i in range(n):
            grid.append(round(elev(*w2geo(x0 + i * step, z0 + j * step)), 1))
    return {'source': 'SRTM via AWS Terrain Tiles (Terrarium)', 'fetched': time.strftime('%Y-%m-%d'),
            'x0': x0, 'z0': z0, 'span': SPAN, 'seg': SEG, 'elev': grid}


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    r = relevo()
    with open(os.path.join(OUT, 'relevo.json'), 'w') as f:
        json.dump(r, f, separators=(',', ':'))
    print('relevo ok', min(r['elev']), max(r['elev']))
    o = osm()
    with open(os.path.join(OUT, 'osm.json'), 'w', encoding='utf-8') as f:
        json.dump(o, f, separators=(',', ':'), ensure_ascii=False)
    print('osm ok', len(o['elements']), 'elementos')
