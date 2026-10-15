"""Gera a página de revisão do artigo (GitHub Pages) a partir do artigo montado.
Cada citação vira um destaque clicável que mostra a página e o trecho literal da fonte (site_citacoes.json) e abre a
fonte; quem revisa pode selecionar trechos e deixar comentários, salvos no navegador e exportáveis em Markdown.
Uso (na raiz deste repositório): python scripts/tcc/gera_site.py <artigo .docx> scripts/tcc/site_citacoes.json tcc
Ao mudar o texto ou as citações do artigo, atualizar site_citacoes.json: o script para se alguma citação ficar sem
evidência ou sem referência."""
import html
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import quote

import docx
from docx.oxml.ns import qn

DOCX, EVID, SAIDA = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
SECOES = ('INTRODUÇÃO', 'MATERIAL E MÉTODOS', 'RESULTADOS E DISCUSSÃO', 'CONCLUSÃO', 'REFERÊNCIAS')
d = docx.Document(DOCX)
evid = json.loads(EVID.read_text(encoding='utf-8'))


# ------------------------------------------------------------------ equações (OMML -> LaTeX para o KaTeX)
GREGO = {'β': r'{\beta}', 'ε': r'{\varepsilon}', 'Δ': r'{\Delta}', '∈': r'\in ', '×': r'\times ', '−': '-'}
OPERADOR = {'∑': r'\sum', '∏': r'\prod', '∫': r'\int'}


def tex_texto(r):
    t = ''.join(x.text or '' for x in r.iter(M + 't'))
    # como no Word: tipo reto só nos trechos marcados como texto normal (m:nor) ou estilo plano (m:sty); o resto em itálico
    plano = r.find(f'{M}rPr/{M}nor') is not None or r.find(f'{M}rPr/{M}sty') is not None
    if plano and not any(c in GREGO for c in t):
        return r'\mathrm{' + t.replace('_', r'\_') + '}'
    return ''.join(GREGO.get(c, c) for c in t)


def tex(el):
    tag = el.tag.replace(M, '')
    filhos = lambda nome: el.find(M + nome)
    if tag == 'r':
        return tex_texto(el)
    if tag in ('oMath', 'e', 'num', 'den', 'sub', 'sup', 'fName', 'lim'):
        return ''.join(tex(c) for c in el if c.tag.startswith(M) and not c.tag.endswith('Pr'))
    if tag == 'sSub':
        return '{' + tex(filhos('e')) + '}_{' + tex(filhos('sub')) + '}'
    if tag == 'sSup':
        return '{' + tex(filhos('e')) + '}^{' + tex(filhos('sup')) + '}'
    if tag == 'sSubSup':
        return '{' + tex(filhos('e')) + '}_{' + tex(filhos('sub')) + '}^{' + tex(filhos('sup')) + '}'
    if tag == 'f':
        return r'\frac{' + tex(filhos('num')) + '}{' + tex(filhos('den')) + '}'
    if tag == 'd':
        pr = filhos('dPr')
        ab = pr.find(M + 'begChr') if pr is not None else None
        fe = pr.find(M + 'endChr') if pr is not None else None
        a = ab.get(M + 'val') if ab is not None else '('
        f = fe.get(M + 'val') if fe is not None else ')'
        partes = [tex(e) for e in el.findall(M + 'e')]
        return r'\left' + (a or '.') + ','.join(partes) + r'\right' + (f or '.')
    if tag == 'nary':
        pr = filhos('naryPr')
        ch = pr.find(M + 'chr') if pr is not None else None
        op = OPERADOR.get(ch.get(M + 'val'), r'\int') if ch is not None else r'\int'
        sub, sup = filhos('sub'), filhos('sup')
        esconde = pr is not None and pr.find(M + 'supHide') is not None
        s = op
        if sub is not None and len(tex(sub)):
            s += '_{' + tex(sub) + '}'
        if sup is not None and not esconde and len(tex(sup)):
            s += '^{' + tex(sup) + '}'
        return s + ' ' + tex(filhos('e'))
    if tag == 'func':
        nome = ''.join(x.text or '' for x in filhos('fName').iter(M + 't'))
        return '\\' + nome + ' ' + tex(filhos('e')) if nome in ('ln', 'log', 'exp') else tex(filhos('fName')) + tex(filhos('e'))
    if tag == 'acc':
        return r'\hat{' + tex(filhos('e')) + '}'
    return ''.join(tex(c) for c in el if c.tag.startswith(M) and not c.tag.endswith('Pr'))


