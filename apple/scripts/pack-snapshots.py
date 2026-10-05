#!/usr/bin/env python3
"""Пережать эталоны снимков без потерь: кодировщик iOS почти не сжимает PNG (снимок 402×874 весил ~700 КБ).

Пересжимаются только данные изображения (IDAT, zlib 9 с подбором фильтров — силами Pillow); все служебные блоки
оригинала остаются как были: цветовой профиль (iCCP), cICP, pHYs, EXIF. Без cICP UIKit раскладывает цвета иначе, и
снимок перестаёт совпадать с эталоном. Выбрасывается только iDOT — подсказка Apple для параллельного чтения, в ней
смещения внутри старых данных. Скрипт проверяет, что пиксели не изменились. Зовёт apple/scripts/test.sh после
записи эталонов (LC_RECORD=1)."""
import glob
import io
import os
import struct
import sys
import zlib

from PIL import Image

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def chunks(data: bytes):
    assert data[:8] == SIGNATURE, 'не PNG'
    i = 8
    while i < len(data):
        (length,) = struct.unpack('>I', data[i:i + 4])
        kind = data[i + 4:i + 8]
        yield kind, data[i + 8:i + 8 + length]
        i += 12 + length


def chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)


def pack(path: str) -> tuple[int, int]:
    original = open(path, 'rb').read()
    with Image.open(io.BytesIO(original)) as im:
        buf = io.BytesIO()
        im.save(buf, format='PNG', optimize=True)
        reference = im.convert('RGBA').tobytes()
    squeezed = buf.getvalue()
    old = list(chunks(original))
    new = list(chunks(squeezed))
    ihdr_old = next(b for k, b in old if k == b'IHDR')
    ihdr_new = next(b for k, b in new if k == b'IHDR')
    if ihdr_old != ihdr_new:
        return len(original), len(original)  # Pillow поменял формат пикселей — оставляем файл как есть
    idat = b''.join(chunk(b'IDAT', b) for k, b in new if k == b'IDAT')
    out = SIGNATURE
    for kind, body in old:
        if kind == b'IDAT':
            if idat:
                out += idat
                idat = b''
        elif kind != b'iDOT':
            out += chunk(kind, body)
    if len(out) >= len(original):
        return len(original), len(original)
    with Image.open(io.BytesIO(out)) as check:
        if check.convert('RGBA').tobytes() != reference:
            sys.exit(f'пережатие изменило пиксели: {path}')
    with open(path, 'wb') as f:
        f.write(out)
    return len(original), len(out)


root = os.path.join(os.path.dirname(__file__), '..', 'AppTests', '__Snapshots__')
before = after = 0
for path in glob.glob(os.path.join(root, '**', '*.png'), recursive=True):
    a, b = pack(path)
    before += a
    after += b
print(f'эталоны снимков: {before / 1e6:.1f} МБ → {after / 1e6:.1f} МБ, пиксели и служебные блоки те же')
