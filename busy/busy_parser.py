"""Busy Accounting -> clean rows. Reads any Busy FY database (.bds, MS Access).

REQUIRES mdbtools. A pure-Python reader (access-parser) was tried and rejected:
it reads 9 of Raghbir's 24 files and fails on all 15 files from before 2024,
on overflow pages it cannot follow. It works perfectly on a recent file, which
is exactly what makes it a trap.

Outputs TWO row kinds:
  kind='item'    item lines from bills, challans and orders
  kind='ledger'  ledger postings from payments and journals

Unique key: company + fy + vch_code + sr_no.
vch_no CANNOT be used - blank on every ledger row, and it repeats among items.
"""
import subprocess, csv, io, re, sys

PARSER_VERSION = '2026.09.17-mdbtools'

VCH = {'2':'Purchase Bill','9':'Sales Invoice','11':'Delivery Challan',
       '12':'Purchase Order','13':'Sales Order','16':'Journal','19':'Payment'}
ITEM_VCH   = {'2','9','11','12','13'}
LEDGER_VCH = {'16','19'}
ITEM_RECTYPES = {'2','4'}

def table(db, t):
    r = subprocess.run(['mdb-export', db, t], capture_output=True, text=True)
    if r.returncode: return []
    return list(csv.DictReader(io.StringIO(r.stdout)))

def clean(s):
    if not s: return ''
    s = str(s).replace('\u201c','"').replace('\u201d','"').replace('\u2018',"'").replace('\u2019',"'")
    s = s.replace('\u00d7','x').replace('\u00bd','1/2').replace('\u00bc','1/4').replace('\u00be','3/4')
    return re.sub(r'\s+',' ', s).strip()

def isodate(s):
    """Busy writes MM/DD/YY. Confirmed across all 24 files: first part never
    above 12, second reaches 31. Converted explicitly, never by automatic cast."""
    if not s: return ''
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', str(s))
    if not m: return ''
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100: yy += 2000 if yy < 70 else 1900
    return f'{yy:04d}-{mm:02d}-{dd:02d}'

def parse_fy(path, company, fy):
    tmp = '/tmp/_busy.mdb'
    subprocess.run(['cp', path, tmp], check=True)
    t1 = table(tmp,'Tran1'); t2 = table(tmp,'Tran2')
    dsc = table(tmp,'ItemDesc'); mas = table(tmp,'Master1')

    name   = {r['Code']: clean(r['Name']) for r in mas}
    parent = {r['Code']: r['ParentGrp'] for r in mas}
    desc   = {(r['VchCode'], r['SrNo']): r for r in dsc}
    hdr    = {r['VchCode']: r for r in t1 if r['VchType'] in VCH}

    tax = {}
    for r in t2:
        if r['RecType']=='3' and r['VchCode'] in hdr:
            nm = name.get(r['MasterCode1'],'').upper()
            if nm in ('CGST','SGST','IGST','UTGST'):
                d = tax.setdefault(r['VchCode'], {})
                d[nm] = float(r['Value3'] or 0); d['rate'] = float(r['Value1'] or 0)

    out = []
    for r in t2:
        h = hdr.get(r['VchCode'])
        if not h: continue
        vt = h['VchType']
        base = dict(company=company, fy=fy, doc_type=VCH[vt], vch_type=vt,
                    vch_code=r['VchCode'], vch_no=clean(h['VchNo']),
                    vch_date=isodate(h['Date']), sr_no=r['SrNo'],
                    vch_total=float(h['VchAmtBaseCur'] or 0),
                    parser_version=PARSER_VERSION)

        if vt in ITEM_VCH and r['RecType'] in ITEM_RECTYPES:
            qty = abs(float(r['Value1'] or 0)); amt = abs(float(r['Value3'] or 0))
            d = desc.get((r['VchCode'], r['SrNo'])); lines = []
            if d:
                for i in range(1,21):
                    v = clean(d.get(f'Desc{i}'))
                    if v: lines.append(v)
                for i in range(1,5):
                    v = clean(d.get(f'Desc{i}SL'))
                    if v: lines.append(v)
            t = tax.get(r['VchCode'], {})
            party = name.get(h['MasterCode1'],''); item = name.get(r['MasterCode1'],'')
            out.append(dict(base, kind='item', party=party, item=item,
                description=' | '.join(lines), ledger='', ledger_group='',
                debit=0, credit=0, qty=qty,
                rate=round(amt/qty,4) if qty else 0, amount=amt,
                is_lump_sum=(qty==0 and amt>0),
                cgst=t.get('CGST',0), sgst=t.get('SGST',0), igst=t.get('IGST',0),
                gst_rate=t.get('rate',0),
                search_text=clean(f"{party} {item} {' '.join(lines)}").upper()))

        elif vt in LEDGER_VCH and r['RecType']=='1':
            v = float(r['Value1'] or 0)
            led = name.get(r['MasterCode1'],''); grp = name.get(parent.get(r['MasterCode1'],''),'')
            nar = clean(r.get('ShortNar'))
            out.append(dict(base, kind='ledger', party=name.get(h['MasterCode1'],''),
                item='', description=nar, ledger=led, ledger_group=grp,
                debit=v if v>0 else 0, credit=-v if v<0 else 0,
                qty=0, rate=0, amount=abs(v), is_lump_sum=False,
                cgst=0, sgst=0, igst=0, gst_rate=0,
                search_text=clean(f"{led} {grp} {nar}").upper()))
    return out

if __name__ == '__main__':
    print(len(parse_fy(sys.argv[1], sys.argv[2], sys.argv[3])), 'rows')