# ------------------------------------------------------------------ citações
def chave(texto_cit):
    """'BASSO; NEVES; GROSSI-DE-SÁ, 2024' / 'Amaral et al. (2024)' / 'REPRODUÇÃO [...], 2025' -> 'BASSO2024'"""
    ano = re.findall(r'\d{4}', texto_cit)[-1]
    autor = re.split(r'[\s;,(]', texto_cit.strip('('))[0]
    autor = unicodedata.normalize('NFKD', autor).encode('ascii', 'ignore').decode().upper()
    return autor + ano


AUT = r'[A-ZÀ-Ú][A-ZÀ-Ú\- ]+(?: \[\.\.\.\])?(?: et al\.)?'
RE_CIT = re.compile(r'\((' + AUT + r'(?:; ' + AUT + r')*, \d{4})\)|\b([A-Z][a-zà-ú]+(?: et al\.)? \(\d{4}\))')
ocorrencias = []          # na ordem do texto
usadas = set()


def evidencia(par_texto, cit, n):
    for k, e in enumerate(evid['citacoes']):
        if par_texto.startswith(e['par']) and e['cit'] == cit and e['n'] == n:
            usadas.add(k)
            return e
    raise SystemExit(f'sem evidência: {cit} (n={n}) no parágrafo "{par_texto[:60]}"')


def frase_de(texto, ini, fim):
    a = max(texto.rfind('. ', 0, ini), texto.rfind('; ', 0, ini))
    a = 0 if a < 0 else a + 2
    b = texto.find('. ', fim)
    return texto[a:(len(texto) if b < 0 else b + 1)].strip()


# ------------------------------------------------------------------ texto dos parágrafos
def runs_formatados(p_el):
    """[(texto, italico, negrito, sobrescrito) | ('$math', latex)] com runs de mesmo formato unidos."""
    out = []
    for ch in p_el:
        if ch.tag == qn('w:r'):
            t = ''.join(x.text or '' for x in ch.findall(qn('w:t')))
            if not t:
                continue
            rpr = ch.find(qn('w:rPr'))
            on = lambda tag: rpr is not None and rpr.find(qn(tag)) is not None and \
                rpr.find(qn(tag)).get(qn('w:val')) in (None, '1', 'true')
            va = rpr.find(qn('w:vertAlign')) if rpr is not None else None
            fmt = (on('w:i'), on('w:b'), va.get(qn('w:val')) if va is not None else None)
            if out and out[-1][0] != '$math' and out[-1][1:] == fmt:
                out[-1] = (out[-1][0] + t,) + fmt
            else:
                out.append((t,) + fmt)
        elif ch.tag == M + 'oMath':
            out.append(('$math', tex(ch)))
        elif ch.tag == qn('w:hyperlink'):
            out += runs_formatados(ch)
    return out


