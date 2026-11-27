"""
Prepara el PNG de origen que `logos-impresos.py` consume, a partir del logo a color.

    logo de marca (color)  →  assets/clientes/impreso/<cliente>.png  →  logos-impresos.py

`logos-impresos.py` dice en su cabecera que el logo impreso "se prepara aparte, a
mano". Esto es ese paso a mano, automatizado hasta donde se puede: el ojo sigue
decidiendo qué forma va sólida y cuál en contorno, pero la separación de formas y
el trazo los hace el script.

── CÓMO SE USA ─────────────────────────────────────────────────────────────────

Primero preguntarle al logo qué colores de marca tiene:

    python scripts/preparar-logo-impreso.py logo.png --listar

Después generar, diciendo qué hacer con cada uno:

    python scripts/preparar-logo-impreso.py logo.png \
        --contorno 6b4932 --solido 5a7445 \
        --salida assets/clientes/impreso/marespi.png

Y por último, como siempre:  python scripts/logos-impresos.py

── LOGOS DE TONO CONTINUO: --silueta ───────────────────────────────────────────

Lo de arriba sirve cuando la marca son FORMAS PLANAS. La Eva no lo es: su lapa es
una ilustración fotorrealista de 150 mil colores, así que ningún tono suyo junta
superficie y `--listar` sólo encuentra el naranja de la elipse. Buscar colores de
referencia ahí no lleva a ningún lado.

`--silueta` toma TODO lo que tenga tinte y no se haya asignado a un color nombrado,
y lo trata como una sola forma sólida. No reproduce el dibujo —en 1 bit no hay con
qué— pero conserva el contorno, que es lo que hace reconocible a un animal.

    python scripts/preparar-logo-impreso.py assets/clientes/laeva.png \
        --contorno a85602 --silueta --cerrar \
        --excluir 405,758,1302,848 \
        --salida assets/clientes/impreso/laeva.png

  · `--contorno a85602` es la elipse, que sí es plana y maciza llenaría el papel.
  · `--excluir` borra la franja del nombre. Va por REGIÓN y no por color porque el
    azul del texto (#0020a2) NO se separa del morado del ala por distancia: con la
    tolerancia que piden los bordes suavizados se lleva ala y cola, 173.960 px. El
    discriminador que sí funciona es espacial — el nombre es una banda horizontal.
    Las coordenadas son del PNG de origen, a tamaño completo.
  · `--cerrar` tapa los pinchazos blancos que dejan los brillos de la ilustración y
    que en el papel se leen como suciedad, no como dibujo.

El contorno NO sirve para una silueta orgánica: la lapa en contorno deja de parecer
un ave. Para una ilustración, sólida; el contorno es para formas planas y grandes.

── POR QUÉ NO ALCANZA CON UMBRALIZAR EL LOGO A COLOR ───────────────────────────

Tres cosas rompen la conversión directa, y las tres dan un resultado que parece
bien hasta que se mira de cerca:

1. El nombre de la empresa sale impreso. No debe ir: el comprobante ya lo pone
   como texto debajo, y en 1 bit a 203 dpi se lee peor que el texto.

2. Un relleno macizo gasta demasiada tinta. La taza de Marespi sólida da 40% —
   justo donde `logos-impresos.py` empieza a avisar—; en contorno baja a 8.8%.
   Referencias ya en el repo: Cordillera 15.8%, Altura 2%.

3. El fondo puede estar a un pelo del umbral. El recorte viejo de Marespi tenía
   fondo `#dcdbd6`, luminancia 218: zafaba del umbral 210 por ocho niveles. Con
   un logo de fondo transparente o blanco puro eso no pasa.

── DEPENDENCIA ─────────────────────────────────────────────────────────────────

Usa Pillow:  pip install Pillow

`iconos.js` y `logos-impresos.py` son a propósito sin dependencias, pero eso es
para lo que corre en cada compilación. Esto se ejecuta una vez por cliente, a
mano, cuando llega su logo; no entra en el build. Decodificar PNG a color a mano
serían 120 líneas repetidas de `logos-impresos.py` para nada.
"""

import argparse
import os
import sys
from collections import Counter

try:
    from PIL import Image, ImageFilter
except ImportError:
    raise SystemExit("Falta Pillow. Instalalo con:  pip install Pillow")

