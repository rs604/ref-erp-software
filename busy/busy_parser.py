"""Busy Accounting -> clean rows. Reads any Busy FY database (MS Access .bds)."""
import subprocess, csv, io, os, re, sys

VCH = {'2':'Purchase Bill','9':'Sales Invoice','11':'Delivery Challan',
       '12':'Purchase Order','13':'Sales Order'}
ITEM_RECTYPES = {'2','4'}      # 2 = bills/challans, 4 = orders
TAX_RECTYPE   = '3'

def table(db, t):
    r = subprocess.run(['mdb-export', db, t], capture_output=True, text=True)
    if r.returncode: return []
    return list(csv.DictReader(io.StringIO(r.stdout)))

def clean(s):
    if not s: return ''
    s = str(s).replace('\u201c','"').replace('\u201d','"').replace('\u2018',"'").replace('\u2019',"'")
    s = s.replace('×','x').replace('½','1/2').replace('¼','1/4').replace('¾','3/4')
    return re.sub(r'\s+',' ', s).strip()

def parse_fy(path, company, fy):
    tmp = '/tmp/_busy.mdb'
    subprocess.run(['cp', path, tmp], check=True)
    t1 = table(tmp,'Tran1'); t2 = table(tmp,'Tran2')
    dsc = table(tmp,'ItemDesc'); mas = table(tmp,'Master1')

    name  = {r['Code']: clean(r['Name']) for r in mas}
    desc  = {(r['VchCode'], r['SrNo']): r for r in dsc}
    hdr   = {r['VchCode']: r for r in t1 if r['VchType'] in VCH}

    # tax per voucher
    tax = {}
    for r in t2:
        if r['RecType']==TAX_RECTYPE and r['VchCode'] in hdr:
            nm = name.get(r['MasterCode1'],'')
            if nm.upper() in ('CGST','SGST','IGST','UTGST'):
                d = tax.setdefault(r['VchCode'], {})
                d[nm.upper()] = float(r['Value3'] or 0)
                d['rate'] = float(r['Value1'] or 0)

    out = []
    for r in t2:
        if r['RecType'] not in ITEM_RECTYPES: continue
        h = hdr.get(r['VchCode'])
        if not h: continue

        qty = abs(float(r['Value1'] or 0))
        amt = abs(float(r['Value3'] or 0))
        rate = round(amt/qty, 4) if qty else 0

        d = desc.get((r['VchCode'], r['SrNo']))
        lines = []
        if d:
            for i in range(1,21):
                v = clean(d.get(f'Desc{i}'))
                if v: lines.append(v)
            for i in range(1,5):
                v = clean(d.get(f'Desc{i}SL'))
                if v: lines.append(v)

        t = tax.get(r['VchCode'], {})
        out.append(dict(
            company     = company,
            fy          = fy,
            doc_type    = VCH[h['VchType']],
            vch_type    = h['VchType'],
            vch_no      = clean(h['VchNo']),
            vch_date    = h['Date'][:8],
            party       = name.get(h['MasterCode1'],''),
            sr_no       = r['SrNo'],
            item        = name.get(r['MasterCode1'],''),
            description = ' | '.join(lines),
            qty         = qty,
            rate        = rate,
            amount      = amt,
            cgst        = t.get('CGST',0),
            sgst        = t.get('SGST',0),
            igst        = t.get('IGST',0),
            gst_rate    = t.get('rate',0),
            vch_total   = float(h['VchAmtBaseCur'] or 0),
            search_text = clean(f"{name.get(h['MasterCode1'],'')} {name.get(r['MasterCode1'],'')} {' '.join(lines)}").upper(),
        ))
    return out

if __name__ == '__main__':
    rows = parse_fy(sys.argv[1], sys.argv[2], sys.argv[3])
    print(len(rows), 'rows')
