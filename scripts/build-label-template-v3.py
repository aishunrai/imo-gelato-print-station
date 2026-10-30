"""Match the original gelato label typography, retaining four variable print fields."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'apps/label-print/public/assets/labels'
NS = {name: f'http://schemas.brother.info/ptouch/2007/lbx/{suffix}' for name, suffix in {
    'pt': 'main', 'style': 'style', 'text': 'text', 'draw': 'draw', 'image': 'image',
    'barcode': 'barcode', 'database': 'database', 'table': 'table', 'cable': 'cable',
}.items()}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)
with ZipFile(ASSETS / 'gelato-label.lbx') as original:
    entries = {name: original.read(name) for name in original.namelist()}
document = ET.fromstring(entries['label.xml'])
paper = ET.tostring(document.find('.//style:paper', NS))
objects = document.find('.//pt:objects', NS)
prototype = deepcopy(objects.find('text:text', NS))
# These are the fonts in the working original LBX, including the bold B font face.
flavor_font = deepcopy(prototype.find('text:ptFontInfo', NS))
date_font = deepcopy(objects.find('text:datetime/text:ptFontInfo', NS))
staff_font = deepcopy(next(item.find('text:ptFontInfo', NS) for item in objects
    if item.find('pt:objectStyle/pt:expanded', NS).get('objectName') == 'STAFF'))
objects.clear()
rows = [
    # name, sample, vertical row, frame thickness, y, frame length, point size, font
    ('FLAVOR', '白桃', 14.4, 23, 18.4, 149.4, 18, flavor_font),
    ('MANUFACTURED_AT', '2026/10/30 15:16', 40.4, 10, 10.4, 154, 9, date_font),
    ('WEIGHT', '正味：2090 g', 51.4, 10, 10.4, 154, 9, staff_font),
    ('STAFF', '担当：桐脇', 62.4, 11, 10.4, 154, 9, staff_font),
]
for name, sample, x, width, y, height, size, font in rows:
    item = deepcopy(prototype)
    style = item.find('pt:objectStyle', NS)
    style.attrib.update(x=f'{x}pt', y=f'{y}pt', width=f'{width}pt', height=f'{height}pt', angle='270')
    style.find('pt:expanded', NS).attrib.update(objectName=name, ID='0', lock='0')
    for child in list(item.findall('text:stringItem', NS)):
        item.remove(child)
    item.remove(item.find('text:ptFontInfo', NS))
    info = deepcopy(font)
    info.find('text:fontExt', NS).attrib.update(size=f'{size}pt', orgSize=f'{size}pt')
    item.insert(1, info)
    item.find('text:textStyle', NS).set('orgPoint', f'{size}pt')
    item.find('text:textControl', NS).attrib.update(shrink='true', autoLF='false')
    item.find('text:textAlign', NS).attrib.update(horizontalAlignment='LEFT', verticalAlignment='TOP')
    item.find('pt:data', NS).text = sample
    string = ET.SubElement(item, f"{{{NS['text']}}}stringItem", {'charLen': str(len(sample))})
    string.append(deepcopy(info))
    objects.append(item)
    assert 8.4 <= x and x + width <= 73.4
    assert 4.3 <= y and y + height <= 171.4
assert paper == ET.tostring(document.find('.//style:paper', NS))
assert not document.findall('.//text:datetime', NS)
entries['label.xml'] = ET.tostring(document, encoding='utf-8', xml_declaration=True)

target = ASSETS / 'gelato-label-v3.lbx'
with ZipFile(target, 'w') as output:
    for name, content in entries.items():
        entry = ZipInfo(name, (2026, 10, 30, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        output.writestr(entry, content)
with ZipFile(target) as output:
    assert output.testzip() is None
print('Built gelato-label-v3.lbx: original bold 18pt heading; 9pt date/time, weight and staff; 62 x 29 mm')