def html_par(p_el, com_citacoes=True):
    partes = runs_formatados(p_el)
    texto = ''.join(r[0] for r in partes if r[0] != '$math')
    vistos = {}
    pos = 0
    saida = []
    for r in partes:
        if r[0] == '$math':
            saida.append(f'<span class="math" data-tex="{html.escape(r[1])}"></span>')
            continue
        t, it, ng, va = r
        seg = []
        ultimo = 0
        for m in (RE_CIT.finditer(t) if com_citacoes else []):
            cit = m.group(1) or m.group(2)
            vistos[cit] = vistos.get(cit, 0) + 1
            e = evidencia(texto, cit, vistos[cit])
            i = len(ocorrencias)
            ocorrencias.append({'cit': cit, 'ref': chave(cit), 'frase': frase_de(texto, pos + m.start(), pos + m.end()),
                                'trechos': e['trechos'], 'nota': e.get('nota')})
            seg.append(html.escape(t[ultimo:m.start()]))
            seg.append(f'<a class="cit" href="#cit-{i + 1}" id="cit-{i + 1}" data-c="{i}">{html.escape(m.group(0))}</a>')
            ultimo = m.end()
        seg.append(html.escape(t[ultimo:]))
        s = ''.join(seg)
        pos += len(t)
        if va == 'superscript':
            s = f'<sup>{s}</sup>'
        if it:
            s = f'<em>{s}</em>'
        if ng:
            s = f'<strong>{s}</strong>'
        saida.append(s)
    return ''.join(saida), texto


def texto_el(el):
    return ''.join(t.text or '' for t in el.iter(qn('w:t')))


def tem_img(el):
    return el.find('.//' + qn('w:drawing')) is not None


def estilo(el):
    s = el.find(f'{qn("w:pPr")}/{qn("w:pStyle")}')
    return s.get(qn('w:val')) if s is not None else ''


def todo_negrito(el):
    rs = [r for r in el.findall(qn('w:r')) if texto_el(r).strip()]
    return rs and all(r.find(f'{qn("w:rPr")}/{qn("w:b")}') is not None for r in rs)


def todo_italico(el):
    rs = [r for r in el.findall(qn('w:r')) if texto_el(r).strip()]
    return rs and all(r.find(f'{qn("w:rPr")}/{qn("w:i")}') is not None for r in rs)


def tamanho(el):
    r = next((r for r in el.findall(qn('w:r')) if texto_el(r).strip()), None)
    sz = r.find(f'{qn("w:rPr")}/{qn("w:sz")}') if r is not None else None
    return int(sz.get(qn('w:val'))) / 2 if sz is not None else 12


def html_tabela(tbl):
    linhas = []
    abertas = {}           # coluna -> célula <td> aberta por vMerge (para somar rowspan)
    for ri, tr in enumerate(tbl.findall(qn('w:tr'))):
        cels = []
        col = 0
        for tc in tr.findall(qn('w:tc')):
            pr = tc.find(qn('w:tcPr'))
            span = pr.find(qn('w:gridSpan')) if pr is not None else None
            span = int(span.get(qn('w:val'))) if span is not None else 1
            vm = pr.find(qn('w:vMerge')) if pr is not None else None
            if vm is not None and vm.get(qn('w:val')) != 'restart':
                abertas[col]['rowspan'] += 1
                col += span
                continue
            conteudo = '<br>'.join(html_par(p, com_citacoes=False)[0] for p in tc.findall(qn('w:p')) if texto_el(p).strip())
            cel = {'tag': 'th' if ri == 0 or (ri == 1 and abertas) else 'td', 'span': span, 'rowspan': 1,
                   'html': conteudo, 'num': bool(re.fullmatch(r'[-−<>\d,.\s%()OB:]+', texto_el(tc).strip() or 'x'))}
            if vm is not None:
                abertas[col] = cel
            cels.append(cel)
            col += span
        linhas.append(cels)
    out = ['<div class="tabela"><table>']
    for ri, cels in enumerate(linhas):
        out.append('<tr>')
        for c in cels:
            at = (f' colspan="{c["span"]}"' if c['span'] > 1 else '') + (f' rowspan="{c["rowspan"]}"' if c['rowspan'] > 1 else '')
            classe = ' class="n"' if c['num'] and c['tag'] == 'td' else ''
            out.append(f'<{c["tag"]}{at}{classe}>{c["html"]}</{c["tag"]}>')
        out.append('</tr>')
    out.append('</table></div>')
    return ''.join(out)


