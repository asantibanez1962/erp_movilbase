"""
Genera los logos IMPRESOS de todos los clientes, en las dos formas que hacen falta.

    assets/clientes/impreso/<cliente>.png   →   src/lib/logosImpresos.ts

De cada PNG salen dos representaciones de la MISMA imagen:

  · PNG monocromo como data URI, para el HTML del recibo y de la remedida.
  · Ráster ESC/POS en base64, para la bitácora, que va por socket directo.

── POR QUÉ UN LOGO APARTE Y NO EL DE LA INTERFAZ ───────────────────────────────

El logo de `clientes.json` es a color y está pensado para la pantalla. La térmica sólo
sabe MARCAR O NO MARCAR el punto: no hay grises ni tintas. Un logo a color hay que
umbralizarlo igual, y los degradados y las líneas finas se convierten en manchas.

Así que el logo impreso se prepara aparte, a mano, en blanco y negro puro. Conviene
además que **no lleve el nombre de la empresa**: el comprobante ya lo imprime debajo, y
repetido en un dibujo de 1 bit se lee peor que el texto.

── CÓMO PREPARARLO ─────────────────────────────────────────────────────────────

Un PNG en blanco y negro, sin transparencia, de unos 320 puntos de ancho. A los 203 dpi
de estas impresoras eso son unos 40 mm — algo más de la mitad del papel. Más ancho no
entra; más angosto se ve pobre.

Ejecutar:  python scripts/logos-impresos.py
"""

import base64
import io
import json
import os
import struct
import zlib

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(AQUI)
ORIGEN = os.path.join(APP, "assets", "clientes", "impreso")
DESTINO = os.path.join(APP, "src", "lib", "logosImpresos.ts")

# Ancho al que se lleva cualquier logo, en puntos de impresora. 320 ≈ 40 mm a 203 dpi.
ANCHO_OBJETIVO = 320
# Por debajo de este gris el punto se imprime. 0 es negro, 255 blanco.
UMBRAL = 128