# La consola de Windows sale en cp1252 y se come los acentos y las rayas de este
# script. Mismo problema que obliga a `sqlcmd -f 65001` con los .sql del backend.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def pixeles(imagen):
    """Los píxeles como secuencia plana, sin el aviso de obsolescencia de Pillow 12."""
    return getattr(imagen, "get_flattened_data", imagen.getdata)()

# Ancho en puntos de impresora, el mismo que usa logos-impresos.py. 320 ≈ 40 mm a 203 dpi.
ANCHO_OBJETIVO = 320
# Margen blanco alrededor, para que el cabezal no imprima pegado al borde.
MARGEN = 6
# Qué tan lejos puede estar un píxel de un color de marca y seguir contando como suyo.
# 70 hace falta para los bordes suavizados; más bajo deja las curvas dentadas.
TOLERANCIA = 70

# ⚠️ LA COMPUERTA QUE EVITA QUE EL TEXTO SE CUELE.
#
# El nombre de la empresa es negro sobre fondo claro, y los dos son neutros. Pero su
# antialias —la rampa de grises del borde de cada letra— pasa JUSTO por valores
# parecidos al café, al terracota o al verde oliva. Filtrar sólo por distancia de
# color mete todas las letras en la máscara, dibujadas como contornos huecos.
#
# Las formas de marca tienen tinte; el texto y el fondo no. Exigir croma los separa
# de un saque. 25 deja pasar hasta un verde oliva apagado (#5a7445 tiene 47).
CROMA_MINIMO = 25


def croma(pixel):
    return max(pixel) - min(pixel)


def aplanar(ruta):
    """Abre el PNG y lo compone sobre BLANCO.

    Lo transparente tiene que leerse como papel. Si se convierte a RGB sin componer,
    el alfa se descarta y lo transparente queda en negro: se imprime el fondo entero.
    """
    imagen = Image.open(ruta).convert("RGBA")
    lienzo = Image.new("RGBA", imagen.size, (255, 255, 255, 255))
    lienzo.alpha_composite(imagen)
    return lienzo.convert("RGB")


def listar_colores(imagen, cuantos=12):
    """Los colores con tinte que hay en el logo, de más a menos superficie."""
    total = imagen.size[0] * imagen.size[1]
    cuenta = Counter(p for p in pixeles(imagen) if croma(p) >= CROMA_MINIMO)
    return [(c, n * 100 / total) for c, n in cuenta.most_common(cuantos)]


def distancia2(pixel, referencia):
    return sum((a - b) ** 2 for a, b in zip(pixel, referencia))


def repartir(imagen, referencias, recoger_resto=False):
    """Una máscara por color de marca, cada píxel al MÁS CERCANO.

    Con `recoger_resto` devuelve además una máscara con todo lo que tiene tinte y no
    quedó cerca de ningún color nombrado: es la silueta de las formas de tono
    continuo, que no se pueden describir con colores de referencia.

    ⚠️ No es lo mismo que probar cada color por separado, y la diferencia muerde.
    En Marespi la taza (#6b4932) y el grano (#5a7445) están a 50 unidades de
    distancia, MENOS que la tolerancia de 70 que piden los bordes suavizados: probando
    por separado, la taza entera entra también en la máscara del grano y todas las
    variantes terminan arrastrando el relleno macizo.

    La pista de que está pasando es que dos variantes distintas dan EXACTAMENTE el
    mismo porcentaje de tinta.
    """
    ancho, alto = imagen.size
    mascaras = [Image.new("L", imagen.size, 0) for _ in referencias]
    resto = Image.new("L", imagen.size, 0)
    origen = imagen.load()
    destinos = [m.load() for m in mascaras]
    sobrante = resto.load()
    limite = TOLERANCIA**2

    for y in range(alto):
        for x in range(ancho):
            pixel = origen[x, y]
            if croma(pixel) < CROMA_MINIMO:
                continue
            distancias = [distancia2(pixel, r) for r in referencias]
            menor = min(distancias) if distancias else None
            if menor is None or menor > limite:
                if recoger_resto:
                    sobrante[x, y] = 255
                continue
            destinos[distancias.index(menor)][x, y] = 255
    return (mascaras, resto) if recoger_resto else (mascaras, None)