# ------------------------------------------------------------------ percorre o corpo
SAIDA.mkdir(parents=True, exist_ok=True)
(SAIDA / 'fig').mkdir(exist_ok=True)
corpo = []
refs_abnt = {}
filhos = list(d.element.body)
n_par = n_fig = 0
secao = ''
lista_aberta = False
na_ref = False
i = 0
cabecalho = {}
while i < len(filhos):
    el = filhos[i]
    i += 1
    if el.tag == qn('w:tbl'):
        corpo.append(html_tabela(el))
        continue
    if el.tag != qn('w:p'):
        continue
    t = texto_el(el).strip()
    eh_lista = estilo(el) == 'PargrafodaLista'
    if lista_aberta and not eh_lista:
        corpo.append('</ul>')
        lista_aberta = False
    if tem_img(el):
        n_fig += 1
        blip = el.find('.//' + qn('a:blip'))
        arq = f'figura{n_fig}.png'
        (SAIDA / 'fig' / arq).write_bytes(d.part.related_parts[blip.get(qn('r:embed'))].blob)
        leg = filhos[i]
        fonte = filhos[i + 1] if texto_el(filhos[i + 1]).startswith('Fonte:') else None
        i += 2 if fonte is not None else 1
        corpo.append(f'<figure id="figura-{n_fig}"><a href="fig/{arq}" target="_blank" rel="noopener">'
                     f'<img src="fig/{arq}" alt="{html.escape(texto_el(leg))}" loading="lazy"></a><figcaption>'
                     f'{html_par(leg)[0]}' + (f'<span class="fonte">{html.escape(texto_el(fonte))}</span>' if fonte is not None else '')
                     + '</figcaption></figure>')
        continue
    if not t and el.find('.//' + M + 'oMath') is None:
        continue
    if not cabecalho.get('titulo'):
        cabecalho['titulo'] = t
        continue
    if t.startswith('Rafael Alves dos SANTOS'):
        cabecalho['autores'] = html_par(el, com_citacoes=False)[0]
        continue
    if re.match(r'^\(\d\)', t) and 'Instituto Federal' in t:
        cabecalho.setdefault('afil', []).append(html_par(el, com_citacoes=False)[0])
        continue
    if t.startswith('RESUMO'):
        h, _ = html_par(el)
        corpo.append(f'<section class="resumo" id="resumo"><h2>Resumo</h2><p id="p{n_par + 1}" data-sec="Resumo">'
                     + re.sub(r'^<strong>RESUMO</strong>:?\s*', '', h) + '</p>')
        n_par += 1
        secao = 'Resumo'
        continue
    if t.startswith('Palavras-Chave'):
        corpo.append(f'<p class="chave">{html_par(el, com_citacoes=False)[0]}</p></section>')
        continue
    if t in SECOES:
        secao = t.capitalize() if t != 'MATERIAL E MÉTODOS' else 'Material e Métodos'
        secao = {'Resultados e discussão': 'Resultados e Discussão', 'Referências': 'Referências',
                 'Introdução': 'Introdução', 'Conclusão': 'Conclusão'}.get(secao, secao)
        na_ref = t == 'REFERÊNCIAS'
        ident = unicodedata.normalize('NFKD', secao).encode('ascii', 'ignore').decode().lower().replace(' ', '-')
        corpo.append(f'<h2 id="{ident}">{html.escape(secao)}</h2>')
        if na_ref:
            corpo.append('<ol class="referencias">')
        continue
    if na_ref:
        # chave = 1º sobrenome + ano (último ano antes do DOI/URL), como nas citações; a CNA é autora entidade
        antes = re.split(r'DOI:|Disponível em', t)[0]
        ano = re.findall(r'\b(?:19|20)\d{2}\b', antes)[-1]
        k = chave(('CNA' if t.startswith('CNA') else t.split(',')[0].split('.')[0]) + ', ' + ano)
        refs_abnt[k] = t
        corpo.append(f'<li id="ref-{k}">' + re.sub(r'(https?://[^\s<]+?)(?=\.?(\s|$))', r'<a href="\1" target="_blank" '
                                                    r'rel="noopener">\1</a>', html.escape(t)) + '</li>')
        continue
    if el.find('.//' + M + 'oMathPara') is not None and not t:
        om = el.find('.//' + M + 'oMath')
        corpo.append(f'<div class="eq"><span class="math display" data-tex="{html.escape(tex(om))}"></span></div>')
        continue
    if re.match(r'^Tabela \d+\.', t):
        corpo.append(f'<p class="leg-tab" id="{t.split(".")[0].lower().replace(" ", "-")}">{html_par(el, False)[0]}</p>')
        continue
    if todo_negrito(el) and len(t) < 120:
        nivel = 'h4' if todo_italico(el) else 'h3'
        corpo.append(f'<{nivel}>{html.escape(t)}</{nivel}>')
        continue
    h, _ = html_par(el)
    n_par += 1
    if eh_lista:
        if not lista_aberta:
            corpo.append('<ul>')
            lista_aberta = True
        corpo.append(f'<li id="p{n_par}" data-sec="{html.escape(secao)}">{h}</li>')
        continue
    classe = ' class="nota"' if tamanho(el) <= 10 else ''
    corpo.append(f'<p id="p{n_par}"{classe} data-sec="{html.escape(secao)}">{h}</p>')