def leer_png(ruta):
    """Devuelve (ancho, alto, gris[]) de un PNG de 8 bits, sin entrelazar."""
    d = io.open(ruta, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{ruta}: no es un PNG")

    pos, idat, paleta, trns = 8, b"", None, None
    ancho = alto = prof = color = entrelazado = None
    while pos < len(d):
        ln = struct.unpack_from(">I", d, pos)[0]
        tipo = d[pos + 4 : pos + 8]
        dat = d[pos + 8 : pos + 8 + ln]
        if tipo == b"IHDR":
            ancho, alto, prof, color, _, _, entrelazado = struct.unpack(">IIBBBBB", dat[:13])
        elif tipo == b"PLTE":
            paleta = dat
        elif tipo == b"tRNS":
            trns = dat
        elif tipo == b"IDAT":
            idat += dat
        pos += 12 + ln

    if prof not in (1, 2, 4, 8) or entrelazado != 0:
        raise SystemExit(
            f"{ruta}: se admite PNG de 1, 2, 4 u 8 bits sin entrelazar "
            f"(tiene {prof} bits, entrelazado={entrelazado}). Reexportalo así."
        )
    canales = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
    if canales is None:
        raise SystemExit(f"{ruta}: tipo de color {color} no soportado")

    raw = zlib.decompress(idat)
    # Con menos de 8 bits los píxeles vienen EMPAQUETADOS y el filtro trabaja sobre bytes
    # con un paso de 1 — no de un píxel. Es el caso de un logo ya monocromo.
    paso = (ancho * canales * prof + 7) // 8
    filtro_bpp = max(1, canales * prof // 8)
    maximo = (1 << prof) - 1
    prev = bytearray(paso)
    gris = []
    i = 0
    for _ in range(alto):
        f = raw[i]
        i += 1
        fila = bytearray(raw[i : i + paso])
        i += paso
        for x in range(paso):  # deshace el filtro PNG
            a = fila[x - filtro_bpp] if x >= filtro_bpp else 0
            b = prev[x]
            c = prev[x - filtro_bpp] if x >= filtro_bpp else 0
            if f == 1:
                fila[x] = (fila[x] + a) & 255
            elif f == 2:
                fila[x] = (fila[x] + b) & 255
            elif f == 3:
                fila[x] = (fila[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                fila[x] = (fila[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = fila

        # Desempaqueta a un valor por canal, sea cual sea la profundidad.
        if prof == 8:
            muestras = list(fila)
        else:
            muestras = []
            for by in fila:
                for k in range(8 // prof):
                    muestras.append((by >> (8 - prof * (k + 1))) & maximo)
            muestras = muestras[: ancho * canales]

        linea = []
        for x in range(ancho):
            px = [
                v if prof == 8 else v * 255 // maximo
                for v in muestras[x * canales : (x + 1) * canales]
            ]
            # En paleta el índice NO se escala: es un número, no un nivel de gris.
            if color == 3:
                px = muestras[x * canales : (x + 1) * canales]
            if color == 3:
                idx = px[0] * 3
                r, g, b_, alfa = paleta[idx], paleta[idx + 1], paleta[idx + 2], 255
                if trns and px[0] < len(trns):
                    alfa = trns[px[0]]
            elif color in (0, 4):
                r = g = b_ = px[0]
                alfa = px[1] if color == 4 else 255
            else:
                r, g, b_ = px[0], px[1], px[2]
                alfa = px[3] if color == 6 else 255
            v = (r * 299 + g * 587 + b_ * 114) // 1000
            # Lo transparente se toma como blanco: si no, el fondo sale todo negro.
            linea.append(255 if alfa < 128 else v)
        gris.append(linea)
    return ancho, alto, gris


def a_monocromo(ancho, alto, gris, ancho_objetivo):
    """Reescala por promedio de bloque y umbraliza. Devuelve (ancho, alto, bits[][])."""
    if ancho <= ancho_objetivo:
        escala = 1
        nuevo_ancho, nuevo_alto = ancho, alto
    else:
        escala = ancho / ancho_objetivo
        nuevo_ancho = ancho_objetivo
        nuevo_alto = max(1, round(alto / escala))

    bits = []
    for y in range(nuevo_alto):
        fila = []
        y0, y1 = int(y * escala), max(int(y * escala) + 1, int((y + 1) * escala))
        for x in range(nuevo_ancho):
            x0, x1 = int(x * escala), max(int(x * escala) + 1, int((x + 1) * escala))
            muestras = [
                gris[yy][xx]
                for yy in range(y0, min(y1, alto))
                for xx in range(x0, min(x1, ancho))
            ]
            promedio = sum(muestras) // len(muestras) if muestras else 255
            fila.append(1 if promedio < UMBRAL else 0)  # 1 = se imprime
        bits.append(fila)
    return nuevo_ancho, nuevo_alto, bits


def a_png(ancho, alto, bits):
    """PNG gris de 1 bit. En PNG el 1 es BLANCO, al revés que en ESC/POS."""
    fila_bytes = (ancho + 7) // 8
    crudo = b""
    for fila in bits:
        b = bytearray(fila_bytes)
        for x, v in enumerate(fila):
            if not v:  # 0 = no imprime = blanco
                b[x // 8] |= 0x80 >> (x % 8)
        crudo += b"\x00" + bytes(b)

    def trozo(tipo, datos):
        return (
            struct.pack(">I", len(datos))
            + tipo
            + datos
            + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 1, 0, 0, 0, 0))
        + trozo(b"IDAT", zlib.compress(crudo, 9))
        + trozo(b"IEND", b"")
    )


def a_escpos(ancho, alto, bits):
    """Mapa de bits crudo para `GS v 0`. Acá el 1 SÍ imprime."""
    fila_bytes = (ancho + 7) // 8
    datos = bytearray()
    for fila in bits:
        b = bytearray(fila_bytes)
        for x, v in enumerate(fila):
            if v:
                b[x // 8] |= 0x80 >> (x % 8)
        datos += b
    return fila_bytes, bytes(datos)


def main():
    if not os.path.isdir(ORIGEN):
        raise SystemExit(f"No existe {ORIGEN}")

    # El catálogo manda, igual que con la IP y el color: si un cliente no declara
    # `logoImpreso`, su APK sale sin logo en el papel y eso se ve acá, no en la cosecha.
    catalogo = json.load(io.open(os.path.join(APP, "clientes.json"), encoding="utf-8"))
    partes = []
    for cliente, cfg in catalogo.items():
        if cliente.startswith("_"):
            continue
        archivo = cfg.get("logoImpreso")
        if not archivo:
            print(f"  {cliente}: sin logoImpreso en clientes.json — su papel sale sin logo")
            continue
        ruta = os.path.join(ORIGEN, archivo)
        if not os.path.exists(ruta):
            raise SystemExit(
                f"{cliente}: clientes.json declara logoImpreso={archivo} pero no existe {ruta}"
            )
        ancho, alto, gris = leer_png(ruta)
        na, nal, bits = a_monocromo(ancho, alto, gris, ANCHO_OBJETIVO)
        png = a_png(na, nal, bits)
        fila_bytes, crudo = a_escpos(na, nal, bits)
        print(f"  {cliente}: {ancho}x{alto} -> {na}x{nal}  ({len(png)} B PNG, {len(crudo)} B ESC/POS)")
        partes.append(
            f'  {cliente}: {{\n'
            f'    png: "data:image/png;base64,{base64.b64encode(png).decode()}",\n'
            f"    anchoBytes: {fila_bytes},\n"
            f"    alto: {nal},\n"
            f'    escpos:\n      "{base64.b64encode(crudo).decode()}",\n'
            f"  }},"
        )

    io.open(DESTINO, "w", encoding="utf-8").write(
        "// GENERADO POR scripts/logos-impresos.py — NO EDITAR A MANO.\n"
        "//\n"
        "// El logo que sale en el PAPEL, uno por cliente. Se prepara aparte del logo de la\n"
        "// interfaz porque la térmica sólo sabe marcar o no marcar el punto: no hay grises.\n"
        "// Para cambiarlo, reemplazar assets/clientes/impreso/<cliente>.png y correr el script.\n"
        "//\n"
        "// De cada imagen salen dos formas: `png` para el HTML del recibo y la remedida, y\n"
        "// `escpos` para la bitácora, que va por socket directo. ⚠️ Los bits van AL REVÉS entre\n"
        "// las dos: en PNG el 1 es blanco, en ESC/POS el 1 imprime.\n"
        "\n"
        "export interface LogoImpreso {\n"
        "  /** Data URI, para usar en un <img>. */\n"
        "  png: string;\n"
        "  /** Ancho en BYTES —no en puntos—, como lo pide el comando GS v 0. */\n"
        "  anchoBytes: number;\n"
        "  /** Alto en puntos. */\n"
        "  alto: number;\n"
        "  /** El mapa de bits crudo, en base64. */\n"
        "  escpos: string;\n"
        "}\n"
        "\n"
        "export const LOGOS_IMPRESOS: Record<string, LogoImpreso> = {\n"
        + "\n".join(partes)
        + "\n};\n"
    )
    print(f"escrito {DESTINO}")


if __name__ == "__main__":
    main()
