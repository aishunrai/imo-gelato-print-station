"""Build the v2 LBX from the original template, retaining Brother paper metadata."""
from pathlib import Path
from copy import deepcopy
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'apps/label-print/public/assets/labels'
NS = {name: f'http://schemas.brother.info/ptouch/2007/lbx/{suffix}' for name, suffix in {
    'pt':'main', 'style':'style', 'text':'text', 'draw':'draw', 'image':'image',
    'barcode':'barcode', 'database':'database', 'table':'table', 'cable':'cable',
}.items()}
for name, uri in NS.items():
    ET.register_namespace(name, uri)
with ZipFile(ASSETS / 'gelato-label.lbx') as original:
    entries = {name: original.read(name) for name in original.namelist()}
root = ET.fromstring(entries['label.xml'])
objects = root.find('.//pt:objects', NS)
prototype = deepcopy(objects.find('text:text', NS))
objects.clear()
rows = [
    ('FLAVOR', 'ピスタチオ', 10.4, 19, 14),
    ('MANUFACTURED_AT', '製造 2026/10/15 14:35', 32.4, 10, 8),
    ('WEIGHT', '正味 2000 g', 45.4, 10, 9),
    ('STAFF', '担当 製造担当', 58.4, 10, 8),
]
for name, sample, x, width, font_size in rows:
    item = deepcopy(prototype)
    style = item.find('pt:objectStyle', NS)
    style.attrib.update(x=f'{x}pt', y='10.4pt', width=f'{width}pt', height='154pt', angle='270')
    expanded = style.find('pt:expanded', NS)
    expanded.attrib.update(objectName=name, ID='0', lock='0')
    for old in list(item.findall('text:stringItem', NS)):
        item.remove(old)
    for font in item.findall('.//text:logFont', NS):
        font.attrib.update(name='ＭＳ ゴシック', charSet='128', pitchAndFamily='49', weight='400')
    for ext in item.findall('.//text:fontExt', NS):
        ext.attrib.update(size=f'{font_size}pt', orgSize=f'{font_size}pt')
    item.find('text:textStyle', NS).set('orgPoint', f'{font_size}pt')
    item.find('text:textControl', NS).attrib.update(shrink='true', autoLF='false')
    item.find('text:textAlign', NS).attrib.update(horizontalAlignment='LEFT', verticalAlignment='TOP')
    item.find('pt:data', NS).text = sample
    string = ET.SubElement(item, f"{{{NS['text']}}}stringItem", {'charLen':str(len(sample))})
    string.append(deepcopy(item.find('text:ptFontInfo', NS)))
    objects.append(item)
entries['label.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
target = ASSETS / 'gelato-label-v2.lbx'
with ZipFile(target, 'w', ZIP_DEFLATED) as output:
    for name, value in entries.items():
        output.writestr(name, value)
print(f'Built {target.name}: 4 fields, 62 x 29 mm')