def contorno(mascara, radio=2):
    """El trazo del borde: la banda entre la dilatación y la erosión.

    ⚠️ NO es `forma − erosión`, que parece equivalente y sale PUNTEADO. Donde la
    máscara se adelgaza a uno o dos píxeles —cosa que una curva reducida a 320 puntos
    hace en todos sus tramos planos— la erosión la atraviesa y el trazo se corta.

    La banda entre dilatación y erosión no puede cortarse, porque la dilatación
    siempre contiene a la erosión.

    Radio 2 para la forma grande. Radio 1 se afina de más a 203 dpi.
    """
    lado = radio * 2 + 1
    crecida = mascara.filter(ImageFilter.MaxFilter(lado))
    encogida = mascara.filter(ImageFilter.MinFilter(lado))
    return Image.composite(Image.new("L", mascara.size, 0), crecida, encogida)


def cerrar(mascara, radio=1):
    """Cierre morfológico: tapa los agujeros de uno o dos píxeles.

    Una ilustración tiene brillos —el ojo, el reflejo de una pluma, el borde claro de
    un fruto— que al umbralizar quedan como pinchazos blancos sueltos dentro de la
    forma. A 203 dpi no se leen como dibujo sino como suciedad del cabezal.

    Dilatar y después erosionar con el mismo radio cierra esos huecos sin engordar el
    contorno exterior, que es lo que pasaría dilatando a secas.
    """
    lado = radio * 2 + 1
    return mascara.filter(ImageFilter.MaxFilter(lado)).filter(ImageFilter.MinFilter(lado))


def a_region(texto):
    partes = texto.split(",")
    if len(partes) != 4:
        raise argparse.ArgumentTypeError(f"'{texto}' no es una región x0,y0,x1,y1")
    try:
        x0, y0, x1, y1 = (int(p) for p in partes)
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{texto}' tiene valores que no son enteros")
    if x1 <= x0 or y1 <= y0:
        raise argparse.ArgumentTypeError(f"'{texto}': x1 e y1 tienen que ser mayores que x0 e y0")
    return (x0, y0, x1, y1)


