---
name: "site-qa-before-publish"
description: "Use before publishing or sharing any website or web app (PPF, MAD JACK, Trip OS, Research OS). Runs mobile, speed, accessibility, broken-link and basic SEO checks and returns a pass/fail report with fixes."
---

# Site QA Before Publish

A release gate. Nothing gets published until this report has no FAIL items, or the user explicitly accepts the remaining ones.

Rules: reply in Hebrew, short, mobile-friendly. Never claim a check passed unless it was actually run. Every item gets one status: PASS, FAIL, WARN, or NOT CHECKED (with the reason, such as no browser or no network). Do not fix anything before showing the report, unless the user said to fix automatically.

## Step 0: Get the target
- A local HTML file, a folder, a published artifact, or a live URL.
- Note the language and direction (Hebrew RTL or English), and whether it is a single-file site (Tailwind CDN + vanilla JS) or a framework build.

## Step 1: Automatic static scan (always run)
Write this script to the working directory as qa_scan.py and run `python3 -I qa_scan.py <file.html>`. It uses only the standard library.

```python
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
labels={l.get('for') for l in T('label') if l.get('for')}  # a label without "for" must not count as labelling every id-less field
nolab=[i for i in inputs if i.get('id') not in labels and not i.get('aria-label') and not i.get('aria-labelledby')]
r('PASS' if not nolab else 'FAIL','a11y',f'inputs without label: {len(nolab)}')
if any(not l.get('for') for l in T('label')): r('WARN','a11y','some fields are wrapped in <label> (no for=): this scan cannot see that; check them in the browser (accessible name)')
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
```

For a multi-page site, run it on every HTML file.

## Step 2: Live checks (run what the session allows)
- **Broken external links:** check each external URL from Step 1 with WebFetch, or the browser if available. If neither can reach it, mark NOT CHECKED. Never guess.
- **Mobile render:** if a browser tool (Claude in Chrome or the built-in browser) is available, open the page at 360, 390, 768 and 1280px widths and check:
  - no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`)
  - tap targets at least 44x44px, body text at least 16px
  - the hero fits the first screen, the menu opens and closes, RTL mirroring is correct, and numbers and English stay LTR
  - screenshot each width as evidence
- **Reliable browser checks:** in browser scripts, wait for UI state (dialog open or closed, element count, URL hash) instead of fixed sleeps, and run each new check 3 times in a row before calling it PASS. A check that passes only sometimes is FAIL until the race is found. After any UI change (folding, moving, renaming), re-run every older browser script too: old scripts break on new UI before users do.
- **Speed:** if the page is live, suggest a PageSpeed Insights run (pagespeed.web.dev) and record the scores the user or the browser gets. Targets: LCP under 2.5s, CLS under 0.1, mobile Performance 90+. If it cannot be run, mark NOT CHECKED.
- **Contrast:** check text on every background, overlays on photos and video included. Body text needs 4.5:1 and large headlines 3:1. Use the browser's computed colors if available, otherwise estimate and mark it as an estimate.
- **Keyboard:** Tab through the page. Focus must be visible, the order must make sense, and nothing should trap focus (modals, video players).
  - In a native modal `<dialog>`, a Tab that reaches the browser frame (`document.activeElement` is BODY) is not a focus escape: the browser leaves the page there and comes back into the dialog.
  - Check the focus ring on the built-in calendar and clock icons of date and time fields too, not only on the field itself.

## Step 3: Manual checklist (ask the user only for what tools can't see)
- Real content instead of placeholder text (lorem, "Your Title", fake prices or dates)
- Contact details, social links and email are correct
- Videos have a poster image, do not autoplay with sound, and have captions if they contain speech
- No copied logos, posters or client names the user has no rights to
- A 404 page and a favicon exist (for multi-page sites)

## Known false positives
If the project keeps a list of known false positives (for example in its GOALS file or QA evidence), report those items as KNOWN with the reason, and do not count them as FAIL. Anything not on the list is still FAIL. Adding an item to the list needs the user's approval.

## Step 4: Report (one screenful)
```
QA: <site name>  |  FAIL: x  WARN: y  KNOWN: k  NOT CHECKED: z
Must fix before publishing:
1. ...
Worth fixing:
1. ...
Not checked and why:
- ...
```
Group the items by area: mobile, speed, accessibility, links, SEO. Order them by impact. Then ask: fix everything, fix only the must-fix items, or leave it as is.

## Step 5: Fix and re-check
- Fix on a copy, never on the user's original file.
- In a PWA with a cache-first service worker, a fix reaches users only with a new version: raise it in every place it is set (for example package.json, the app config and the service worker's cache name) in the same change.
- After fixing, run Step 1 again, plus the live checks that failed, and show a before/after line with the FAIL counts.
- Publish only when FAIL is 0, or the user approved the remaining items by name.
- Offer to record recurring issues with handoff-and-learning-loop, so the next build avoids them from the start.