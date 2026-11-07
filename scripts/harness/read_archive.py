"""Read recruitment evidence without extracting or executing archive contents."""
import hashlib
import json
import re
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

archive, destination = map(Path, sys.argv[1:])
with zipfile.ZipFile(archive) as z:
    entries = {}
    for info in z.infolist():
        name = info.filename.replace('\\', '/')
        if name.endswith('/'):
            continue
        if name.startswith('/') or ':' in name or '..' in PurePosixPath(name).parts:
            raise ValueError('Unsafe archive member')
        if name in entries:
            raise ValueError('Duplicate archive member')
        if info.file_size > 100 * 1024 * 1024:
            raise ValueError('Archive member too large')
        entries[name] = info
    roots = {name.split('/')[0] for name in entries}
    if len(roots) != 1:
        raise ValueError('Expected one archive root')
    root = roots.pop() + '/'
    def read(name):
        return z.read(entries[root + name])
    def obj(name):
        return json.loads(read(name).decode('utf-8-sig'))
    counts = Counter(name[len(root):].split('/')[0] for name in entries)
    images = {}
    for name in entries:
        relative = name[len(root):]
        if relative.startswith('05_简历截图/') and relative.endswith('.png'):
            data = read(relative)
            if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
                raise ValueError('Invalid PNG header')
            width, height = struct.unpack('>II', data[16:24])
            if not width or not height:
                raise ValueError('Invalid PNG dimensions')
            key = PurePosixPath(relative).stem
            if key in images:
                raise ValueError('Duplicate screenshot identity')
            images[key] = dict(width=width, height=height, sha256=hashlib.sha256(data).hexdigest())
    folders = sorted({name[len(root):].split('/')[1] for name in entries if name.startswith(root+'03_OCR文本/')})
    samples = []
    for folder in folders:
        prefix = '03_OCR文本/' + folder + '/'
        text = read(prefix+'text.txt').decode('utf-8-sig')
        have_boxes = root+prefix+'boxes.json' in entries
        have_raw = root+prefix+'raw.json' in entries
        if have_boxes != have_raw:
            raise ValueError('Incomplete OCR artifact pair')
        raw = obj(prefix+'raw.json') if have_raw else None
        if raw is not None and raw.get('type') == 'split-manifest':
            # The original source timestamp disambiguates anonymized duplicate names.
            identities = set()
            for part in raw['parts']:
                source = part['imagePath'].replace('\\', '/')
                match = re.search(r'/(?:preview|online-resume)-([^/]+)-(\d+)\.png\.ocr/', source)
                if not match:
                    raise ValueError('Unrecognized split source identity')
                identities.add(match[1]+'_'+match[2])
            if len(identities) != 1:
                raise ValueError('Split parts have different screenshot identities')
            image = images.get(identities.pop())
        else:
            matches = [im for key, im in images.items() if re.sub(r'_\d+$', '', key) == folder]
            image = matches[0] if len(matches) == 1 else None
        sample = dict(id=hashlib.sha256(folder.encode()).hexdigest()[:16], image=image, text=text)
        if have_boxes:
            sample.update(boxes=obj(prefix+'boxes.json'), raw=raw, status='ready')
        else:
            if '未做' not in text or 'OCR' not in text.upper():
                raise ValueError('Missing OCR artifacts without explicit placeholder')
            sample['status'] = 'not-ocr'
        samples.append(sample)
    ledgers = [obj(name[len(root):]) for name in entries if name.startswith(root+'06_账本快照/') and name.endswith('.json')]
    pdfs = [name for name in entries if name.startswith(root+'04_简历PDF/') and name.endswith('.pdf')]
    if any(not z.read(entries[name]).startswith(b'%PDF-') for name in pdfs):
        raise ValueError('Invalid PDF header')
    payload = dict(archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(), counts=dict(counts),
                   imageCount=len(images), pdfCount=len(pdfs), samples=samples, ledgers=ledgers)
    destination.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(dict(files=len(entries), images=len(images), ocrFolders=len(samples), pdfs=len(pdfs), ledgers=len(ledgers))))
