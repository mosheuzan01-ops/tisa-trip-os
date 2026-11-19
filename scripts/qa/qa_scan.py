import sys, re, os
from html.parser import HTMLParser

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.t=[]; s.stack=[]; s.title=''; s.in_title=False
    def handle_starttag(s, tag, a):
        s.t.append((tag, dict(a)));
        if tag=='title': s.in_title=True
    def handle_endtag(s, tag):
        if tag=='title': s.in_title=False
    def handle_data(s, d):
        if s.in_title: s.title+=d

path=sys.argv[1]; html=open(path,encoding='utf-8').read(); p=P(); p.feed(html)
T=lambda n:[a for t,a in p.t if t==n]
out=[]
def r(st,area,msg): out.append(f'{st:5} | {area:6} | {msg}')
h=T('html'); ha=h[0] if h else {}
r('PASS' if ha.get('lang') else 'FAIL','a11y',f"html lang={ha.get('lang')}")
if ha.get('lang','').startswith('he'): r('PASS' if ha.get('dir')=='rtl' else 'FAIL','mobile',f"dir={ha.get('dir')}")
vp=[m for m in T('meta') if m.get('name')=='viewport']
r('PASS' if vp and 'width=device-width' in vp[0].get('content','') else 'FAIL','mobile','viewport meta')
if vp and re.search(r'user-scalable=no|maximum-scale=1(\.0)?\b',vp[0].get('content','')): r('FAIL','a11y','zoom is blocked in viewport')
tl=len(p.title.strip()); r('PASS' if 10<=tl<=60 else 'WARN' if tl else 'FAIL','seo',f'title length {tl}')
d=[m for m in T('meta') if m.get('name')=='description']; dl=len(d[0].get('content','')) if d else 0
r('PASS' if 50<=dl<=160 else 'WARN' if dl else 'FAIL','seo',f'meta description length {dl}')
r('PASS' if len(T('h1'))==1 else 'FAIL','seo',f"h1 count {len(T('h1'))}")
for k in ['og:title','og:description','og:image']:
    r('PASS' if any(m.get('property')==k for m in T('meta')) else 'WARN','seo',k)
r('PASS' if any('icon' in (l.get('rel') or '') for l in T('link')) else 'WARN','seo','favicon')
imgs=T('img'); noalt=[i.get('src','?') for i in imgs if 'alt' not in i]
r('PASS' if not noalt else 'FAIL','a11y',f'images without alt: {len(noalt)} {noalt[:5]}')
nolazy=[i for i in imgs[2:] if i.get('loading')!='lazy']
r('PASS' if not nolazy else 'WARN','speed',f'images below the fold without loading=lazy: {len(nolazy)}')
nosize=[i.get('src','?') for i in imgs if not (i.get('width') and i.get('height'))]
r('PASS' if not nosize else 'WARN','speed',f'images without width/height (layout shift): {len(nosize)}')
for i in imgs:
    s=i.get('src','')
    if s and not s.startswith(('http','data:')):
        f=os.path.join(os.path.dirname(path),s)
        if not os.path.exists(f): r('FAIL','links',f'missing image file {s}')
        elif os.path.getsize(f)>300_000: r('WARN','speed',f'large image {s} {os.path.getsize(f)//1024}KB')
links=T('a')
for a in links:
    hr=a.get('href')
    if hr is None or hr.strip() in ('','#','javascript:void(0)'): r('FAIL','links',f'empty or placeholder link: {a}')
    elif hr.startswith('#') and not re.search(r'id=["\']'+re.escape(hr[1:])+r'["\']',html): r('FAIL','links',f'anchor target missing {hr}')
    elif a.get('target')=='_blank' and 'noopener' not in (a.get('rel') or ''): r('WARN','links',f'target=_blank without rel=noopener {hr}')
ext=sorted({a.get('href') for a in links if (a.get('href') or '').startswith('http')})
r('INFO ','links',f'{len(ext)} external links to check online: {ext[:20]}')
for b in T('button'):
    if not b.get('aria-label') and not b.get('title'): pass
inputs=[i for i in T('input') if i.get('type') not in ('hidden','submit','button')]
labels={l.get('for') for l in T('label')}
nolab=[i for i in inputs if i.get('id') not in labels and not i.get('aria-label')]
r('PASS' if not nolab else 'FAIL','a11y',f'inputs without label: {len(nolab)}')
click_div=len(re.findall(r'<(div|span)[^>]*onclick',html,re.I))
r('PASS' if not click_div else 'WARN','a11y',f'clickable div/span (use button/a): {click_div}')
r('PASS' if 'prefers-reduced-motion' in html else 'WARN','a11y','prefers-reduced-motion handled')
r('WARN' if 'cdn.tailwindcss.com' in html else 'PASS','speed','Tailwind Play CDN in use (fine for prototypes; for a public launch consider a built CSS file)')
fonts=re.findall(r'fonts.googleapis.com/css2\?([^"\']+)',html)
fam=sum(f.count('family=') for f in fonts)
r('PASS' if fam<=3 else 'WARN','speed',f'web font families: {fam}')
r('PASS' if 'display=swap' in html or not fonts else 'WARN','speed','font-display swap')
kb=len(html.encode())//1024; r('PASS' if kb<500 else 'WARN','speed',f'HTML size {kb}KB')
print('\n'.join(out))
