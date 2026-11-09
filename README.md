# rafaelalvesds.github.io

Meu GitHub Pages. É onde deixo os experimentos que rodam direto no navegador, quase tudo em three.js e sem build: abriu a página, funciona.

## O que tem aqui

- `index.html`: modelo 3D de uma cobertura duplex, com o entorno (ruas, construções e relevo num raio de 800 m). Dá para girar o modelo, fazer um passeio a pé ou andar em primeira pessoa.
- `uberaba.html`: Uberaba em 3D, montada com dados do OpenStreetMap (vias, áreas, relevo e prédios). Dá para voar pelo mapa ou dirigir. O modo de direção e as corridas de rua com checkpoints estão em `js/corrida.js`, e os prédios em `js/predios.js`.
- `h-racer/`: build web do H-Racer, meu jogo de corrida feito em Godot.
- `loteria.html`: conferidor de jogos da loteria. Marco os números sorteados e ele destaca os acertos nos meus jogos.
- `tcc/`: página de revisão de um artigo (SIMPÓS 2026). Cada citação abre o trecho da fonte, e quem revisa pode comentar. É gerada por `scripts/tcc/gera_site.py`.

## Dados do mapa

Os arquivos de `data/` não são escritos à mão. Os scripts de `scripts/` baixam tudo do OpenStreetMap e o GitHub Actions roda cada um uma vez por mês, para pegar ruas e prédios novos:

| script | workflow | dia | saída |
|---|---|---|---|
| `fetch_uberaba.py` | `uberaba.yml` | 2 | vias, áreas e relevo em `data/uberaba/` |
| `fetch_predios.py` | `predios.yml` | 3 | `data/uberaba/predios.json` |
| `fetch_entorno.py` | `entorno.yml` | 1 | `data/osm.json` e `data/relevo.json`, o entorno da cobertura |

O formato dos arquivos está descrito no começo de cada script. O `sonda-perimetro.yml` foi um teste temporário.

## Rodando localmente

As páginas carregam JSON e binários por `fetch`, então abrir o arquivo direto não funciona. Sobe um servidor estático na pasta:

```
python -m http.server 8000
```

e abre `http://localhost:8000`.

Para regenerar os dados do mapa na sua máquina, `pip install pillow numpy` e `python scripts/fetch_uberaba.py`.

## Modelos 3D de terceiros

Da coleção [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets), com texturas reduzidas para a web:

- `models/sofa.glb` — "Glam Velvet Sofa", © 2021 Wayfair, LLC, por Eric Chadwick. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cor do tecido alterada.
- `models/planta.glb` — "Diffuse Transmission Plant", © 2024 Darmstadt Graphics Group GmbH, por Eric Chadwick ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), a partir de asset CC0 de Rico Cilliers. Geometria simplificada.
- `models/vaso-flores.glb` — "Glass Vase Flowers", Eric Chadwick e Rico Cilliers. [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
