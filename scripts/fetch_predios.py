"""Baixa os prédios do OpenStreetMap no mesmo recorte de data/uberaba/meta.json e grava data/uberaba/predios.json.

Formato (coordenadas locais em DECÍMETROS, mesma projeção das vias):
  {"kinds": [...], "b": [[altura_dm, andares, tipo, [x, z, x, z, ...]], ...]}
altura_dm = 0 quando o OSM não informa altura nem andares (a página estima pelo tipo).

Roda no GitHub Actions (.github/workflows/predios.yml), depois do mapa de Uberaba existir.
"""
import json, math, os, time, urllib.parse, urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'uberaba')
UA = {'User-Agent': 'uberaba-3d (github.com/RafaelAlvesDS)'}


def fetch(url, data, tries=3, timeout=300):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print('  falhou', url[:60], e, flush=True)
            time.sleep(15 * (k + 1))
    raise RuntimeError('falhou ' + url)


def overpass(q):
    body = urllib.parse.urlencode({'data': q}).encode()
    for host in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                 'https://overpass.private.coffee/api/interpreter'):
        try:
            return json.loads(fetch(host, body))
        except Exception as e:  # noqa: BLE001
            print('overpass', host, e, flush=True)
    raise RuntimeError('Overpass indisponível')


def simplify(pts, tol):
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, az), (bx, bz) = pts[i], pts[j]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        best, bi = -1, -1
        for k in range(i + 1, j):
            d = abs((pts[k][0] - ax) * (bz - az) - (pts[k][1] - az) * (bx - ax)) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True; stack += [(i, bi), (bi, j)]
    return [p for p, f in zip(pts, keep) if f]


def main():
    m = json.load(open(os.path.join(OUT, 'meta.json')))
    lat0, lon0, MLAT, MLON = m['lat0'], m['lon0'], m['mLat'], m['mLon']
    x0, z0, W, H = m['x0'], m['z0'], m['w'], m['h']
    # recorte em graus
    n_, s_ = lat0 - z0 / MLAT, lat0 - (z0 + H) / MLAT
    w_, e_ = lon0 + x0 / MLON, lon0 + (x0 + W) / MLON
    loc = lambda la, lo: ((lo - lon0) * MLON, (lat0 - la) * MLAT)

    seen, rings = set(), []
    K = 3
    for a in range(K):
        for b in range(K):
            bb = f'({s_ + (n_ - s_) * a / K},{w_ + (e_ - w_) * b / K},{s_ + (n_ - s_) * (a + 1) / K},{w_ + (e_ - w_) * (b + 1) / K})'
            d = overpass(f'[out:json][timeout:240];(way[building]{bb};relation[building]{bb};);out geom;')
            for el in d.get('elements', []):
                key = (el['type'], el['id'])
                if key in seen:
                    continue
                seen.add(key)
                t = el.get('tags') or {}
                geoms = [el['geometry']] if el['type'] == 'way' and el.get('geometry') else \
                    [mm['geometry'] for mm in el.get('members', []) if mm.get('role') == 'outer' and mm.get('geometry')]
                for g in geoms:
                    if len(g) >= 4 and g[0] == g[-1]:
                        rings.append((t, [loc(p['lat'], p['lon']) for p in g[:-1]]))
            print(f'::notice::pedaço {a * K + b + 1}/{K * K}: {len(rings)} prédios', flush=True)
            time.sleep(3)

    kinds, kix, out = [], {}, []
    for t, pts in rings:
        if len(pts) > 6:
            pts = simplify(pts, 0.4)              # anel aberto (primeiro != último), pontas preservadas
        if len(pts) < 3:
            continue
        area = abs(sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts)))) / 2
        if area < 12:
            continue
        try:
            h = float(str(t.get('height', '0')).replace('m', '').split(';')[0])
        except ValueError:
            h = 0
        try:
            lv = int(float(str(t.get('building:levels', '0')).split(';')[0]))
        except ValueError:
            lv = 0
        k = t.get('building', 'yes')
        if k not in kix:
            kix[k] = len(kinds); kinds.append(k)
        flat = []
        for x, z in pts:
            flat += [round(x * 10), round(z * 10)]
        out.append([round(h * 10), lv, kix[k], flat])
    with open(os.path.join(OUT, 'predios.json'), 'w', encoding='utf-8') as f:
        json.dump({'atualizado': time.strftime('%Y-%m-%d'), 'kinds': kinds, 'b': out}, f, separators=(',', ':'), ensure_ascii=False)
    com_altura = sum(1 for r in out if r[0] or r[1])
    print(f'::notice::{len(out)} prédios ({com_altura} com altura ou andares), '
          f'{os.path.getsize(os.path.join(OUT, "predios.json")) // 1024} KB', flush=True)


if __name__ == '__main__':
    main()