def a_hex(texto):
    limpio = texto.lstrip("#")
    if len(limpio) != 6:
        raise argparse.ArgumentTypeError(f"'{texto}' no es un color de 6 dígitos hex")
    try:
        return tuple(int(limpio[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{texto}' no es hexadecimal")


def main():
    p = argparse.ArgumentParser(
        description="Prepara el logo impreso (1 bit) a partir del logo a color.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("origen", help="PNG del logo a color")
    p.add_argument("--listar", action="store_true", help="sólo mostrar los colores de marca")
    p.add_argument("--contorno", type=a_hex, action="append", default=[], metavar="RRGGBB",
                   help="color que va en contorno (repetible)")
    p.add_argument("--solido", type=a_hex, action="append", default=[], metavar="RRGGBB",
                   help="color que va sólido (repetible)")
    p.add_argument("--silueta", action="store_true",
                   help="todo lo que tenga tinte y no sea un color nombrado, sólido "
                        "(para ilustraciones de tono continuo)")
    p.add_argument("--excluir", type=a_region, action="append", default=[], metavar="X0,Y0,X1,Y1",
                   help="región del PNG de origen que se borra de la silueta, en píxeles "
                        "a tamaño completo; se usa para sacar el nombre (repetible)")
    p.add_argument("--cerrar", action="store_true",
                   help="tapar los pinchazos blancos que dejan los brillos de la ilustración")
    p.add_argument("--radio", type=int, default=2, help="grosor del trazo, por omisión 2")
    p.add_argument("--salida", help="PNG de destino, en assets/clientes/impreso/")
    args = p.parse_args()

    imagen = aplanar(args.origen)

    if args.listar:
        print(f"{args.origen}: {imagen.size[0]}x{imagen.size[1]}")
        print("Colores con tinte (los neutros —texto y fondo— quedan fuera a propósito):")
        for (r, g, b), porcentaje in listar_colores(imagen):
            print(f"  #{r:02x}{g:02x}{b:02x}   {porcentaje:5.2f}% de la imagen")
        print("\nElegí cuáles van sólidos y cuáles en contorno, y volvé a correr con")
        print("  --contorno RRGGBB --solido RRGGBB --salida .../impreso/<cliente>.png")
        return

    if not args.contorno and not args.solido and not args.silueta:
        p.error("decí al menos un --contorno, un --solido o --silueta (probá primero con --listar)")
    if not args.salida:
        p.error("falta --salida")
    if args.excluir and not args.silueta:
        p.error("--excluir sólo tiene sentido con --silueta")

    referencias = args.contorno + args.solido
    mascaras, resto = repartir(imagen, referencias, recoger_resto=args.silueta)
    en_contorno = mascaras[: len(args.contorno)]
    en_solido = mascaras[len(args.contorno) :]

    if args.silueta:
        # Las regiones se borran ACÁ, sobre la máscara a tamaño completo, y no después
        # de reducir: a 320 puntos la banda del nombre mide unos 20 px de alto y un
        # error de redondeo se come parte de la figura.
        borrador = resto.load()
        for x0, y0, x1, y1 in args.excluir:
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(imagen.size[0], x1), min(imagen.size[1], y1)
            borrados = sum(1 for y in range(y0, y1) for x in range(x0, x1) if borrador[x, y])
            print(f"  --excluir {x0},{y0},{x1},{y1}: {borrados} px fuera de la silueta")
            for y in range(y0, y1):
                for x in range(x0, x1):
                    borrador[x, y] = 0
        if resto.getbbox() is None:
            raise SystemExit(
                "La silueta quedó vacía. Revisá las regiones de --excluir: es fácil "
                "borrar la figura entera queriendo sacar sólo el nombre."
            )
        en_solido = list(en_solido) + [resto]
        mascaras = list(mascaras) + [resto]

    # El recorte se toma sobre TODAS las formas juntas, antes de adelgazar ninguna:
    # recortando después, el contorno perdería su mitad de afuera contra el borde.
    juntas = Image.new("L", imagen.size, 0)
    for m in mascaras:
        juntas.paste(255, (0, 0), m.convert("1"))
    caja = juntas.getbbox()
    if caja is None:
        raise SystemExit(
            "Ningún píxel coincide con esos colores. Corré con --listar para ver "
            "cuáles tiene el logo de verdad."
        )

    ancho_util = ANCHO_OBJETIVO - MARGEN * 2
    alto_util = max(1, round((caja[3] - caja[1]) * ancho_util / (caja[2] - caja[0])))

    def reducir(mascara):
        # BOX promedia el bloque —no toma un píxel suelto—, así que una línea fina
        # sobrevive como gris y recién ahí se decide si marca o no.
        return (
            mascara.crop(caja)
            .resize((ancho_util, alto_util), Image.BOX)
            .point(lambda v: 255 if v > 110 else 0)
        )

    forma = Image.new("L", (ancho_util, alto_util), 0)
    blanco = Image.new("L", forma.size, 255)
    for m in en_solido:
        # El cierre va DESPUÉS de reducir: a tamaño completo los pinchazos miden
        # decenas de píxeles y taparlos ahí deformaría la figura.
        reducida = reducir(m)
        forma = Image.composite(blanco, forma, cerrar(reducida) if args.cerrar else reducida)
    for m in en_contorno:
        forma = Image.composite(blanco, forma, contorno(reducir(m), args.radio))

    lienzo = Image.new("L", (ANCHO_OBJETIVO, alto_util + MARGEN * 2), 0)
    lienzo.paste(forma, (MARGEN, MARGEN))
    # En PNG el 1 es blanco; acá veníamos con 255 = marca, así que se invierte.
    final = lienzo.point(lambda v: 0 if v > 127 else 255, "L").convert("1")

    os.makedirs(os.path.dirname(os.path.abspath(args.salida)), exist_ok=True)
    final.save(args.salida)

    datos = list(pixeles(final.convert("L")))
    tinta = sum(1 for v in datos if v < 128) * 100 / len(datos)
    print(f"{args.salida}: {final.size[0]}x{final.size[1]}, {tinta:.1f}% de tinta")
    if tinta > 40:
        print("  AVISO: más de 40% — pasá esa forma a --contorno, o revisá el fondo.")

    # A tamaño real son 40 mm: en pantalla es una estampilla y los cortes del trazo
    # no se ven. La copia al 3x es sólo para mirarla antes de darla por buena.
    vista = os.path.splitext(args.salida)[0] + "-vista3x.png"
    final.convert("L").resize(
        (final.size[0] * 3, final.size[1] * 3), Image.NEAREST
    ).save(vista)
    print(f"  vista al 3x para revisar: {vista}  (no hace falta commitearla)")


if __name__ == "__main__":
    sys.exit(main())