if na_ref:
    corpo.append('</ol>')

# ------------------------------------------------------------------ checagens
faltam = [e for k, e in enumerate(evid['citacoes']) if k not in usadas]
assert not faltam, ('evidências não usadas', [(e['par'], e['cit']) for e in faltam])
sem_ref = sorted({o['ref'] for o in ocorrencias} - set(refs_abnt))
assert not sem_ref, ('citação sem referência na lista', sem_ref, sorted(refs_abnt))
sem_link = sorted(set(refs_abnt) - set(evid['refs']))
assert not sem_link, ('referência sem link em site_citacoes.json', sem_link)


def fragmento(texto):
    """Fragmento de texto (#:~:text=) com o início e o fim do primeiro trecho contínuo, para o navegador destacar."""
    seg = texto.split('(...)')[0].strip().rstrip('.')
    pal = seg.split()
    enc = lambda s: quote(s, safe='').replace('-', '%2D')
    if len(pal) <= 8:
        return '#:~:text=' + enc(seg)
    return '#:~:text=' + enc(' '.join(pal[:5])) + ',' + enc(' '.join(pal[-5:]))


refs = {}
for k, r in evid['refs'].items():
    refs[k] = dict(r, abnt=refs_abnt[k])
for o in ocorrencias:
    r = refs[o['ref']]
    for tr in o['trechos']:
        # 'sem_fragmento': trecho que não está no HTML da fonte (só no PDF), conferido com o texto da página
        if r.get('html') and not tr.get('sem_fragmento'):
            tr['link'] = r['url'] + fragmento(tr['texto'])
        elif r.get('pdf') and tr.get('pdf'):
            tr['link'] = f"{r['pdf']}#page={tr['pdf']}"
        else:
            tr['link'] = r['url']

dados = json.dumps({'citacoes': ocorrencias, 'refs': refs}, ensure_ascii=False).replace('</', '<\\/')
modelo = (Path(__file__).parent / 'site_modelo.html').read_text(encoding='utf-8')
pagina = (modelo.replace('{{TITULO}}', html.escape(cabecalho['titulo']))
          .replace('{{AUTORES}}', cabecalho['autores'])
          .replace('{{AFILIACOES}}', ''.join(f'<p>{a}</p>' for a in cabecalho['afil']))
          .replace('{{CORPO}}', '\n'.join(corpo))
          .replace('{{N_CIT}}', str(len(ocorrencias)))
          .replace('{{DADOS}}', dados))
(SAIDA / 'index.html').write_text(pagina, encoding='utf-8')
print(f'ok: {SAIDA / "index.html"} | parágrafos {n_par} | figuras {n_fig} | citações {len(ocorrencias)} | '
      f'referências {len(refs_abnt)}')
